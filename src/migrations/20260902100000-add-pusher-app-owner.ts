import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddPusherAppOwner20260902100000 implements MigrationInterface {
  name = 'AddPusherAppOwner20260902100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddPusherAppOwner20260902100000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."pusher_apps"
      ADD COLUMN IF NOT EXISTS "application_uid" varchar(128) NOT NULL DEFAULT ''
    `)
    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."pusher_apps"
      ADD COLUMN IF NOT EXISTS "owner" varchar(128) NOT NULL DEFAULT ''
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_pusher_app_application_uid"
      ON ${schemaRef}."pusher_apps" ("application_uid")
      WHERE "application_uid" <> ''
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pusher_app_owner"
      ON ${schemaRef}."pusher_apps" ("owner")
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddPusherAppOwner20260902100000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_pusher_app_owner"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_pusher_app_application_uid"`)
    await queryRunner.query(`ALTER TABLE ${schemaRef}."pusher_apps" DROP COLUMN IF EXISTS "owner"`)
    await queryRunner.query(`ALTER TABLE ${schemaRef}."pusher_apps" DROP COLUMN IF EXISTS "application_uid"`)
  }
}
