import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWalletIdentityLinkChallenges20260813100000 implements MigrationInterface {
  name = 'AddWalletIdentityLinkChallenges20260813100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddWalletIdentityLinkChallenges20260813100000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${schema}."identity_account_link_challenges" (nonce varchar(128) PRIMARY KEY, identity_did varchar(128) NOT NULL, chain_key varchar(64) NOT NULL, account_id varchar(128) NOT NULL, issued_at varchar(64) NOT NULL, expires_at varchar(64) NOT NULL, status varchar(32) NOT NULL DEFAULT 'pending', consumed_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_identity_link_challenge_expires" ON ${schema}."identity_account_link_challenges" (status, expires_at)`)
  }

  async down(): Promise<void> {
    // Identity challenge history is retained during rollback.
  }
}
