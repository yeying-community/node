import { MigrationInterface, QueryRunner } from 'typeorm'

function q(value: string) { return `"${value.replace(/"/g, '""')}"` }

export class AddAppRuntimeTasks20260724100000 implements MigrationInterface {
  name = 'AddAppRuntimeTasks20260724100000'
  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const ref = q((queryRunner.connection.options.schema as string) || 'public')
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."app_runtime_tasks" (
      "uid" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "instance_id" varchar(128) NOT NULL,
      "app_id" varchar(128) NOT NULL, "operation" varchar(32) NOT NULL,
      "target_version" varchar(64) NOT NULL, "release_digest" varchar(71) NOT NULL,
      "status" varchar(32) NOT NULL DEFAULT 'pending', "claimed_by" varchar(128) NOT NULL DEFAULT '',
      "lease_expires_at" varchar(64) NOT NULL DEFAULT '', "revision" int NOT NULL DEFAULT 1,
      "result_json" text NOT NULL DEFAULT '{}', "created_at" varchar(64) NOT NULL DEFAULT '',
      "updated_at" varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_app_runtime_task_queue" ON ${ref}."app_runtime_tasks" ("instance_id", "status", "created_at")`)
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    await queryRunner.query(`DROP TABLE IF EXISTS ${q((queryRunner.connection.options.schema as string) || 'public')}."app_runtime_tasks"`)
  }
}
