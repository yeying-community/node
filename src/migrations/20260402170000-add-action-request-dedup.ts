import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddActionRequestDedup20260402170000 implements MigrationInterface {
  name = 'AddActionRequestDedup20260402170000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddActionRequestDedup20260402170000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."action_requests" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor varchar(128) NOT NULL,
        action varchar(64) NOT NULL,
        request_id varchar(128) NOT NULL,
        payload_hash varchar(64) NOT NULL,
        signed_at varchar(64) NOT NULL,
        signature varchar(192) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'pending',
        response_code int NOT NULL DEFAULT 0,
        response_body text NOT NULL DEFAULT '',
        completed_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."action_requests"
      ADD COLUMN IF NOT EXISTS status varchar(32) NOT NULL DEFAULT 'pending'
    `)
    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."action_requests"
      ADD COLUMN IF NOT EXISTS response_code int NOT NULL DEFAULT 0
    `)
    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."action_requests"
      ADD COLUMN IF NOT EXISTS response_body text NOT NULL DEFAULT ''
    `)
    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."action_requests"
      ADD COLUMN IF NOT EXISTS completed_at varchar(64) NOT NULL DEFAULT ''
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_action_request_dedup"
      ON ${schemaRef}."action_requests" (actor, request_id)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddActionRequestDedup20260402170000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_action_request_dedup"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."action_requests"`)
  }
}
