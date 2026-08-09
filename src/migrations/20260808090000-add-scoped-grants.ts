import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddScopedGrants20260808090000 implements MigrationInterface {
  name = 'AddScopedGrants20260808090000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddScopedGrants20260808090000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."scoped_grants" (grant_id varchar(128) PRIMARY KEY, subject_id varchar(128) NOT NULL, app_id varchar(128) NOT NULL, audience varchar(512) NOT NULL, capabilities_json text NOT NULL DEFAULT '[]', status varchar(64) NOT NULL DEFAULT 'active', created_at varchar(64) NOT NULL DEFAULT '', updated_at varchar(64) NOT NULL DEFAULT '', expires_at varchar(64) NOT NULL DEFAULT '', revoked_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scoped_grants_subject_status" ON ${ref}."scoped_grants" (subject_id, status)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scoped_grants_app_status" ON ${ref}."scoped_grants" (app_id, status)`)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."scoped_grant_tokens" (token_id varchar(128) PRIMARY KEY, grant_id varchar(128) NOT NULL, token_hash varchar(128) NOT NULL, audience varchar(512) NOT NULL, capabilities_json text NOT NULL DEFAULT '[]', status varchar(64) NOT NULL DEFAULT 'active', created_at varchar(64) NOT NULL DEFAULT '', expires_at varchar(64) NOT NULL DEFAULT '', revoked_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scoped_grant_tokens_grant" ON ${ref}."scoped_grant_tokens" (grant_id)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scoped_grant_tokens_status_expires" ON ${ref}."scoped_grant_tokens" (status, expires_at)`)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."scoped_grant_revocations" (uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), grant_id varchar(128) NOT NULL, token_id varchar(128) NOT NULL DEFAULT '', actor_subject_id varchar(128) NOT NULL DEFAULT '', revoked_at varchar(64) NOT NULL DEFAULT '', reason text NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scoped_grant_revocations_grant" ON ${ref}."scoped_grant_revocations" (grant_id)`)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."scoped_grant_audit_logs" (uid uuid PRIMARY KEY DEFAULT gen_random_uuid(), grant_id varchar(128) NOT NULL DEFAULT '', token_id varchar(128) NOT NULL DEFAULT '', subject_id varchar(128) NOT NULL DEFAULT '', app_id varchar(128) NOT NULL DEFAULT '', action varchar(64) NOT NULL, metadata_json text NOT NULL DEFAULT '{}', created_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scoped_grant_audit_grant_created" ON ${ref}."scoped_grant_audit_logs" (grant_id, created_at)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_scoped_grant_audit_subject_created" ON ${ref}."scoped_grant_audit_logs" (subject_id, created_at)`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`DROP TABLE IF EXISTS ${ref}."scoped_grant_audit_logs"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${ref}."scoped_grant_revocations"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${ref}."scoped_grant_tokens"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${ref}."scoped_grants"`)
  }
}
