import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddIdentitySessionUcanPolicy20260921160000 implements MigrationInterface {
  name = 'AddIdentitySessionUcanPolicy20260921160000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddIdentitySessionUcanPolicy20260921160000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`ALTER TABLE ${ref}."identity_authorization_sessions" ADD COLUMN IF NOT EXISTS ucan_allowed_audiences_json text NOT NULL DEFAULT '[]'`)
    await queryRunner.query(`ALTER TABLE ${ref}."identity_authorization_sessions" ADD COLUMN IF NOT EXISTS ucan_allowed_capabilities_json text NOT NULL DEFAULT '{}'`)
  }

  async down(): Promise<void> {
    // Security policy history is retained during rollback.
  }
}
