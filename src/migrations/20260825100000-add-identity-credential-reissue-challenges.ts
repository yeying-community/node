import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityCredentialReissueChallenges20260825100000 implements MigrationInterface {
  name = 'AddIdentityCredentialReissueChallenges20260825100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddIdentityCredentialReissueChallenges20260825100000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schema}."identity_credential_reissue_challenges" (
        challenge_id varchar(64) PRIMARY KEY,
        identity_did varchar(128) NOT NULL,
        types_json text NOT NULL,
        nonce varchar(128) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'pending',
        issued_at varchar(64) NOT NULL,
        expires_at varchar(64) NOT NULL,
        consumed_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_credential_reissue_expires" ON ${schema}."identity_credential_reissue_challenges" (status, expires_at)`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddIdentityCredentialReissueChallenges20260825100000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`DROP TABLE IF EXISTS ${schema}."identity_credential_reissue_challenges"`)
  }
}
