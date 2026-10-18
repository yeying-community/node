import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddIdentityEmailRegistrationResend20261018100000 implements MigrationInterface {
  name = 'AddIdentityEmailRegistrationResend20261018100000'

  async up(q: QueryRunner): Promise<void> {
    if (q.connection.options.type !== 'postgres') throw new Error('AddIdentityEmailRegistrationResend20261018100000 only supports postgres')
    const schema = q.connection.options.schema || 'public'
    const s = `"${String(schema).replace(/"/g, '""')}"`
    await q.query(`ALTER TABLE ${s}."identity_email_auth_challenges" ADD COLUMN IF NOT EXISTS last_sent_at varchar(64) NOT NULL DEFAULT ''`)
    await q.query(`ALTER TABLE ${s}."identity_email_auth_challenges" ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0`)
    await q.query(`UPDATE ${s}."identity_email_auth_challenges" SET last_sent_at = created_at WHERE last_sent_at = ''`)
  }

  async down(q: QueryRunner): Promise<void> {
    if (q.connection.options.type !== 'postgres') throw new Error('AddIdentityEmailRegistrationResend20261018100000 only supports postgres')
    const schema = q.connection.options.schema || 'public'
    const s = `"${String(schema).replace(/"/g, '""')}"`
    await q.query(`ALTER TABLE ${s}."identity_email_auth_challenges" DROP COLUMN IF EXISTS resend_count`)
    await q.query(`ALTER TABLE ${s}."identity_email_auth_challenges" DROP COLUMN IF EXISTS last_sent_at`)
  }
}
