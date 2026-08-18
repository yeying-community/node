import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityAuthorization20260818120000 implements MigrationInterface {
  name = 'AddIdentityAuthorization20260818120000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') throw new Error('AddIdentityAuthorization20260818120000 only supports postgres')
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${schema}."identity_authorization_requests" (request_id varchar(128) PRIMARY KEY, app_id varchar(128) NOT NULL, redirect_uri text NOT NULL, state varchar(256) NOT NULL DEFAULT '', code_challenge varchar(256) NOT NULL, code_challenge_method varchar(16) NOT NULL DEFAULT 'S256', scopes_json text NOT NULL, nonce varchar(128) NOT NULL, identity_did varchar(128) NOT NULL DEFAULT '', status varchar(32) NOT NULL DEFAULT 'pending', created_at varchar(64) NOT NULL, updated_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, approved_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`ALTER TABLE ${schema}."identity_authorization_requests" ADD COLUMN IF NOT EXISTS nonce varchar(128) NOT NULL DEFAULT ''`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_authorization_request_status_expires" ON ${schema}."identity_authorization_requests" (status, expires_at)`)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${schema}."identity_authorization_codes" (code varchar(128) PRIMARY KEY, request_id varchar(128) NOT NULL, app_id varchar(128) NOT NULL, redirect_uri text NOT NULL, state varchar(256) NOT NULL DEFAULT '', code_challenge varchar(256) NOT NULL, scopes_json text NOT NULL, identity_did varchar(128) NOT NULL, issued_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, used boolean NOT NULL DEFAULT false, used_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_authorization_code_request" ON ${schema}."identity_authorization_codes" (request_id)`)
  }

  async down(): Promise<void> { /* Authorization records are retained during rollback. */ }
}
