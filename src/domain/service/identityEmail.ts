import { createHash, randomInt, randomUUID } from 'node:crypto'
import { isAccountLinked } from '../../auth/identityAccountLink'
import { issueIdentityCredential } from '../../auth/identityIssuer'
import { SingletonDataSource } from '../facade/datasource'
import { IdentityAuditLogDO, IdentityCredentialDO, IdentityUsernameDO, IdentityVerificationTransactionDO } from '../mapper/entity'
import { getConfig } from '../../config/runtime'

type Delivery = (input: { email: string; code: string; expiresAt: string }) => Promise<void>
type Challenge = { id: string; identity: string; account: { chainKey: string; address: string }; email: string; username?: string; avatarUri?: string; hash: string; attempts: number; expiresAt: number; status: 'pending' | 'verified' | 'expired'; types: string[] }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const NAMESPACE = String(getConfig<string>('issuer.identity.usernameNamespace') || 'node.yeying.pub')

function requireDataSource() {
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE')
  return ds
}

function normalizeEmail(email: unknown) {
  const value = String(email || '').trim().normalize('NFC').toLowerCase()
  if (!EMAIL_RE.test(value) || value.length > 320) throw new Error('IDENTITY_EMAIL_INVALID')
  return value
}

function normalizeUsername(username: unknown) {
  const value = String(username || '').trim().normalize('NFC').toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(value)) throw new Error('IDENTITY_USERNAME_INVALID')
  return value
}

function normalizeAvatarUri(avatarUri: unknown) {
  const value = String(avatarUri || '').trim()
  if (!value || value.length > 2048) throw new Error('IDENTITY_AVATAR_INVALID')
  if (value.startsWith('ipfs://')) return value
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('IDENTITY_AVATAR_INVALID') }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('IDENTITY_AVATAR_INVALID')
  parsed.hash = ''
  return parsed.toString()
}

function hashCode(id: string, code: string) {
  return createHash('sha256').update(`${id}:${code}`).digest('hex')
}

export class IdentityEmailService {
  constructor(private readonly delivery: Delivery) {}

  async request(input: { type?: string; types?: string[]; identity: string; account: { chainKey: string; address: string }; email: string; username?: string; avatarUri?: string; avatarUrl?: string; avatar?: string }) {
    const types = normalizeTypes(input)
    if (types.some(type => !['email', 'username', 'avatar'].includes(type))) throw new Error('IDENTITY_VERIFICATION_TYPE_UNSUPPORTED')
    const email = normalizeEmail(input.email)
    const username = types.includes('username') ? normalizeUsername((input as any).username) : undefined
    const avatarUri = types.includes('avatar') ? normalizeAvatarUri(input.avatarUri || input.avatarUrl || input.avatar) : undefined
    if (!await isAccountLinked(input.identity, input.account)) throw new Error('IDENTITY_ACCOUNT_PROOF_INVALID')
    const id = `email_${randomUUID()}`
    const code = String(randomInt(100000, 1000000))
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
    const ds = requireDataSource()
    {
      const transaction = new IdentityVerificationTransactionDO()
      Object.assign(transaction, { verificationId: id, identityDid: input.identity, typesJson: JSON.stringify(types), email, avatarUri: avatarUri || '', username: username || '', emailCodeHash: hashCode(id, code), attempts: 0, status: 'pending', expiresAt, createdAt: new Date().toISOString(), completedAt: '' })
      try {
        if (username) {
          await ds.transaction(async manager => {
            const usernameRepository = manager.getRepository(IdentityUsernameDO)
            const existing = await usernameRepository.findOneBy({ namespace: NAMESPACE, normalizedUsername: username })
            const reservationExpired = existing?.status === 'expired'
              || (existing?.status === 'reserved' && Date.parse(existing.reservedUntil) <= Date.now())
            if (existing && existing.identityDid !== input.identity && !reservationExpired) throw new Error('IDENTITY_USERNAME_TAKEN')
            if (existing) {
              await usernameRepository.update(
                { uid: existing.uid },
                {
                  identityDid: input.identity,
                  status: existing.status === 'active' && existing.identityDid === input.identity ? 'active' : 'reserved',
                  reservedUntil: existing.status === 'active' && existing.identityDid === input.identity ? '' : expiresAt,
                  updatedAt: transaction.createdAt
                }
              )
            } else {
              const usernameRow = new IdentityUsernameDO()
              Object.assign(usernameRow, { namespace: NAMESPACE, normalizedUsername: username, identityDid: input.identity, status: 'reserved', reservedUntil: expiresAt, createdAt: transaction.createdAt, updatedAt: transaction.createdAt })
              await usernameRepository.save(usernameRow)
            }
            await manager.getRepository(IdentityVerificationTransactionDO).save(transaction)
          })
        } else await ds.getRepository(IdentityVerificationTransactionDO).save(transaction)
      } catch (error) {
        if (String((error as Error)?.message || error) === 'IDENTITY_USERNAME_TAKEN') throw error
        throw new Error(username ? 'IDENTITY_USERNAME_TAKEN' : 'IDENTITY_VERIFICATION_STORE_FAILED')
      }
    }
    try {
      await this.delivery({ email, code, expiresAt })
    } catch (error) {
      if (username) await ds.getRepository(IdentityUsernameDO).update({ namespace: NAMESPACE, normalizedUsername: username, status: 'reserved' }, { status: 'expired', reservedUntil: '', updatedAt: new Date().toISOString() })
      await ds.getRepository(IdentityVerificationTransactionDO).update({ verificationId: id }, { status: 'expired' })
      throw error
    }
    return { verificationId: id, types, email, ...(username ? { username } : {}), ...(avatarUri ? { avatarUri } : {}), expiresAt }
  }

