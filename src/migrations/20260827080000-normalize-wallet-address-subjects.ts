import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export class NormalizeWalletAddressSubjects20260827080000 implements MigrationInterface {
  name = 'NormalizeWalletAddressSubjects20260827080000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error('NormalizeWalletAddressSubjects20260827080000 only supports postgres')
    }

    const schema = quoteIdent(String(queryRunner.connection.options.schema || 'public'))

    await queryRunner.query(`
      DELETE FROM ${schema}."identity_account_links" target
      USING (
        SELECT uid
        FROM (
          SELECT
            uid,
            row_number() OVER (
              PARTITION BY identity_did, chain_key, lower(account_id)
              ORDER BY
                CASE WHEN status = 'active' AND coalesce(revoked_at, '') = '' THEN 0 ELSE 1 END,
                verified_at DESC,
                uid
            ) AS row_num
          FROM ${schema}."identity_account_links"
          WHERE chain_key LIKE 'eip155:%'
            AND account_id ~* '^0x[0-9a-f]{40}$'
        ) ranked
        WHERE row_num > 1
      ) duplicate
      WHERE target.uid = duplicate.uid
    `)

    await queryRunner.query(`
      UPDATE ${schema}."identity_account_links"
      SET account_id = lower(account_id)
      WHERE chain_key LIKE 'eip155:%'
        AND account_id ~* '^0x[0-9a-f]{40}$'
        AND account_id <> lower(account_id)
    `)

    await queryRunner.query(`
      UPDATE ${schema}."identity_account_link_challenges"
      SET account_id = lower(account_id)
      WHERE chain_key LIKE 'eip155:%'
        AND account_id ~* '^0x[0-9a-f]{40}$'
        AND account_id <> lower(account_id)
    `)

    await queryRunner.query(`
      DELETE FROM ${schema}."custody_key_records" target
      USING (
        SELECT uid
        FROM (
          SELECT
            uid,
            row_number() OVER (
              PARTITION BY subject_type, lower(subject_id), wallet_id
              ORDER BY updated_at DESC, created_at DESC, uid
            ) AS row_num
          FROM ${schema}."custody_key_records"
          WHERE subject_type = 'wallet_address'
            AND subject_id ~* '^0x[0-9a-f]{40}$'
        ) ranked
        WHERE row_num > 1
      ) duplicate
      WHERE target.uid = duplicate.uid
    `)

    await queryRunner.query(`
      UPDATE ${schema}."custody_key_records"
      SET
        subject_id = lower(subject_id),
        address = CASE
          WHEN address ~* '^0x[0-9a-f]{40}$' THEN lower(address)
          ELSE address
        END
      WHERE subject_type = 'wallet_address'
        AND (
          (subject_id ~* '^0x[0-9a-f]{40}$' AND subject_id <> lower(subject_id))
          OR (address ~* '^0x[0-9a-f]{40}$' AND address <> lower(address))
        )
    `)
  }

  async down(): Promise<void> {
  }
}
