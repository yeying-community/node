import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddApplicationUcanPolicy20260423193000 implements MigrationInterface {
  name = 'AddApplicationUcanPolicy20260423193000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddApplicationUcanPolicy20260423193000 only supports postgres, got ${dbType}`
      )
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."applications"
      ADD COLUMN IF NOT EXISTS ucan_audience text NOT NULL DEFAULT ''
    `)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."applications"
      ADD COLUMN IF NOT EXISTS ucan_capabilities text NOT NULL DEFAULT ''
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddApplicationUcanPolicy20260423193000 only supports postgres, got ${dbType}`
      )
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."applications"
      DROP COLUMN IF EXISTS ucan_capabilities
    `)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."applications"
      DROP COLUMN IF EXISTS ucan_audience
    `)
  }
}

