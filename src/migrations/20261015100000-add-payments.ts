import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}
export class AddPayments20261015100000 implements MigrationInterface {
  name = 'AddPayments20261015100000'

  async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddPayments20261015100000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = String((queryRunner.connection.options as { schema?: string }).schema || 'public')
    const s = quoteIdent(schema)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${s}."payment_merchants" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id varchar(64) NOT NULL,
        owner varchar(128) NOT NULL,
        name varchar(128) NOT NULL,
        callback_url text NOT NULL,
        secret_ciphertext text NOT NULL,
        secret_masked varchar(32) NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'active',
        created_at varchar(64) NOT NULL,
        updated_at varchar(64) NOT NULL
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_merchant_id" ON ${s}."payment_merchants" (merchant_id)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payment_merchant_owner_status" ON ${s}."payment_merchants" (owner, status)`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${s}."payment_transactions" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        trade_no varchar(64) NOT NULL,
        merchant_id varchar(64) NOT NULL,
        external_order_id varchar(64) NOT NULL,
        amount_minor bigint NOT NULL,
        currency varchar(3) NOT NULL DEFAULT 'CNY',
        description varchar(127) NOT NULL,
        client_type varchar(16) NOT NULL DEFAULT 'native',
        provider varchar(32) NOT NULL DEFAULT 'wechat',
        provider_order_id varchar(128) NOT NULL DEFAULT '',
        payment_url text NOT NULL DEFAULT '',
        return_url text NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'pending',
        idempotency_key varchar(128) NOT NULL,
        request_hash varchar(64) NOT NULL,
        paid_at varchar(64) NOT NULL DEFAULT '',
        expires_at varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL,
        updated_at varchar(64) NOT NULL
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_trade_no" ON ${s}."payment_transactions" (trade_no)`)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_transaction_idempotency" ON ${s}."payment_transactions" (merchant_id, idempotency_key)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payment_transaction_merchant_order" ON ${s}."payment_transactions" (merchant_id, external_order_id)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payment_transaction_status_created" ON ${s}."payment_transactions" (status, created_at)`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${s}."payment_refunds" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        refund_no varchar(64) NOT NULL,
        trade_no varchar(64) NOT NULL,
        merchant_id varchar(64) NOT NULL,
        amount_minor bigint NOT NULL,
        reason varchar(255) NOT NULL DEFAULT '',
        status varchar(32) NOT NULL DEFAULT 'pending',
        provider_refund_id varchar(128) NOT NULL DEFAULT '',
        idempotency_key varchar(128) NOT NULL,
        request_hash varchar(64) NOT NULL,
        created_at varchar(64) NOT NULL,
        updated_at varchar(64) NOT NULL
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_refund_no" ON ${s}."payment_refunds" (refund_no)`)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_refund_idempotency" ON ${s}."payment_refunds" (merchant_id, idempotency_key)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payment_refund_trade_status" ON ${s}."payment_refunds" (trade_no, status)`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${s}."payment_request_nonces" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id varchar(64) NOT NULL,
        nonce varchar(128) NOT NULL,
        request_hash varchar(64) NOT NULL,
        created_at varchar(64) NOT NULL
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_request_nonce" ON ${s}."payment_request_nonces" (merchant_id, nonce)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payment_request_nonce_created" ON ${s}."payment_request_nonces" (created_at)`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${s}."payment_provider_events" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(32) NOT NULL,
        event_id varchar(128) NOT NULL,
        trade_no varchar(64) NOT NULL DEFAULT '',
        event_type varchar(64) NOT NULL,
        created_at varchar(64) NOT NULL
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_provider_event" ON ${s}."payment_provider_events" (provider, event_id)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payment_provider_event_trade" ON ${s}."payment_provider_events" (trade_no, created_at)`)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${s}."payment_webhook_deliveries" (
        uid uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id varchar(128) NOT NULL,
        merchant_id varchar(64) NOT NULL,
        target_url text NOT NULL,
        payload_json text NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'pending',
        attempt_count int NOT NULL DEFAULT 0,
        next_retry_at varchar(64) NOT NULL DEFAULT '',
        lock_token varchar(128) NOT NULL DEFAULT '',
        locked_at varchar(64) NOT NULL DEFAULT '',
        last_error text NOT NULL DEFAULT '',
        delivered_at varchar(64) NOT NULL DEFAULT '',
        created_at varchar(64) NOT NULL,
        updated_at varchar(64) NOT NULL
      )
    `)
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_payment_webhook_event" ON ${s}."payment_webhook_deliveries" (event_id)`)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_payment_webhook_delivery_status_retry" ON ${s}."payment_webhook_deliveries" (status, next_retry_at)`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
      throw new Error(`AddPayments20261015100000 only supports postgres, got ${queryRunner.connection.options.type}`)
    }
    const schema = String((queryRunner.connection.options as { schema?: string }).schema || 'public')
    const s = quoteIdent(schema)
    await queryRunner.query(`DROP TABLE IF EXISTS ${s}."payment_webhook_deliveries"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${s}."payment_provider_events"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${s}."payment_request_nonces"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${s}."payment_refunds"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${s}."payment_transactions"`)
    await queryRunner.query(`DROP TABLE IF EXISTS ${s}."payment_merchants"`)
  }
}
