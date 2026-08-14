import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWalletIdentityState20260813090000 implements MigrationInterface {
  name = 'AddWalletIdentityState20260813090000'
  async up(q: QueryRunner) {
    if (q.connection.options.type !== 'postgres') throw new Error('AddWalletIdentityState20260813090000 only supports postgres')
    const s = `"${String(q.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_account_link_challenges" (nonce varchar(128) PRIMARY KEY, identity_did varchar(128) NOT NULL, chain_key varchar(64) NOT NULL, account_id varchar(128) NOT NULL, issued_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, status varchar(32) NOT NULL DEFAULT 'pending', consumed_at varchar(64) NOT NULL DEFAULT '')`)
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_identity_link_challenge_expires" ON ${s}."identity_account_link_challenges" (status, expires_at)`)
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_account_links" (uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_did varchar(128) NOT NULL, chain_key varchar(64) NOT NULL, account_id varchar(128) NOT NULL, status varchar(32) NOT NULL DEFAULT 'active', verified_at varchar(64) NOT NULL, revoked_at varchar(64) NOT NULL DEFAULT '')`)
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_identity_account_link" ON ${s}."identity_account_links" (identity_did, chain_key, account_id)`)
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_verification_transactions" (verification_id varchar(128) PRIMARY KEY, identity_did varchar(128) NOT NULL, types_json text NOT NULL, email varchar(320) NOT NULL DEFAULT '', username varchar(128) NOT NULL DEFAULT '', email_code_hash varchar(128) NOT NULL DEFAULT '', attempts integer NOT NULL DEFAULT 0, status varchar(32) NOT NULL DEFAULT 'pending', expires_at varchar(64) NOT NULL, created_at varchar(64) NOT NULL, completed_at varchar(64) NOT NULL DEFAULT '')`)
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_identity_verification_expires" ON ${s}."identity_verification_transactions" (status, expires_at)`)
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_usernames" (uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), namespace varchar(128) NOT NULL, normalized_username varchar(32) NOT NULL, identity_did varchar(128) NOT NULL, status varchar(32) NOT NULL DEFAULT 'reserved', reserved_until varchar(64) NOT NULL DEFAULT '', created_at varchar(64) NOT NULL, updated_at varchar(64) NOT NULL)`)
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_identity_username_namespace_value" ON ${s}."identity_usernames" (namespace, normalized_username)`)
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_credentials" (credential_id varchar(320) PRIMARY KEY, identity_did varchar(128) NOT NULL, credential_type varchar(64) NOT NULL, token text NOT NULL, status varchar(32) NOT NULL DEFAULT 'active', issued_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, revoked_at varchar(64) NOT NULL DEFAULT '')`)
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_identity_credential_subject" ON ${s}."identity_credentials" (identity_did, credential_type)`)
    await q.query(`CREATE TABLE IF NOT EXISTS ${s}."identity_audit_logs" (uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_did varchar(128) NOT NULL DEFAULT '', action varchar(64) NOT NULL, outcome varchar(32) NOT NULL DEFAULT 'success', metadata_json text NOT NULL DEFAULT '{}', created_at varchar(64) NOT NULL)`)
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_identity_audit_identity_created" ON ${s}."identity_audit_logs" (identity_did, created_at)`)
  }
  async down() { /* Retain identity data during rollback; removal is an explicit operational action. */ }
}
