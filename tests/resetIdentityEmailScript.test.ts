import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const reset = require('../scripts/reset-identity-email.cjs') as {
  SqlStore: new (runner: any, databaseType: string, schema: string) => any
  normalizeEmail: (value: unknown) => string
  parseArgs: (argv: string[]) => any
  validateExecution: (options: any) => string
  isPortListening: (port: number, timeoutMs?: number) => Promise<boolean>
  assertServiceStopped: (pidFile: string, port: number, probePort?: (port: number) => Promise<boolean>) => Promise<void>
  buildPlan: (store: FakeStore, email: string) => Promise<any>
  executePlan: (store: FakeStore, plan: any, now?: string) => Promise<any>
  planSummary: (plan: any) => any
}

type Row = Record<string, any>
type Predicate = { column: string; values: string[] }

function matches(row: Row, where: Predicate[]) {
  return where.some((item) => item.values.includes(String(row[item.column] || '')))
}

class FakeStore {
  tables: Record<string, Row[]>

  constructor(tables: Record<string, Row[]>) {
    this.tables = structuredClone(tables)
  }

  async select(table: string, columns: string[], where: Predicate[]) {
    return (this.tables[table] || [])
      .filter((row) => matches(row, where))
      .map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])))
  }

  async count(table: string, where: Predicate[]) {
    return (this.tables[table] || []).filter((row) => matches(row, where)).length
  }

  async delete(table: string, where: Predicate[]) {
    const rows = this.tables[table] || []
    const removed = rows.filter((row) => matches(row, where)).length
    this.tables[table] = rows.filter((row) => !matches(row, where))
    return removed
  }

  async update(table: string, values: Row, where: Predicate[]) {
    let updated = 0
    this.tables[table] = (this.tables[table] || []).map((row) => {
      if (!matches(row, where)) return row
      updated += 1
      return { ...row, ...values }
    })
    return updated
  }

  async insertIfAbsent(table: string, keyColumn: string, row: Row) {
    const rows = this.tables[table] || []
    if (rows.some((item) => item[keyColumn] === row[keyColumn])) return 0
    this.tables[table] = [...rows, { ...row }]
    return 1
  }
}

function fixture() {
  const did = 'did:yeying:wid_reset_target_1234567890'
  return new FakeStore({
    identity_email_accounts: [
      { email: '13815438109@126.com', identity_did: did },
      { email: 'other@example.com', identity_did: 'did:yeying:other' },
    ],
    identity_email_auth_challenges: [
      { challenge_id: 'iea-1', email: '13815438109@126.com', identity_did: did, registration_id: 'reg-1', username: 'target_user' },
    ],
    identity_verification_transactions: [
      { verification_id: 'verify-1', email: '13815438109@126.com', identity_did: did, username: 'verified_user' },
    ],
    identity_registrations: [{ registration_id: 'reg-1', identity_did: did, email_challenge_id: 'iea-1' }],
    identity_account_links: [{ identity_did: did, account_id: '0x1111111111111111111111111111111111111111' }],
    identity_account_link_challenges: [{ nonce: 'nonce-1', identity_did: did }],
    identity_authorization_requests: [{ request_id: 'request-1', identity_did: did }],
    identity_authorization_codes: [{ code: 'code-1', request_id: 'request-1', identity_did: did }],
    identity_authorization_sessions: [{ token_hash: 'refresh-1', identity_did: did }],
    identity_action_challenges: [{ challenge_id: 'action-1', identity_did: did }],
    identity_credential_reissue_challenges: [{ challenge_id: 'credential-1', identity_did: did }],
    identity_totp_authenticators: [{ identity_did: did }],
    identity_webauthn_challenges: [{ challenge_id: 'webauthn-1', identity_did: did, request_id: 'reg-1' }],
    identity_passkey_credentials: [{ uid: 'passkey-1', identity_did: did }],
    identity_credentials: [{ credential_id: 'credential-1', identity_did: did }],
    identity_usernames: [
      { uid: 'username-1', identity_did: did, normalized_username: 'target_user' },
      { uid: 'username-2', identity_did: did, normalized_username: 'legacy_user' },
    ],
    custody_key_records: [{ uid: 'custody-1', subject_id: '0x1111111111111111111111111111111111111111' }],
    users: [{ did }, { did: 'did:yeying:other' }],
    user_state: [{ did }],
    ucan_issue_sessions: [{ session_hash: 'session-1', subject: did, revoked_at: '' }],
    ucan_issued_tokens: [{ token_id: 'token-1', session_hash: 'session-1', subject: did, issuer_did: 'did:key:issuer' }],
    ucan_token_revocations: [],
    scoped_grants: [{ grant_id: 'grant-1', subject_id: did, status: 'active', revoked_at: '' }],
    scoped_grant_tokens: [{ token_id: 'token-1', grant_id: 'grant-1', status: 'active', revoked_at: '' }],
  })
}

