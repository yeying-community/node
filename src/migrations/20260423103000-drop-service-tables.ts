import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class DropServiceTables20260423103000 implements MigrationInterface {
  name = 'DropServiceTables20260423103000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`DropServiceTables20260423103000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."service_configs"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."services"`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`DropServiceTables20260423103000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."services" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        did varchar(128) NOT NULL,
        version int NOT NULL,
        owner varchar(128) NOT NULL,
        owner_name varchar(128) NOT NULL,
        network varchar(64) NOT NULL,
        address varchar(128) NOT NULL,
        name varchar(64) NOT NULL,
        description text NOT NULL,
        code varchar(64) NOT NULL,
        api_codes text NOT NULL,
        proxy text NOT NULL,
        grpc text NOT NULL,
        avatar text NOT NULL,
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        signature varchar(192) NOT NULL DEFAULT '',
        code_package_path text NOT NULL DEFAULT '',
        status varchar(64) NOT NULL DEFAULT 'BUSINESS_STATUS_PENDING',
        is_online boolean NOT NULL DEFAULT false
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."service_configs" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        service_uid varchar(128) NOT NULL,
        service_did varchar(128) NOT NULL,
        service_version int NOT NULL,
        applicant varchar(128) NOT NULL,
        config_json text NOT NULL DEFAULT '[]',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_service_config_unique"
      ON ${schemaRef}."service_configs" (service_uid, applicant)
    `)
  }
}
