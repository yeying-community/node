import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityAuthorizationSessions20260920100000 implements MigrationInterface {
  name = 'AddIdentityAuthorizationSessions20260920100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddIdentityAuthorizationSessions20260920100000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schema}."identity_authorization_sessions" (
        token_hash varchar(128) PRIMARY KEY,
        app_id varchar(128) NOT NULL,
        redirect_uri text NOT NULL,
        identity_did varchar(128) NOT NULL,
        subject varchar(128) NOT NULL,
        scopes_json text NOT NULL DEFAULT '[]',
        created_at varchar(64) NOT NULL,
        expires_at varchar(64) NOT NULL,
        last_used_at varchar(64) NOT NULL DEFAULT '',
        revoked_at varchar(64) NOT NULL DEFAULT '',
        replaced_by_hash varchar(128) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_authorization_session_identity" ON ${schema}."identity_authorization_sessions" (identity_did)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_authorization_session_expires" ON ${schema}."identity_authorization_sessions" (expires_at)`)
  }

  async down(): Promise<void> { /* Security records are retained during rollback. */ }
}
