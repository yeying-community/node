import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class AddTotpSubjectSecrets20260423182000 implements MigrationInterface {
  name = 'AddTotpSubjectSecrets20260423182000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddTotpSubjectSecrets20260423182000 only supports postgres, got ${dbType}`
      )
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${schemaRef}."totp_subject_secrets" (
        subject varchar(128) PRIMARY KEY,
        secret_ciphertext text NOT NULL DEFAULT '',
        is_bound boolean NOT NULL DEFAULT false,
        created_at varchar(64) NOT NULL DEFAULT '',
        updated_at varchar(64) NOT NULL DEFAULT '',
        bound_at varchar(64) NOT NULL DEFAULT ''
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(
        `AddTotpSubjectSecrets20260423182000 only supports postgres, got ${dbType}`
      )
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`DROP TABLE IF EXISTS ${schemaRef}."totp_subject_secrets"`)
  }
}

