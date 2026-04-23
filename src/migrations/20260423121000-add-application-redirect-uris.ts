import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddApplicationRedirectUris20260423121000 implements MigrationInterface {
  name = 'AddApplicationRedirectUris20260423121000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddApplicationRedirectUris20260423121000 only supports postgres, got ${dbType}`
      )
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."applications"
      ADD COLUMN IF NOT EXISTS redirect_uris text NOT NULL DEFAULT ''
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddApplicationRedirectUris20260423121000 only supports postgres, got ${dbType}`
      )
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."applications"
      DROP COLUMN IF EXISTS redirect_uris
    `)
  }
}

