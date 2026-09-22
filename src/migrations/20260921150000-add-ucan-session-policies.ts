import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddUcanSessionPolicies20260921150000 implements MigrationInterface {
  name = 'AddUcanSessionPolicies20260921150000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddUcanSessionPolicies20260921150000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`ALTER TABLE ${ref}."ucan_issue_sessions" ADD COLUMN IF NOT EXISTS allowed_audiences_json text NOT NULL DEFAULT '[]'`)
    await queryRunner.query(`ALTER TABLE ${ref}."ucan_issue_sessions" ADD COLUMN IF NOT EXISTS allowed_capabilities_json text NOT NULL DEFAULT '{}'`)
  }

  async down(): Promise<void> {
    // Security policy history is retained during rollback.
  }
}
