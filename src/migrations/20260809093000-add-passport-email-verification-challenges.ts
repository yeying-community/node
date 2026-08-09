import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddPassportEmailVerificationChallenges20260809093000 implements MigrationInterface {
  name = 'AddPassportEmailVerificationChallenges20260809093000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddPassportEmailVerificationChallenges20260809093000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS ${ref}."passport_email_verification_challenges" (verification_id varchar(128) PRIMARY KEY, subject_id varchar(128) NOT NULL, email varchar(320) NOT NULL, code_hash varchar(128) NOT NULL, attempts integer NOT NULL DEFAULT 0, status varchar(32) NOT NULL DEFAULT 'pending', created_at varchar(64) NOT NULL DEFAULT '', expires_at varchar(64) NOT NULL DEFAULT '', verified_at varchar(64) NOT NULL DEFAULT '')`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_passport_email_verification_subject_created" ON ${ref}."passport_email_verification_challenges" (subject_id, created_at)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_passport_email_verification_expires" ON ${ref}."passport_email_verification_challenges" (status, expires_at)`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(`DROP TABLE IF EXISTS ${ref}."passport_email_verification_challenges"`)
  }
}
