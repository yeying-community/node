import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityPasskeyColumns20260820133000 implements MigrationInterface {
  name = 'AddIdentityPasskeyColumns20260820133000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') throw new Error('AddIdentityPasskeyColumns20260820133000 only supports postgres')
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${schema}."identity_passkey_credentials" (uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_did varchar(128) NOT NULL, credential_id text NOT NULL UNIQUE, public_key text NOT NULL, sign_count bigint NOT NULL DEFAULT 0, aaguid varchar(128) NOT NULL DEFAULT '', transports text NOT NULL DEFAULT '', device_name varchar(255) NOT NULL DEFAULT '', rp_id varchar(255) NOT NULL DEFAULT '', user_handle text NOT NULL DEFAULT '', created_at varchar(64) NOT NULL DEFAULT '', last_used_at varchar(64) NOT NULL DEFAULT '', revoked_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_passkey_credentials_identity" ON ${schema}."identity_passkey_credentials" (identity_did)`)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${schema}."identity_webauthn_challenges" (challenge_id varchar(128) PRIMARY KEY, challenge_type varchar(32) NOT NULL, identity_did varchar(128) NOT NULL DEFAULT '', request_id varchar(128) NOT NULL DEFAULT '', challenge text NOT NULL, allowed_credential_ids text NOT NULL DEFAULT '[]', created_at varchar(64) NOT NULL DEFAULT '', expires_at varchar(64) NOT NULL DEFAULT '', used boolean NOT NULL DEFAULT false)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_webauthn_challenge_expires_at" ON ${schema}."identity_webauthn_challenges" (expires_at)`)
  }

  async down(): Promise<void> {
    // The columns are intentionally retained because old and new auth flows may
    // share the physical passkey table during rollout.
  }
}
