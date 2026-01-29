import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddServiceConfig20260128194500 implements MigrationInterface {
  name = 'AddServiceConfig20260128194500'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddServiceConfig20260128194500 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."service_configs" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        service_uid varchar(64) NOT NULL,
        service_did varchar(128) NOT NULL,
        service_version int NOT NULL,
        applicant varchar(128) NOT NULL,
        config_json text NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_config_owner"
      ON ${schemaRef}."service_configs" (service_uid, applicant)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddServiceConfig20260128194500 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_service_config_owner"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."service_configs"`)
  }
}
