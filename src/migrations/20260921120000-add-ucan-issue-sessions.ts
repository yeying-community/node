import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddUcanIssueSessions20260921120000 implements MigrationInterface {
  name = 'AddUcanIssueSessions20260921120000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddUcanIssueSessions20260921120000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schema}."ucan_issue_sessions" (
        session_hash varchar(128) PRIMARY KEY,
        subject varchar(128) NOT NULL,
        issuer_did varchar(128) NOT NULL,
        created_at varchar(64) NOT NULL,
        expires_at varchar(64) NOT NULL,
        last_used_at varchar(64) NOT NULL DEFAULT '',
        revoked_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_issue_session_subject" ON ${schema}."ucan_issue_sessions" (subject)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_ucan_issue_session_expires" ON ${schema}."ucan_issue_sessions" (expires_at)`)
  }

  async down(): Promise<void> {
    // Security records are retained during rollback.
  }
}
