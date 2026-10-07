import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityEmailAuth20261007140000 implements MigrationInterface {
  name = 'AddIdentityEmailAuth20261007140000'

  async up(q: QueryRunner): Promise<void> {
    if (q.connection.options.type !== 'postgres') throw new Error('AddIdentityEmailAuth20261007140000 only supports postgres')
    const schema = q.connection.options.schema || 'public'
    const s = `"${String(schema).replace(/"/g, '""')}"`
    await q.query(`ALTER TABLE ${s}."identity_registrations" ADD COLUMN IF NOT EXISTS email_challenge_id varchar(128) NOT NULL DEFAULT ''`)
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_email_accounts" (email varchar(320) PRIMARY KEY, identity_did varchar(128) NOT NULL UNIQUE, status varchar(32) NOT NULL DEFAULT 'active', created_at varchar(64) NOT NULL, verified_at varchar(64) NOT NULL)`)
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_email_auth_challenges" (challenge_id varchar(128) PRIMARY KEY, email varchar(320) NOT NULL, identity_did varchar(128) NOT NULL DEFAULT '', registration_id varchar(128) NOT NULL DEFAULT '', purpose varchar(32) NOT NULL, code_hash varchar(128) NOT NULL, passkey_request_json text NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0, status varchar(32) NOT NULL DEFAULT 'pending', created_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, consumed_at varchar(64) NOT NULL DEFAULT '')`)
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_identity_email_auth_challenge_lookup" ON ${s}."identity_email_auth_challenges" (email, purpose, status)`)
  }

  async down(q: QueryRunner): Promise<void> {
    if (q.connection.options.type !== 'postgres') throw new Error('AddIdentityEmailAuth20261007140000 only supports postgres')
    const schema = q.connection.options.schema || 'public'
    const s = `"${String(schema).replace(/"/g, '""')}"`
    await q.query(`DROP TABLE IF EXISTS ${s}."identity_email_auth_challenges"`)
    await q.query(`DROP TABLE IF EXISTS ${s}."identity_email_accounts"`)
    await q.query(`ALTER TABLE ${s}."identity_registrations" DROP COLUMN IF EXISTS email_challenge_id`)
  }
}
