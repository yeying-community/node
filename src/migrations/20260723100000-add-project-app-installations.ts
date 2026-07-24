import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddProjectAppInstallations20260723100000 implements MigrationInterface {
  name = 'AddProjectAppInstallations20260723100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."project_instances" (
      "instance_id" varchar(128) PRIMARY KEY,
      "project_api_url" text NOT NULL,
      "status" varchar(64) NOT NULL DEFAULT 'active',
      "created_at" varchar(64) NOT NULL DEFAULT '',
      "updated_at" varchar(64) NOT NULL DEFAULT ''
    )`)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."project_app_installations" (
      "uid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "instance_id" varchar(128) NOT NULL,
      "app_id" varchar(128) NOT NULL,
      "install_version" varchar(64) NOT NULL,
      "status" varchar(32) NOT NULL DEFAULT 'pending',
      "menu_items_json" text NOT NULL DEFAULT '[]',
      "runtime_config_json" text NOT NULL DEFAULT '{}',
      "install_at" varchar(64) NOT NULL DEFAULT '',
      "updated_at" varchar(64) NOT NULL DEFAULT ''
    )`)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_project_app_installation"
      ON ${ref}."project_app_installations" ("instance_id", "app_id")`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`DROP TABLE IF EXISTS ${ref}."project_app_installations"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${ref}."project_instances"`)
  }
}
