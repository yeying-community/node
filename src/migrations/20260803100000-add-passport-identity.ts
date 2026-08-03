import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddPassportIdentity20260803100000 implements MigrationInterface {
  name = 'AddPassportIdentity20260803100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddPassportIdentity20260803100000 only supports postgres, got ${dbType}`)
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_subjects" (
        subject_id varchar(128) PRIMARY KEY,
        status varchar(64) NOT NULL DEFAULT 'active',
        created_from varchar(64) NOT NULL DEFAULT 'wallet',
        primary_wallet_address varchar(128) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_wallet_bindings" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_id varchar(128) NOT NULL,
        chain varchar(64) NOT NULL DEFAULT 'eip155:1',
        address varchar(128) NOT NULL,
        proof_json text NOT NULL DEFAULT '{}',
        status varchar(64) NOT NULL DEFAULT 'active',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        revoked_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_passport_wallet_binding_address"
      ON ${schemaRef}."passport_wallet_bindings" (chain, address)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_wallet_binding_subject"
      ON ${schemaRef}."passport_wallet_bindings" (subject_id)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_passkey_credentials" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_id varchar(128) NOT NULL,
        credential_id text NOT NULL UNIQUE,
        public_key text NOT NULL,
        sign_count bigint NOT NULL DEFAULT 0,
        aaguid varchar(128) NOT NULL DEFAULT '',
        transports text NOT NULL DEFAULT '',
        device_name varchar(255) NOT NULL DEFAULT '',
        rp_id varchar(255) NOT NULL DEFAULT '',
        user_handle text NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        last_used_at varchar(64) NOT NULL DEFAULT '',
        revoked_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_passkey_credentials_subject"
      ON ${schemaRef}."passport_passkey_credentials" (subject_id)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_webauthn_challenges" (
        challenge_id varchar(128) PRIMARY KEY,
        challenge_type varchar(32) NOT NULL,
        subject_id varchar(128) NOT NULL DEFAULT '',
        request_id varchar(128) NOT NULL DEFAULT '',
        challenge text NOT NULL,
        allowed_credential_ids text NOT NULL DEFAULT '[]',
        created_at varchar(64) NOT NULL DEFAULT '',
        expires_at varchar(64) NOT NULL DEFAULT '',
        used boolean NOT NULL DEFAULT false
      )
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_webauthn_challenge_expires_at"
      ON ${schemaRef}."passport_webauthn_challenges" (expires_at)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_authorization_requests" (
        request_id varchar(128) PRIMARY KEY,
        app_id varchar(128) NOT NULL,
        redirect_uri text NOT NULL,
        state text NOT NULL DEFAULT '',
        code_challenge varchar(128) NOT NULL,
        code_challenge_method varchar(16) NOT NULL DEFAULT 'S256',
        subject_id varchar(128) NOT NULL DEFAULT '',
        wallet_address varchar(128) NOT NULL DEFAULT '',
        status varchar(64) NOT NULL DEFAULT 'pending',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        expires_at varchar(64) NOT NULL DEFAULT '',
        approved_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_authorization_request_status"
      ON ${schemaRef}."passport_authorization_requests" (status, expires_at)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_authorization_codes" (
        code varchar(128) PRIMARY KEY,
        request_id varchar(128) NOT NULL,
        subject_id varchar(128) NOT NULL,
        wallet_address varchar(128) NOT NULL DEFAULT '',
        app_id varchar(128) NOT NULL,
        redirect_uri text NOT NULL,
        state text NOT NULL DEFAULT '',
        code_challenge varchar(128) NOT NULL,
        code_challenge_method varchar(16) NOT NULL DEFAULT 'S256',
        created_at varchar(64) NOT NULL DEFAULT '',
        expires_at varchar(64) NOT NULL DEFAULT '',
        used boolean NOT NULL DEFAULT false,
        used_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_authorization_code_request"
      ON ${schemaRef}."passport_authorization_codes" (request_id)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_audit_logs" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_id varchar(128) NOT NULL DEFAULT '',
        wallet_address varchar(128) NOT NULL DEFAULT '',
        request_id varchar(128) NOT NULL DEFAULT '',
        app_id varchar(128) NOT NULL DEFAULT '',
        action varchar(64) NOT NULL,
        level varchar(32) NOT NULL DEFAULT 'info',
        metadata_json text NOT NULL DEFAULT '{}',
        created_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_audit_subject_created_at"
      ON ${schemaRef}."passport_audit_logs" (subject_id, created_at)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_audit_request_created_at"
      ON ${schemaRef}."passport_audit_logs" (request_id, created_at)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddPassportIdentity20260803100000 only supports postgres, got ${dbType}`)
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_audit_request_created_at"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_audit_subject_created_at"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_audit_logs"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_authorization_code_request"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_authorization_codes"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_authorization_request_status"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_authorization_requests"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_webauthn_challenge_expires_at"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_webauthn_challenges"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_passkey_credentials_subject"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_passkey_credentials"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_wallet_binding_subject"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_passport_wallet_binding_address"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_wallet_bindings"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_subjects"`)
  }
}
