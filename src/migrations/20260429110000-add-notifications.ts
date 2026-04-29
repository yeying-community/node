import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddNotifications20260429110000 implements MigrationInterface {
  name = 'AddNotifications20260429110000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddNotifications20260429110000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."notifications" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(128) NOT NULL,
        source varchar(64) NOT NULL,
        subject_type varchar(64) NOT NULL,
        subject_id varchar(128) NOT NULL,
        actor varchar(128) NOT NULL DEFAULT '',
        audience_type varchar(64) NOT NULL DEFAULT 'user',
        audience_ids text NOT NULL DEFAULT '',
        level varchar(32) NOT NULL DEFAULT 'info',
        title varchar(256) NOT NULL,
        body text NOT NULL DEFAULT '',
        payload text NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'delivered',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        expires_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_type_created_at"
      ON ${schemaRef}."notifications" ("type", "created_at")
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."notification_inboxes" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_uid uuid NOT NULL,
        recipient varchar(128) NOT NULL,
        recipient_type varchar(32) NOT NULL DEFAULT 'user',
        is_read boolean NOT NULL DEFAULT false,
        read_at varchar(64) NOT NULL DEFAULT '',
        delivered_at varchar(64) NOT NULL DEFAULT '',
        archived_at varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_inbox_recipient_created_at"
      ON ${schemaRef}."notification_inboxes" ("recipient", "created_at")
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_inbox_notification_uid"
      ON ${schemaRef}."notification_inboxes" ("notification_uid")
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddNotifications20260429110000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(
      `DROP INDEX IF EXISTS ${schemaRef}."idx_notification_inbox_notification_uid"`
    )
    await queryRunner.query(
      `DROP INDEX IF EXISTS ${schemaRef}."idx_notification_inbox_recipient_created_at"`
    )
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."notification_inboxes"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_notification_type_created_at"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."notifications"`)
  }
}
