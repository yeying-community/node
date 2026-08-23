import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddMpcSessionResult20260821133000 implements MigrationInterface {
  name = 'AddMpcSessionResult20260821133000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddMpcSessionResult20260821133000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."mpc_sessions"
      ADD COLUMN IF NOT EXISTS result_json text NOT NULL DEFAULT '{}'
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddMpcSessionResult20260821133000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."mpc_sessions"
      DROP COLUMN IF EXISTS result_json
    `)
  }
}
