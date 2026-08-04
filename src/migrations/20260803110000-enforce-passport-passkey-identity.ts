import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class EnforcePassportPasskeyIdentity20260803110000 implements MigrationInterface {
  name = 'EnforcePassportPasskeyIdentity20260803110000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`EnforcePassportPasskeyIdentity20260803110000 only supports postgres, got ${dbType}`)
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

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
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passkey_subject_credentials"`)
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible by design: the old wallet-address Passkey table is removed
    // and Passport subject credentials remain the only supported model.
  }
}
