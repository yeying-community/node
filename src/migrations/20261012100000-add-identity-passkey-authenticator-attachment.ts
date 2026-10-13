import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityPasskeyAuthenticatorAttachment20261012100000 implements MigrationInterface {
  name = 'AddIdentityPasskeyAuthenticatorAttachment20261012100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddIdentityPasskeyAuthenticatorAttachment20261012100000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`ALTER TABLE ${schema}."identity_passkey_credentials" ADD COLUMN IF NOT EXISTS authenticator_attachment varchar(32) NOT NULL DEFAULT ''`)
  }

  async down(): Promise<void> {
    // Keep the recorded authenticator type during rollback.
  }
}
