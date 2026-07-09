import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class RepairNotificationDeliveryWebhookColumns20260701130000 implements MigrationInterface {
  name = 'RepairNotificationDeliveryWebhookColumns20260701130000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`RepairNotificationDeliveryWebhookColumns20260701130000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."notification_webhooks" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner varchar(128) NOT NULL DEFAULT '',
        target_url text NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."notification_webhooks"
        ADD COLUMN IF NOT EXISTS "owner" varchar(128) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "application_uid" varchar(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "events_json" text NOT NULL DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS "target_url" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "secret_masked" varchar(128) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "secret_ciphertext" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "last_triggered_at" varchar(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "created_at" varchar(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "updated_at" varchar(64) NOT NULL DEFAULT ''
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_webhook_owner_application"
      ON ${schemaRef}."notification_webhooks" ("owner", "application_uid")
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."notification_deliveries" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        notification_uid uuid NOT NULL,
        channel varchar(64) NOT NULL DEFAULT 'inbox',
        target text NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'pending',
        created_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."notification_deliveries"
        ADD COLUMN IF NOT EXISTS "webhook_uid" varchar(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "lock_token" varchar(128) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "locked_at" varchar(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "attempt_count" int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "last_error" text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "delivered_at" varchar(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "next_retry_at" varchar(64) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS "updated_at" varchar(64) NOT NULL DEFAULT ''
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

  async down(): Promise<void> {
    // Intentionally irreversible: this migration repairs drifted local schemas
    // without removing columns that application code now expects.
  }
}
