import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddNotificationWebhooksAndDeliveries20260624090000 implements MigrationInterface {
  name = 'AddNotificationWebhooksAndDeliveries20260624090000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddNotificationWebhooksAndDeliveries20260624090000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."notification_webhooks" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner varchar(128) NOT NULL,
        application_uid varchar(64) NOT NULL DEFAULT '',
        events_json text NOT NULL DEFAULT '[]',
        target_url text NOT NULL,
        secret_masked varchar(128) NOT NULL DEFAULT '',
        secret_ciphertext text NOT NULL DEFAULT '',
        enabled boolean NOT NULL DEFAULT true,
        last_triggered_at varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_webhook_owner_application"
      ON ${schemaRef}."notification_webhooks" ("owner", "application_uid")
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."notification_deliveries" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        webhook_uid varchar(64) NOT NULL DEFAULT '',
        notification_uid uuid NOT NULL,
        channel varchar(64) NOT NULL DEFAULT 'inbox',
        target text NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'pending',
        lock_token varchar(128) NOT NULL DEFAULT '',
        locked_at varchar(64) NOT NULL DEFAULT '',
        attempt_count int NOT NULL DEFAULT 0,
        last_error text NOT NULL DEFAULT '',
        delivered_at varchar(64) NOT NULL DEFAULT '',
        next_retry_at varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_delivery_notification_uid"
      ON ${schemaRef}."notification_deliveries" ("notification_uid")
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_delivery_webhook_uid"
      ON ${schemaRef}."notification_deliveries" ("webhook_uid")
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_delivery_channel_status"
      ON ${schemaRef}."notification_deliveries" ("channel", "status")
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_delivery_status_locked_at"
      ON ${schemaRef}."notification_deliveries" ("status", "locked_at")
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddNotificationWebhooksAndDeliveries20260624090000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_notification_delivery_channel_status"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_notification_delivery_status_locked_at"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_notification_delivery_webhook_uid"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_notification_delivery_notification_uid"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."notification_deliveries"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_notification_webhook_owner_application"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."notification_webhooks"`)
  }
}
