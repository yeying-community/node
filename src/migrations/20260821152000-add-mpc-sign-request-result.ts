import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddMpcSignRequestResult20260821152000 implements MigrationInterface {
  name = 'AddMpcSignRequestResult20260821152000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddMpcSignRequestResult20260821152000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."mpc_sign_requests"
      ADD COLUMN IF NOT EXISTS signature text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS result_json text NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS completed_at varchar(64) NOT NULL DEFAULT ''
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddMpcSignRequestResult20260821152000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."mpc_sign_requests"
      DROP COLUMN IF EXISTS completed_at,
      DROP COLUMN IF EXISTS result_json,
      DROP COLUMN IF EXISTS signature
    `)
  }
}
