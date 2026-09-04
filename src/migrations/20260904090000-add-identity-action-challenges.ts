import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityActionChallenges20260904090000 implements MigrationInterface {
  name = 'AddIdentityActionChallenges20260904090000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') throw new Error('AddIdentityActionChallenges20260904090000 only supports postgres')
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${schema}."identity_action_challenges" (challenge_id varchar(128) PRIMARY KEY, identity_did varchar(128) NOT NULL, action varchar(96) NOT NULL, audience varchar(512) NOT NULL, payload_hash varchar(64) NOT NULL, nonce varchar(128) NOT NULL, status varchar(32) NOT NULL DEFAULT 'pending', issued_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, consumed_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_action_challenge_status_expires" ON ${schema}."identity_action_challenges" (status, expires_at)`)
  }

  async down(): Promise<void> { /* Security records are retained during rollback. */ }
}