  async confirm(input: { type?: string; types?: string[]; verificationId: string; code?: string; codes?: Record<string, string> }) {
    const types = normalizeTypes(input)
    if (types.some(type => !['email', 'username', 'avatar'].includes(type))) throw new Error('IDENTITY_VERIFICATION_TYPE_UNSUPPORTED')
    const id = String(input.verificationId || '')
    const ds = requireDataSource()
    const row = await ds.getRepository(IdentityVerificationTransactionDO).findOneBy({ verificationId: id })
    const challenge = row && { id: row.verificationId, identity: row.identityDid, account: { chainKey: '', address: '' }, email: row.email, username: row.username || undefined, avatarUri: row.avatarUri || undefined, hash: row.emailCodeHash, attempts: row.attempts, expiresAt: Date.parse(row.expiresAt), status: row.status as Challenge['status'], types: JSON.parse(row.typesJson) }
    if (!challenge) throw new Error('IDENTITY_EMAIL_VERIFICATION_NOT_FOUND')
    if (challenge.status !== 'pending' || Date.now() > challenge.expiresAt || types.join(',') !== challenge.types.join(',')) {
      challenge.status = 'expired'
      if (challenge.username) await ds.getRepository(IdentityUsernameDO).update({ namespace: NAMESPACE, normalizedUsername: challenge.username, status: 'reserved' }, { status: 'expired', reservedUntil: '', updatedAt: new Date().toISOString() })
      throw new Error(types.join(',') !== challenge.types.join(',') ? 'IDENTITY_VERIFICATION_TYPES_MISMATCH' : 'IDENTITY_EMAIL_VERIFICATION_EXPIRED')
    }
    const code = input.codes?.email || input.code || ''
    challenge.attempts += 1
    await ds.getRepository(IdentityVerificationTransactionDO).update({ verificationId: challenge.id }, { attempts: challenge.attempts })
    if (challenge.attempts > MAX_ATTEMPTS || hashCode(challenge.id, code) !== challenge.hash) {
      if (challenge.attempts >= MAX_ATTEMPTS) challenge.status = 'expired'
      await ds.getRepository(IdentityVerificationTransactionDO).update({ verificationId: challenge.id }, { status: challenge.status })
      throw new Error('IDENTITY_EMAIL_VERIFICATION_INVALID')
    }
    challenge.status = 'verified'
    const verifiedAt = new Date().toISOString()
    const credentials: Array<{ type: string; credentialId: string; credential: string }> = []
    if (challenge.username) {
      await ds.getRepository(IdentityUsernameDO).update({ namespace: NAMESPACE, normalizedUsername: challenge.username, status: 'reserved' }, { status: 'active', reservedUntil: '', updatedAt: verifiedAt })
      const credentialId = `urn:yeying:credential:username:${challenge.id}`
      const credential = issueIdentityCredential({
        credentialId,
        subject: challenge.identity,
        type: 'UsernameCredential',
        claim: {
          username: challenge.username,
          usernameQualified: `${challenge.username}@${NAMESPACE}`,
          usernamePolicyVersion: 'v1',
          credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' }
        }
      })
      credentials.push({ type: 'UsernameCredential', credentialId, credential })
    }
    if (challenge.types.includes('email')) {
      const credentialId = `urn:yeying:credential:email:${challenge.id}`
      const credential = issueIdentityCredential({
        credentialId,
        subject: challenge.identity,
        type: 'EmailCredential',
        claim: {
          email: challenge.email,
          emailVerifiedAt: verifiedAt,
          emailVerificationMethod: 'email-code-v1',
          credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' }
        }
      })
      credentials.push({ type: 'EmailCredential', credentialId, credential })
    }
    if (challenge.types.includes('avatar') && challenge.avatarUri) {
      const credentialId = `urn:yeying:credential:avatar:${challenge.id}`
      const credential = issueIdentityCredential({
        credentialId,
        subject: challenge.identity,
        type: 'AvatarCredential',
        claim: {
          avatarUri: challenge.avatarUri,
          avatarVerifiedAt: verifiedAt,
          avatarVerificationMethod: 'wallet-profile-v1',
          credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' }
        }
      })
      credentials.push({ type: 'AvatarCredential', credentialId, credential })
    }
    {
      await ds.getRepository(IdentityVerificationTransactionDO).update({ verificationId: challenge.id }, { status: 'completed', completedAt: verifiedAt })
      const credentialRepository = ds.getRepository(IdentityCredentialDO)
      for (const item of credentials) {
        const payload: any = JSON.parse(Buffer.from(item.credential.split('.')[1], 'base64url').toString())
        const row = new IdentityCredentialDO()
        Object.assign(row, { credentialId: item.credentialId, identityDid: challenge.identity, credentialType: item.type, token: item.credential, status: 'active', issuedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString(), revokedAt: '' })
        await credentialRepository.save(row)
      }
      const audit = new IdentityAuditLogDO()
      Object.assign(audit, { identityDid: challenge.identity, action: 'identity_verification_completed', outcome: 'success', metadataJson: JSON.stringify({ types: challenge.types, credentialIds: credentials.map(item => item.credentialId) }), createdAt: verifiedAt })
      await ds.getRepository(IdentityAuditLogDO).save(audit)
    }
    return { verificationId: challenge.id, types: challenge.types, credentials, identity: challenge.identity, verifiedAt }
  }
}

function normalizeTypes(input: { type?: string; types?: string[] }) {
  const values = Array.isArray(input.types) ? input.types : input.type ? [input.type] : []
  const types = [...new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))]
  if (types.length === 0) throw new Error('IDENTITY_VERIFICATION_TYPES_REQUIRED')
  return types
}
