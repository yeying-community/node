import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddPassportSubjectEmailAndScopes20260809090000 implements MigrationInterface {
  name = 'AddPassportSubjectEmailAndScopes20260809090000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddPassportSubjectEmailAndScopes20260809090000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_subjects" ADD COLUMN IF NOT EXISTS email varchar(320) NOT NULL DEFAULT ''`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_subjects" ADD COLUMN IF NOT EXISTS email_status varchar(32) NOT NULL DEFAULT 'unverified'`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_subjects" ADD COLUMN IF NOT EXISTS email_verified_at varchar(64) NOT NULL DEFAULT ''`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_authorization_requests" ADD COLUMN IF NOT EXISTS scopes_json text NOT NULL DEFAULT '["identity.basic","identity.wallet"]'`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_authorization_codes" ADD COLUMN IF NOT EXISTS scopes_json text NOT NULL DEFAULT '["identity.basic","identity.wallet"]'`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_authorization_codes" DROP COLUMN IF EXISTS scopes_json`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_authorization_requests" DROP COLUMN IF EXISTS scopes_json`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_subjects" DROP COLUMN IF EXISTS email_verified_at`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_subjects" DROP COLUMN IF EXISTS email_status`)
    await queryRunner.query(`ALTER TABLE ${ref}."passport_subjects" DROP COLUMN IF EXISTS email`)
  }
}
