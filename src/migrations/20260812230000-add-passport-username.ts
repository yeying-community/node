import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddPassportUsername20260812230000 implements MigrationInterface {
  name = 'AddPassportUsername20260812230000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddPassportUsername20260812230000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = quoteIdent((queryRunner.connection.options.schema as string) || 'public')
    await queryRunner.query(`ALTER TABLE ${schema}."passport_subjects" ADD COLUMN IF NOT EXISTS username varchar(32) NOT NULL DEFAULT ''`)
    await queryRunner.query(`ALTER TABLE ${schema}."passport_subjects" ADD COLUMN IF NOT EXISTS username_verified_at varchar(64) NOT NULL DEFAULT ''`)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_passport_subject_username" ON ${schema}."passport_subjects" (username) WHERE username <> ''`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = quoteIdent((queryRunner.connection.options.schema as string) || 'public')
    await queryRunner.query(`DROP INDEX IF EXISTS ${schema}."uidx_passport_subject_username"`)
    await queryRunner.query(`ALTER TABLE ${schema}."passport_subjects" DROP COLUMN IF EXISTS username_verified_at`)
    await queryRunner.query(`ALTER TABLE ${schema}."passport_subjects" DROP COLUMN IF EXISTS username`)
  }
}
