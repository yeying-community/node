import { randomUUID } from 'node:crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { describe, expect, it } from 'vitest'
import {
  BackfillIdentityEmailBindings20261028000000,
  planIdentityEmailBindingBackfill,
} from '../src/migrations/20261028000000-backfill-identity-email-bindings'

type CredentialRow = { credential_id: string; identity_did: string; token: string; issued_at: string }
type AccountRow = { email: string; identity_did: string; status: string; created_at: string; verified_at: string }

function credential(credentialId: string, identityDid: string, email: string, issuedAt = '2026-10-20T00:00:00.000Z'): CredentialRow {
  const payload = {
    sub: identityDid,
    vc: { type: ['VerifiableCredential', 'EmailCredential'], credentialSubject: { id: identityDid, email } },
  }
  return {
    credential_id: credentialId,
    identity_did: identityDid,
    token: `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`,
    issued_at: issuedAt,
  }
}

function account(email: string, identityDid: string, status = 'active'): AccountRow {
  return { email, identity_did: identityDid, status, created_at: '2026-10-19T00:00:00.000Z', verified_at: '2026-10-19T00:00:00.000Z' }
}

describe('identity email binding backfill plan', () => {
  it('normalizes and deduplicates credentials for the same DID and email', () => {
    const bindings = planIdentityEmailBindingBackfill([
      credential('credential-1', 'did:yeying:wid_owner', 'Alice@Example.com', '2026-10-20T00:00:00.000Z'),
      credential('credential-2', 'did:yeying:wid_owner', 'alice@example.com', '2026-10-18T00:00:00.000Z'),
    ], [])

    expect(bindings).toEqual([{
      email: 'alice@example.com',
      identityDid: 'did:yeying:wid_owner',
      status: 'active',
      createdAt: '2026-10-18T00:00:00.000Z',
      verifiedAt: '2026-10-18T00:00:00.000Z',
    }])
  })

  it('rejects one email claimed by multiple DIDs', () => {
    expect(() => planIdentityEmailBindingBackfill([
      credential('credential-1', 'did:yeying:wid_first', 'same@example.com'),
      credential('credential-2', 'did:yeying:wid_second', 'same@example.com'),
    ], [])).toThrow(/IDENTITY_EMAIL_BINDING_BACKFILL_CONFLICT: email has multiple identities email=same@example\.com/)
  })

  it('rejects multiple candidate emails for one DID', () => {
    expect(() => planIdentityEmailBindingBackfill([
      credential('credential-1', 'did:yeying:wid_owner', 'first@example.com'),
      credential('credential-2', 'did:yeying:wid_owner', 'second@example.com'),
    ], [])).toThrow(/IDENTITY_EMAIL_BINDING_BACKFILL_CONFLICT: identity has multiple emails identity=did:yeying:wid_owner emails=first@example\.com,second@example\.com/)
  })

  it('accepts an exact existing active binding idempotently', () => {
    expect(planIdentityEmailBindingBackfill(
      [credential('credential-1', 'did:yeying:wid_owner', 'alice@example.com')],
      [account('alice@example.com', 'did:yeying:wid_owner')],
    )).toEqual([])
  })

  it('rejects existing account and credential relationships that disagree', () => {
    expect(() => planIdentityEmailBindingBackfill(
      [credential('credential-1', 'did:yeying:wid_new', 'alice@example.com')],
      [account('alice@example.com', 'did:yeying:wid_existing')],
    )).toThrow(/IDENTITY_EMAIL_BINDING_BACKFILL_CONFLICT: email has multiple identities/)

    expect(() => planIdentityEmailBindingBackfill(
      [credential('credential-1', 'did:yeying:wid_owner', 'alice@example.com')],
      [account('alice@example.com', 'did:yeying:wid_owner', 'disabled')],
    )).toThrow(/IDENTITY_EMAIL_BINDING_BACKFILL_CONFLICT: credential\/account mismatch/)
  })
})

const TEST_DATABASE_URL = String(process.env.TEST_DATABASE_URL || '').trim()
const postgresIt = TEST_DATABASE_URL ? it : it.skip

