import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class RepairPassportWebauthnChallenges20260803120000 implements MigrationInterface {
  name = 'RepairPassportWebauthnChallenges20260803120000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`RepairPassportWebauthnChallenges20260803120000 only supports postgres, got ${dbType}`)
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."passport_webauthn_challenges" (
        challenge_id varchar(128) PRIMARY KEY,
        challenge_type varchar(32) NOT NULL,
        subject_id varchar(128) NOT NULL DEFAULT '',
        request_id varchar(128) NOT NULL DEFAULT '',
        challenge text NOT NULL,
        allowed_credential_ids text NOT NULL DEFAULT '[]',
        created_at varchar(64) NOT NULL DEFAULT '',
        expires_at varchar(64) NOT NULL DEFAULT '',
        used boolean NOT NULL DEFAULT false
      )
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_passport_webauthn_challenge_expires_at"
      ON ${schemaRef}."passport_webauthn_challenges" (expires_at)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`RepairPassportWebauthnChallenges20260803120000 only supports postgres, got ${dbType}`)
    }

    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)
    await queryRunner.query(`DROP INDEX IF EXISTS ${schemaRef}."idx_passport_webauthn_challenge_expires_at"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."passport_webauthn_challenges"`)
  }
}
