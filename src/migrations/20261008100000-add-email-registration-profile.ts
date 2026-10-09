import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddEmailRegistrationProfile20261008100000 implements MigrationInterface {
  name = 'AddEmailRegistrationProfile20261008100000'

  async up(q: QueryRunner): Promise<void> {
    if (q.connection.options.type !== 'postgres') throw new Error('AddEmailRegistrationProfile20261008100000 only supports postgres')
    const schema = q.connection.options.schema || 'public'
    const s = `"${String(schema).replace(/"/g, '""')}"`
    await q.query(`ALTER TABLE ${s}."identity_email_auth_challenges" ADD COLUMN IF NOT EXISTS username varchar(32) NOT NULL DEFAULT ''`)
    await q.query(`ALTER TABLE ${s}."identity_email_auth_challenges" ADD COLUMN IF NOT EXISTS avatar_uri varchar(2048) NOT NULL DEFAULT ''`)
  }

  async down(): Promise<void> {
    // Keep registration profile data during rollback; removal is explicit.
  }
}