async function withMigrationSchema(run: (schema: string, queryRunner: QueryRunner) => Promise<void>) {
  const schema = `migration_test_${randomUUID().replace(/-/g, '')}`
  const admin = new DataSource({ type: 'postgres', url: TEST_DATABASE_URL })
  let scoped: DataSource | null = null
  await admin.initialize()
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`)
    scoped = new DataSource({ type: 'postgres', url: TEST_DATABASE_URL, schema })
    await scoped.initialize()
    const queryRunner = scoped.createQueryRunner()
    try {
      await queryRunner.connect()
      await queryRunner.query(`CREATE TABLE "${schema}"."identity_credentials" (
        credential_id varchar(320) PRIMARY KEY,
        identity_did varchar(128) NOT NULL,
        token text NOT NULL,
        issued_at varchar(64) NOT NULL,
        credential_type varchar(64) NOT NULL,
        status varchar(32) NOT NULL,
        revoked_at varchar(64) NOT NULL
      )`)
      await queryRunner.query(`CREATE TABLE "${schema}"."identity_email_accounts" (
        email varchar(320) PRIMARY KEY,
        identity_did varchar(128) NOT NULL UNIQUE,
        status varchar(32) NOT NULL,
        created_at varchar(64) NOT NULL,
        verified_at varchar(64) NOT NULL
      )`)
      await run(schema, queryRunner)
    } finally {
      await queryRunner.release()
    }
  } finally {
    if (scoped?.isInitialized) await scoped.destroy()
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin.destroy()
  }
}

async function insertCredential(queryRunner: QueryRunner, row: CredentialRow) {
  await queryRunner.query(
    `INSERT INTO "${String(queryRunner.connection.options.schema)}"."identity_credentials" (credential_id, identity_did, token, issued_at, credential_type, status, revoked_at) VALUES ($1, $2, $3, $4, 'EmailCredential', 'active', '')`,
    [row.credential_id, row.identity_did, row.token, row.issued_at],
  )
}

describe('identity email binding backfill migration', () => {
  postgresIt('backfills a binding once and leaves an exact active binding unchanged', async () => {
    await withMigrationSchema(async (schema, queryRunner) => {
      await insertCredential(queryRunner, credential('credential-1', 'did:yeying:wid_owner', 'alice@example.com'))
      const migration = new BackfillIdentityEmailBindings20261028000000()
      await migration.up(queryRunner)
      await migration.up(queryRunner)

      const rows = await queryRunner.query(`SELECT email, identity_did, status FROM "${schema}"."identity_email_accounts"`)
      expect(rows).toEqual([{ email: 'alice@example.com', identity_did: 'did:yeying:wid_owner', status: 'active' }])
    })
  })

  postgresIt('does not leave partial bindings when an insert fails inside the migration transaction', async () => {
    await withMigrationSchema(async (schema, queryRunner) => {
      await insertCredential(queryRunner, credential('credential-1', 'did:yeying:wid_first', 'first@example.com'))
      await insertCredential(queryRunner, credential('credential-2', 'did:yeying:wid_second', 'second@example.com'))
      await queryRunner.query(`CREATE FUNCTION "${schema}".reject_second_binding() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM "${schema}"."identity_email_accounts") THEN
            RAISE EXCEPTION 'test insert failure';
          END IF;
          RETURN NEW;
        END;
      $$`)
      await queryRunner.query(`CREATE TRIGGER reject_second_binding BEFORE INSERT ON "${schema}"."identity_email_accounts" FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_second_binding()`)

      await queryRunner.startTransaction()
      try {
        await expect(new BackfillIdentityEmailBindings20261028000000().up(queryRunner)).rejects.toThrow('test insert failure')
        await queryRunner.rollbackTransaction()
      } catch (error) {
        if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction()
        throw error
      }

      const rows = await queryRunner.query(`SELECT email FROM "${schema}"."identity_email_accounts"`)
      expect(rows).toEqual([])
    })
  })
})
