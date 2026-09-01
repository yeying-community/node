import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddPusherCore20260901120000 implements MigrationInterface {
  name = 'AddPusherCore20260901120000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddPusherCore20260901120000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."pusher_apps" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        app_id varchar(64) NOT NULL,
        key varchar(128) NOT NULL,
        secret_masked varchar(128) NOT NULL DEFAULT '',
        secret_ciphertext text NOT NULL,
        allowed_origins_json text NOT NULL DEFAULT '[]',
        channel_patterns_json text NOT NULL DEFAULT '[]',
        status varchar(32) NOT NULL DEFAULT 'active',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_pusher_app_id"
      ON ${schemaRef}."pusher_apps" ("app_id")
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_pusher_app_key"
      ON ${schemaRef}."pusher_apps" ("key")
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."pusher_events" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        app_id varchar(64) NOT NULL,
        event_id varchar(128) NOT NULL,
        type varchar(128) NOT NULL,
        source varchar(128) NOT NULL DEFAULT '',
        actor varchar(128) NOT NULL DEFAULT '',
        channels_json text NOT NULL DEFAULT '[]',
        data_json text NOT NULL DEFAULT '{}',
        notification_json text NOT NULL DEFAULT '{}',
        persist boolean NOT NULL DEFAULT false,
        created_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_pusher_event_app_event"
      ON ${schemaRef}."pusher_events" ("app_id", "event_id")
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pusher_event_app_created"
      ON ${schemaRef}."pusher_events" ("app_id", "created_at")
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."project_identity_mappings" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id varchar(128) NOT NULL,
        project_user_id varchar(128) NOT NULL,
        identity_did varchar(128) NOT NULL,
        wallet_address varchar(128) NOT NULL DEFAULT '',
        metadata_json text NOT NULL DEFAULT '{}',
        status varchar(32) NOT NULL DEFAULT 'active',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_project_identity_mapping_user"
      ON ${schemaRef}."project_identity_mappings" ("instance_id", "project_user_id")
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_identity_mapping_identity"
      ON ${schemaRef}."project_identity_mappings" ("instance_id", "identity_did")
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_project_identity_mapping_wallet"
      ON ${schemaRef}."project_identity_mappings" ("instance_id", "wallet_address")
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."email_templates" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id varchar(128) NOT NULL,
        version int NOT NULL DEFAULT 1,
        app_id varchar(128) NOT NULL DEFAULT '',
        category varchar(64) NOT NULL DEFAULT 'transactional',
        event_types_json text NOT NULL DEFAULT '[]',
        subject_json text NOT NULL,
        html_body_json text NOT NULL,
        text_body_json text NOT NULL,
        variables_json text NOT NULL DEFAULT '[]',
        enabled boolean NOT NULL DEFAULT true,
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_email_template_id_version"
      ON ${schemaRef}."email_templates" ("template_id", "version")
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."notification_preferences" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        subject varchar(128) NOT NULL,
        app_id varchar(128) NOT NULL DEFAULT '',
        event_type varchar(128) NOT NULL DEFAULT '',
        inbox_enabled boolean NOT NULL DEFAULT true,
        email_enabled boolean NOT NULL DEFAULT true,
        digest_mode varchar(32) NOT NULL DEFAULT 'disabled',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_notification_preference_subject_event"
      ON ${schemaRef}."notification_preferences" ("subject", "app_id", "event_type")
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddPusherCore20260901120000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_pusher_event_app_created"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_notification_preference_subject_event"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."notification_preferences"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_email_template_id_version"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."email_templates"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_project_identity_mapping_wallet"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_project_identity_mapping_identity"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_project_identity_mapping_user"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."project_identity_mappings"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_pusher_event_app_event"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."pusher_events"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_pusher_app_key"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_pusher_app_id"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."pusher_apps"`)
  }
}
