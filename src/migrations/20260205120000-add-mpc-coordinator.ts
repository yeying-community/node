import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddMpcCoordinator20260205120000 implements MigrationInterface {
  name = 'AddMpcCoordinator20260205120000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddMpcCoordinator20260205120000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."mpc_sessions" (
        id varchar(64) PRIMARY KEY,
        type varchar(16) NOT NULL,
        wallet_id varchar(128) NOT NULL,
        threshold int NOT NULL DEFAULT 0,
        participants text NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT '',
        round int NOT NULL DEFAULT 0,
        curve varchar(32) NOT NULL DEFAULT '',
        key_version int NOT NULL DEFAULT 0,
        share_version int NOT NULL DEFAULT 0,
        created_at varchar(64) NOT NULL DEFAULT '',
        expires_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."mpc_session_participants" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id varchar(64) NOT NULL,
        participant_id varchar(64) NOT NULL,
        device_id varchar(128) NOT NULL,
        identity varchar(256) NOT NULL,
        e2e_public_key text NOT NULL,
        signing_public_key text NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'active',
        joined_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_participant_session"
      ON ${schemaRef}."mpc_session_participants" (session_id)
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uidx_mpc_participant_session"
      ON ${schemaRef}."mpc_session_participants" (session_id, participant_id)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."mpc_messages" (
        id varchar(64) PRIMARY KEY,
        session_id varchar(64) NOT NULL,
        sender varchar(64) NOT NULL,
        receiver varchar(64) NOT NULL DEFAULT '',
        round int NOT NULL DEFAULT 0,
        type varchar(64) NOT NULL,
        seq int NOT NULL DEFAULT 0,
        envelope text NOT NULL,
        created_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_message_session_time"
      ON ${schemaRef}."mpc_messages" (session_id, created_at)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_message_session_seq"
      ON ${schemaRef}."mpc_messages" (session_id, seq)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."mpc_sign_requests" (
        id varchar(64) PRIMARY KEY,
        wallet_id varchar(128) NOT NULL,
        session_id varchar(64) NOT NULL,
        initiator varchar(64) NOT NULL,
        payload_type varchar(32) NOT NULL,
        payload_hash varchar(256) NOT NULL,
        chain_id int NOT NULL DEFAULT 0,
        status varchar(32) NOT NULL DEFAULT '',
        approvals text NOT NULL DEFAULT '',
        signature text NOT NULL DEFAULT '',
        result_json text NOT NULL DEFAULT '{}',
        completed_at varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_sign_wallet"
      ON ${schemaRef}."mpc_sign_requests" (wallet_id)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_sign_session"
      ON ${schemaRef}."mpc_sign_requests" (session_id)
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."mpc_audit_logs" (
        id varchar(64) PRIMARY KEY,
        wallet_id varchar(128) NOT NULL,
        session_id varchar(64) NOT NULL,
        level varchar(16) NOT NULL,
        action varchar(64) NOT NULL,
        actor varchar(64) NOT NULL,
        message text NOT NULL,
        time varchar(64) NOT NULL,
        metadata text NOT NULL DEFAULT ''
      )
    `)

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_audit_wallet"
      ON ${schemaRef}."mpc_audit_logs" (wallet_id)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_audit_session"
      ON ${schemaRef}."mpc_audit_logs" (session_id)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mpc_audit_time"
      ON ${schemaRef}."mpc_audit_logs" (time)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddMpcCoordinator20260205120000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_audit_time"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_audit_session"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_audit_wallet"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."mpc_audit_logs"`)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_sign_session"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_sign_wallet"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."mpc_sign_requests"`)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_message_session_seq"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_message_session_time"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."mpc_messages"`)

    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."uidx_mpc_participant_session"`)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_mpc_participant_session"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."mpc_session_participants"`)

    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."mpc_sessions"`)
  }
}
