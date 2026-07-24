import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddAppReleases20260723110000 implements MigrationInterface {
  name = 'AddAppReleases20260723110000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."app_releases" (
      "uid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "app_id" varchar(128) NOT NULL,
      "version" varchar(64) NOT NULL,
      "publisher" varchar(128) NOT NULL,
      "publisher_key_id" varchar(128) NOT NULL,
      "release_digest" varchar(71) NOT NULL,
      "image" text NOT NULL,
      "status" varchar(32) NOT NULL DEFAULT 'submitted',
      "artifact_path" text NOT NULL,
      "validation_json" text NOT NULL DEFAULT '{}',
      "created_at" varchar(64) NOT NULL DEFAULT '',
      "updated_at" varchar(64) NOT NULL DEFAULT ''
    )`)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_release_version"
      ON ${ref}."app_releases" ("app_id", "version")`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    await queryRunner.query(`DROP TABLE IF EXISTS ${quoteIdent(schema)}."app_releases"`)
  }
}
