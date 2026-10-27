import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { AddIdentityEmailRegistrationResend20261018100000 } from '../src/migrations/20261018100000-add-identity-email-registration-resend'

const TEST_DATABASE_URL = String(process.env.TEST_DATABASE_URL || '').trim()

describe('identity email auth resend migration', () => {
  const runCase = TEST_DATABASE_URL ? it : it.skip

  runCase('adds resend fields and backfills last_sent_at in PostgreSQL', async () => {
    const schema = `migration_test_${randomUUID().replace(/-/g, '')}`
    const admin = new DataSource({ type: 'postgres', url: TEST_DATABASE_URL })
    let scoped: DataSource | null = null

    await admin.initialize()
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      scoped = new DataSource({ type: 'postgres', url: TEST_DATABASE_URL, schema })
      await scoped.initialize()

      const queryRunner = scoped.createQueryRunner()
      try {
        await queryRunner.query(`CREATE TABLE "${schema}"."identity_email_auth_challenges" (challenge_id varchar(128) PRIMARY KEY, created_at varchar(64) NOT NULL)`)
        await queryRunner.query(
          `INSERT INTO "${schema}"."identity_email_auth_challenges" (challenge_id, created_at) VALUES ($1, $2)`,
          ['challenge-1', '2026-10-18T10:00:00.000Z'],
        )

        await new AddIdentityEmailRegistrationResend20261018100000().up(queryRunner)

        const columns = await queryRunner.query(
          'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
          [schema, 'identity_email_auth_challenges'],
        )
        expect(columns.map((column: { column_name: string }) => column.column_name)).toEqual(expect.arrayContaining([
          'last_sent_at',
          'resend_count',
        ]))

        const rows = await queryRunner.query(
          `SELECT last_sent_at, resend_count FROM "${schema}"."identity_email_auth_challenges" WHERE challenge_id = $1`,
          ['challenge-1'],
        )
        expect(rows).toEqual([{ last_sent_at: '2026-10-18T10:00:00.000Z', resend_count: 0 }])
      } finally {
        await queryRunner.release()
      }
    } finally {
      if (scoped?.isInitialized) await scoped.destroy()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.destroy()
    }
  })
})
