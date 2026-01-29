import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddApplicationConfig20260128195500 implements MigrationInterface {
  name = 'AddApplicationConfig20260128195500'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddApplicationConfig20260128195500 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."application_configs" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        application_uid varchar(64) NOT NULL,
        application_did varchar(128) NOT NULL,
        application_version int NOT NULL,
        applicant varchar(128) NOT NULL,
        config_json text NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_application_config_owner"
      ON ${schemaRef}."application_configs" (application_uid, applicant)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddApplicationConfig20260128195500 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_application_config_owner"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."application_configs"`)
  }
}
