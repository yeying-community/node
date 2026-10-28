import { MigrationInterface, QueryRunner } from 'typeorm'

type CredentialRow = { credential_id: string; identity_did: string; token: string; issued_at: string }
type AccountRow = { email: string; identity_did: string; status: string; created_at: string; verified_at: string }
type BindingRow = { email: string; identityDid: string; status: string; createdAt: string; verifiedAt: string }
type Candidate = { identityDid: string; email: string; issuedAt: string; credentialIds: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(value: unknown) {
  const email = String(value || '').trim().normalize('NFC').toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 320) return ''
  return email
}

function emailFromCredential(row: CredentialRow) {
  try {
    const encodedPayload = String(row.token || '').split('.')[1]
    if (!encodedPayload) return ''
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString())
    const types = Array.isArray(payload?.vc?.type) ? payload.vc.type : []
    if (payload?.sub !== row.identity_did || payload?.vc?.credentialSubject?.id !== row.identity_did || !types.includes('EmailCredential')) return ''
    return normalizeEmail(payload?.vc?.credentialSubject?.email)
  } catch {
    return ''
  }
}

function conflictId(row: Candidate) {
  return `${row.identityDid}/${row.credentialIds.join(',') || 'identity_email_accounts'}`
}

export function planIdentityEmailBindingBackfill(credentials: CredentialRow[], accounts: AccountRow[]): BindingRow[] {
  const candidates: Candidate[] = []
  const errors: string[] = []
  const accountsByEmail = new Map<string, AccountRow>()
  const accountsByIdentity = new Map<string, AccountRow>()

  for (const account of accounts) {
    const normalizedEmail = normalizeEmail(account.email)
    if (!normalizedEmail || normalizedEmail !== account.email || !account.identity_did) {
      errors.push(`invalid account binding identity=${account.identity_did || 'unknown'} email=${String(account.email || '')}`)
      continue
    }
    if (account.status === 'active') {
      accountsByEmail.set(normalizedEmail, account)
      accountsByIdentity.set(account.identity_did, account)
      candidates.push({ identityDid: account.identity_did, email: normalizedEmail, issuedAt: account.verified_at || account.created_at, credentialIds: [] })
    }
  }

  for (const credential of credentials) {
    const email = emailFromCredential(credential)
    if (!email || !credential.identity_did || !credential.credential_id) {
      errors.push(`invalid EmailCredential identity=${credential.identity_did || 'unknown'} credential=${credential.credential_id || 'unknown'}`)
      continue
    }
    candidates.push({ identityDid: credential.identity_did, email, issuedAt: credential.issued_at, credentialIds: [credential.credential_id] })
  }

  const byEmail = new Map<string, Candidate[]>()
  const byIdentity = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    byEmail.set(candidate.email, [...(byEmail.get(candidate.email) || []), candidate])
    byIdentity.set(candidate.identityDid, [...(byIdentity.get(candidate.identityDid) || []), candidate])
  }

  for (const [email, rows] of byEmail) {
    const identities = [...new Set(rows.map(row => row.identityDid))]
    if (identities.length > 1) errors.push(`email has multiple identities email=${email} identities=${identities.join(',')} sources=${rows.map(conflictId).join(';')}`)
  }
  for (const [identityDid, rows] of byIdentity) {
    const emails = [...new Set(rows.map(row => row.email))]
    if (emails.length > 1) errors.push(`identity has multiple emails identity=${identityDid} emails=${emails.join(',')} sources=${rows.map(conflictId).join(';')}`)
  }

  for (const candidate of candidates) {
    const accountByEmail = accounts.find(account => account.email === candidate.email)
    const accountByIdentity = accounts.find(account => account.identity_did === candidate.identityDid)
    if ((accountByEmail && (accountByEmail.identity_did !== candidate.identityDid || accountByEmail.status !== 'active'))
      || (accountByIdentity && (accountByIdentity.email !== candidate.email || accountByIdentity.status !== 'active'))) {
      errors.push(`credential/account mismatch identity=${candidate.identityDid} email=${candidate.email} sources=${conflictId(candidate)}`)
    }
  }

  if (errors.length) throw new Error(`IDENTITY_EMAIL_BINDING_BACKFILL_CONFLICT: ${errors.slice(0, 20).join(' | ')}`)

  const unique = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const key = `${candidate.email}\u0000${candidate.identityDid}`
    const previous = unique.get(key)
    if (!previous) unique.set(key, { ...candidate })
    else {
      previous.credentialIds.push(...candidate.credentialIds)
      if (Date.parse(candidate.issuedAt) < Date.parse(previous.issuedAt)) previous.issuedAt = candidate.issuedAt
    }
  }

  return [...unique.values()]
    .filter(candidate => !accountsByEmail.has(candidate.email))
    .map(candidate => ({
      email: candidate.email,
      identityDid: candidate.identityDid,
      status: 'active',
      createdAt: candidate.issuedAt,
      verifiedAt: candidate.issuedAt
    }))
}

export class BackfillIdentityEmailBindings20261028000000 implements MigrationInterface {
  name = 'BackfillIdentityEmailBindings20261028000000'

  async up(q: QueryRunner): Promise<void> {
    if (q.connection.options.type !== 'postgres') throw new Error('BackfillIdentityEmailBindings20261028000000 only supports postgres')
    const schema = q.connection.options.schema || 'public'
    const s = `"${String(schema).replace(/"/g, '""')}"`
    const credentials = await q.query(`SELECT credential_id, identity_did, token, issued_at FROM ${s}."identity_credentials" WHERE credential_type = 'EmailCredential' AND status = 'active' AND revoked_at = ''`)
    const accounts = await q.query(`SELECT email, identity_did, status, created_at, verified_at FROM ${s}."identity_email_accounts"`)
    const bindings = planIdentityEmailBindingBackfill(credentials, accounts)

    for (const binding of bindings) {
      await q.query(
        `INSERT INTO ${s}."identity_email_accounts" (email, identity_did, status, created_at, verified_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
        [binding.email, binding.identityDid, binding.status, binding.createdAt, binding.verifiedAt]
      )
      const stored = await q.query(`SELECT identity_did FROM ${s}."identity_email_accounts" WHERE email = $1`, [binding.email])
      if (stored[0]?.identity_did !== binding.identityDid) {
        throw new Error(`IDENTITY_EMAIL_BINDING_BACKFILL_CONFLICT: concurrent binding email=${binding.email} identity=${binding.identityDid}`)
      }
    }
  }

  async down(): Promise<void> {
    // Preserve verified email bindings; deleting them would weaken identity ownership.
  }
}
