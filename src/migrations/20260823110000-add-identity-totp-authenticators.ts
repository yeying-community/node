import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityTotpAuthenticators20260823110000 implements MigrationInterface {
  name = 'AddIdentityTotpAuthenticators20260823110000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddIdentityTotpAuthenticators20260823110000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schema}."identity_totp_authenticators" (
        identity_did varchar(128) PRIMARY KEY,
        secret_ciphertext text NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'pending',
        device_name varchar(255) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        confirmed_at varchar(64) NOT NULL DEFAULT '',
        last_used_at varchar(64) NOT NULL DEFAULT '',
        revoked_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddIdentityTotpAuthenticators20260823110000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`DROP TABLE IF EXISTS ${schema}."identity_totp_authenticators"`)
  }
}