describe('identity email reset command', () => {
  it('fails closed for malformed PID files and running services', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-reset-'))
    const pidFile = path.join(directory, 'node.pid')
    try {
      fs.writeFileSync(pidFile, 'not-a-pid')
      await expect(reset.assertServiceStopped(pidFile, 8100, async () => false)).rejects.toThrow('invalid PID file')

      fs.writeFileSync(pidFile, String(process.pid))
      await expect(reset.assertServiceStopped(pidFile, 8100, async () => false)).rejects.toThrow('Node service is still running')

      fs.unlinkSync(pidFile)
      await expect(reset.assertServiceStopped(pidFile, 8100, async () => true)).rejects.toThrow('still listening')
      await expect(reset.assertServiceStopped(pidFile, 8100, async () => false)).resolves.toBeUndefined()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires a valid configured service port before destructive execution', async () => {
    await expect(reset.assertServiceStopped('', 0, async () => false)).rejects.toThrow('app.port is invalid')
  })

  it('detects a real TCP listener on the configured local port', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address')
    try {
      await expect(reset.isPortListening(address.port)).resolves.toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
    await expect(reset.isPortListening(address.port)).resolves.toBe(false)
  })

  it('normalizes email and requires exact destructive confirmation', () => {
    expect(reset.normalizeEmail(' 13815438109@126.COM ')).toBe('13815438109@126.com')
    expect(reset.validateExecution(reset.parseArgs(['13815438109@126.com']))).toBe('13815438109@126.com')
    expect(() => reset.validateExecution(reset.parseArgs([
      '13815438109@126.com', '--execute', '--confirm-email', 'other@example.com',
    ]))).toThrow('must exactly match')
  })

  it('binds PostgreSQL update values before shifted predicate parameters', async () => {
    const calls: Array<{ sql: string; parameters: unknown[] }> = []
    const runner = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ sql, parameters })
        if (sql.startsWith('SELECT COUNT')) return [{ count: '1' }]
        return []
      },
    }
    const store = new reset.SqlStore(runner, 'postgres', 'node')
    store.exists.set('scoped_grants', true)

    await store.update(
      'scoped_grants',
      { status: 'revoked', revoked_at: '2026-10-27T01:00:00.000Z' },
      [{ column: 'grant_id', values: ['grant-1'] }]
    )

    expect(calls[1].sql).toContain('"status" = $1')
    expect(calls[1].sql).toContain('"revoked_at" = $2')
    expect(calls[1].sql).toContain('"grant_id" IN ($3)')
    expect(calls[1].parameters).toEqual(['revoked', '2026-10-27T01:00:00.000Z', 'grant-1'])
  })

  it('builds a reset plan spanning registration, wallet, session, and grant data', async () => {
    const plan = await reset.buildPlan(fixture(), '13815438109@126.com')
    const summary = reset.planSummary(plan)

    expect(summary.identityDids).toEqual(['did:yeying:wid_reset_target_1234567890'])
    expect(summary.usernames).toEqual(['target_user', 'verified_user', 'legacy_user'])
    expect(summary.walletAccounts).toEqual(['0x1111111111111111111111111111111111111111'])
    expect(summary.deletions.identity_email_accounts).toBe(1)
    expect(summary.deletions.identity_usernames).toBe(2)
    expect(summary.deletions.identity_passkey_credentials).toBe(1)
    expect(summary.deletions.custody_key_records).toBe(1)
    expect(summary.revocations.ucanTokens).toBe(1)
  })

  it('cleans only registration state and revokes authorization without deleting user policy records', async () => {
    const store = fixture()
    const plan = await reset.buildPlan(store, '13815438109@126.com')
    const result = await reset.executePlan(store, plan, '2026-10-27T01:00:00.000Z')

    expect(result.revocationsInserted).toBe(1)
    expect(store.tables.identity_email_accounts).toEqual([
      { email: 'other@example.com', identity_did: 'did:yeying:other' },
    ])
    expect(store.tables.users).toHaveLength(2)
    expect(store.tables.user_state).toHaveLength(1)
    expect(store.tables.identity_usernames).toEqual([])
    expect(store.tables.identity_passkey_credentials).toEqual([])
    expect(store.tables.custody_key_records).toEqual([])
    expect(store.tables.ucan_issue_sessions[0]).toMatchObject({ revoked_at: '2026-10-27T01:00:00.000Z' })
    expect(store.tables.ucan_token_revocations[0]).toMatchObject({ token_id: 'token-1', reason: 'identity_email_reset' })
    expect(store.tables.scoped_grants[0]).toMatchObject({ status: 'revoked' })
    expect(store.tables.scoped_grant_tokens[0]).toMatchObject({ status: 'revoked' })
  })

  it('revokes a scoped-grant token even when its issued-token metadata is missing', async () => {
    const store = fixture()
    store.tables.ucan_issued_tokens = []
    const plan = await reset.buildPlan(store, '13815438109@126.com')

    expect(plan.targets.issuedTokens).toEqual([
      {
        token_id: 'token-1',
        session_hash: '',
        subject: 'did:yeying:wid_reset_target_1234567890',
        issuer_did: '',
      },
    ])
    await reset.executePlan(store, plan, '2026-10-27T01:00:00.000Z')
    expect(store.tables.ucan_token_revocations[0]).toMatchObject({ token_id: 'token-1' })
  })
})
