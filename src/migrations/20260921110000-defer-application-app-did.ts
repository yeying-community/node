import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * appDid is a future application-signing identity. The current release model
 * must not require or persist it; historical rows created by the first draft
 * of the release migration may still contain the unused compatibility column.
 */
export class DeferApplicationAppDid20260921110000 implements MigrationInterface {
  name = 'DeferApplicationAppDid20260921110000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(
      `ALTER TABLE ${ref}."application_releases" DROP COLUMN IF EXISTS "app_did"`
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') return
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const ref = quoteIdent(schema)
    await queryRunner.query(
      `ALTER TABLE ${ref}."application_releases" ADD COLUMN IF NOT EXISTS "app_did" varchar(128) NOT NULL DEFAULT ''`
    )
  }
}
