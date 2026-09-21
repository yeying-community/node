import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddApplicationVersionReleases20260921100000 implements MigrationInterface {
  name = 'AddApplicationVersionReleases20260921100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."application_releases" (
      "uid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "application_uid" varchar(64) NOT NULL,
      "version" int NOT NULL,
      "metadata_json" text NOT NULL DEFAULT '{}',
      "release_digest" varchar(128) NOT NULL DEFAULT '',
      "signature" text NOT NULL DEFAULT '',
      "status" varchar(64) NOT NULL DEFAULT 'draft',
      "created_at" varchar(64) NOT NULL DEFAULT '',
      "updated_at" varchar(64) NOT NULL DEFAULT ''
    )`)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_application_release_application_version"
      ON ${ref}."application_releases" ("application_uid", "version")`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_application_release_application"
      ON ${ref}."application_releases" ("application_uid")`)

    // Existing application rows represent the versions that are already
    // published or being reviewed. Preserve them before the parent row starts
    // carrying the current version of a stable application.
    await queryRunner.query(`
      INSERT INTO ${ref}."application_releases" (
        "application_uid", "version", "metadata_json", "signature", "status", "created_at", "updated_at"
      )
      SELECT
        a."uid"::text,
        a."version",
        json_build_object(
          'uid', a."uid",
          'owner', a."owner",
          'ownerName', a."owner_name",
          'network', a."network",
          'address', a."address",
          'did', a."did",
          'version', a."version",
          'name', a."name",
          'description', a."description",
          'code', a."code",
          'location', a."location",
          'serviceCodes', a."service_codes",
          'redirectUris', a."redirect_uris",
          'ucanAudience', a."ucan_audience",
          'ucanCapabilities', a."ucan_capabilities",
          'avatar', a."avatar",
          'codePackagePath', a."code_package_path",
          'createdAt', a."created_at",
          'updatedAt', a."updated_at",
          'signature', a."signature",
          'status', a."status",
          'isOnline', a."is_online"
        )::text,
        a."signature",
        CASE WHEN a."is_online" THEN 'published' ELSE 'draft' END,
        a."created_at",
        a."updated_at"
      FROM ${ref}."applications" a
      ON CONFLICT ("application_uid", "version") DO NOTHING
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    await queryRunner.query(`DROP TABLE IF EXISTS ${quoteIdent(schema)}."application_releases"`)
  }
}
