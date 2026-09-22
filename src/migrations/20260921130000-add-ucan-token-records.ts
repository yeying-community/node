import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddUcanTokenRecords20260921130000 implements MigrationInterface {
  name = 'AddUcanTokenRecords20260921130000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddUcanTokenRecords20260921130000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."ucan_issued_tokens" (token_id varchar(128) PRIMARY KEY, session_hash varchar(128) NOT NULL DEFAULT '', subject varchar(128) NOT NULL, issuer_did varchar(128) NOT NULL, audience varchar(512) NOT NULL, capabilities_json text NOT NULL DEFAULT '[]', token_hash varchar(128) NOT NULL, created_at varchar(64) NOT NULL, not_before varchar(64) NOT NULL, expires_at varchar(64) NOT NULL)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_issued_token_session" ON ${ref}."ucan_issued_tokens" (session_hash)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_issued_token_expires" ON ${ref}."ucan_issued_tokens" (expires_at)`)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."ucan_token_revocations" (token_id varchar(128) PRIMARY KEY, session_hash varchar(128) NOT NULL DEFAULT '', subject varchar(128) NOT NULL DEFAULT '', issuer_did varchar(128) NOT NULL DEFAULT '', revoked_at varchar(64) NOT NULL, reason varchar(128) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_token_revocation_session" ON ${ref}."ucan_token_revocations" (session_hash)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_token_revocation_revoked" ON ${ref}."ucan_token_revocations" (revoked_at)`)
  }

  async down(): Promise<void> {
    // Security records are retained during rollback.
  }
}
