import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityVerificationAvatarUri20260825110000 implements MigrationInterface {
  name = 'AddIdentityVerificationAvatarUri20260825110000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddIdentityVerificationAvatarUri20260825110000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`ALTER TABLE ${schema}."identity_verification_transactions" ADD COLUMN IF NOT EXISTS avatar_uri varchar(2048) NOT NULL DEFAULT ''`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('AddIdentityVerificationAvatarUri20260825110000 only supports postgres')
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`ALTER TABLE ${schema}."identity_verification_transactions" DROP COLUMN IF EXISTS avatar_uri`)
  }
}
