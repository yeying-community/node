import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddPasskeyAuth20260622100000 implements MigrationInterface {
  name = 'AddPasskeyAuth20260622100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddPasskeyAuth20260622100000 only supports postgres, got ${dbType}`
      )
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passkey_subject_credentials" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_type varchar(64) NOT NULL DEFAULT 'wallet_address',
        subject_id varchar(128) NOT NULL,
        credential_id text NOT NULL UNIQUE,
        public_key text NOT NULL DEFAULT '',
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
      CREATE INDEX IF NOT EXISTS "idx_passkey_subject_credentials_subject"
      ON ${schemaRef}."passkey_subject_credentials" (subject_type, subject_id)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddPasskeyAuth20260622100000 only supports postgres, got ${dbType}`
      )
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      DROP INDEX IF EXISTS ${schemaRef}."idx_passkey_subject_credentials_subject"
    `)

    await queryRunner.query(`
      DROP TABLE IF EXISTS ${schemaRef}."passkey_subject_credentials"
    `)
  }
}
