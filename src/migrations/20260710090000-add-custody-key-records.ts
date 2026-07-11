import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddCustodyKeyRecords20260710090000 implements MigrationInterface {
  name = 'AddCustodyKeyRecords20260710090000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddCustodyKeyRecords20260710090000 only supports postgres, got ${dbType}`)
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."custody_key_records" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_type varchar(64) NOT NULL DEFAULT 'wallet_address',
        subject_id varchar(128) NOT NULL,
        wallet_id varchar(128) NOT NULL,
        account_id varchar(128) NOT NULL DEFAULT '',
        address varchar(128) NOT NULL DEFAULT '',
        ciphertext text NOT NULL,
        metadata_json text NOT NULL DEFAULT '{}',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        last_verified_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_custody_key_records_subject"
      ON ${schemaRef}."custody_key_records" (subject_type, subject_id)
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_custody_key_records_subject_wallet"
      ON ${schemaRef}."custody_key_records" (subject_type, subject_id, wallet_id)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddCustodyKeyRecords20260710090000 only supports postgres, got ${dbType}`)
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_custody_key_records_subject_wallet"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_custody_key_records_subject"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."custody_key_records"`)
  }
}

