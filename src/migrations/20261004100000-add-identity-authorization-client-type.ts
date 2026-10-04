import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityAuthorizationClientType20261004100000 implements MigrationInterface {
  name = 'AddIdentityAuthorizationClientType20261004100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddIdentityAuthorizationClientType20261004100000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = `"${String(queryRunner.connection.options.schema || 'public').replace(/"/g, '""')}"`
    await queryRunner.query(`ALTER TABLE ${schema}."identity_authorization_requests" ADD COLUMN IF NOT EXISTS client_type varchar(16) NOT NULL DEFAULT 'web'`)
  }

  async down(): Promise<void> {
    // Keep authorization history during rollback.
  }
}
