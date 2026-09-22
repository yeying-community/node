import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddUcanAuditLogs20260921140000 implements MigrationInterface {
  name = 'AddUcanAuditLogs20260921140000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddUcanAuditLogs20260921140000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."ucan_audit_logs" (uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), action varchar(64) NOT NULL, outcome varchar(32) NOT NULL DEFAULT 'success', session_hash varchar(128) NOT NULL DEFAULT '', token_id varchar(128) NOT NULL DEFAULT '', subject varchar(128) NOT NULL DEFAULT '', issuer_did varchar(128) NOT NULL DEFAULT '', audience varchar(512) NOT NULL DEFAULT '', capabilities_json text NOT NULL DEFAULT '[]', metadata_json text NOT NULL DEFAULT '{}', created_at varchar(64) NOT NULL)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_audit_subject_created" ON ${ref}."ucan_audit_logs" (subject, created_at)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_audit_action_created" ON ${ref}."ucan_audit_logs" (action, created_at)`)
  }

  async down(): Promise<void> {
    // Audit records are retained during rollback.
  }
}
