import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddNotificationWebhookFormat20260929100000 implements MigrationInterface {
  name = 'AddNotificationWebhookFormat20260929100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddNotificationWebhookFormat20260929100000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`ALTER TABLE ${schema}."notification_webhooks" ADD COLUMN IF NOT EXISTS "format" varchar(32) NOT NULL DEFAULT 'generic'`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddNotificationWebhookFormat20260929100000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`ALTER TABLE ${schema}."notification_webhooks" DROP COLUMN IF EXISTS "format"`)
  }
}
