import { describe, expect, it, vi } from 'vitest'
import { buildMerchantPaymentSignature } from '../src/domain/service/paymentCrypto'
import { PaymentProvider } from '../src/domain/service/paymentProvider'
import { PaymentService } from '../src/domain/service/payment'
import { PaymentMerchantDO, PaymentProviderEventDO, PaymentTransactionDO, PaymentWebhookDeliveryDO } from '../src/domain/mapper/entity'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => {
    if (key === 'app.env') return 'dev'
    if (key === 'payment.enabled') return true
    if (key === 'payment.provider') return 'mock'
    if (key === 'payment.signatureWindowMs') return 5 * 60 * 1000
    if (key === 'payment.webhookTimeoutMs') return 1000
    if (key === 'payment.webhookMaxAttempts') return 3
    return undefined
  },
}))

const provider: PaymentProvider = {
  name: 'mock',
  createPayment: vi.fn(async input => ({
    providerOrderId: `provider-${input.tradeNo}`,
    paymentUrl: `https://pay.invalid/${input.tradeNo}`,
    raw: {},
  })),
  queryPayment: vi.fn(async input => ({ status: 'pending' as const, providerOrderId: input, amountMinor: '100', raw: {} })),
  closePayment: vi.fn(async () => undefined),
  refundPayment: vi.fn(async input => ({ providerRefundId: `refund-${input.refundNo}`, raw: {} })),
  queryRefund: vi.fn(async refundNo => ({ status: 'succeeded' as const, providerRefundId: `refund-${refundNo}`, raw: {} })),
  verifyWebhook: vi.fn(async input => {
    const body = input.body as Record<string, string>
    return {
      eventId: body.eventId,
      eventType: 'payment.succeeded',
      tradeNo: body.tradeNo,
      amountMinor: body.amountMinor,
      providerOrderId: body.providerOrderId || body.tradeNo,
      status: 'paid' as const,
      raw: body,
    }
  }),
  successWebhookResponse: () => JSON.stringify({ ok: true }),
}

describe('payment service', () => {
  it('enforces merchant request signatures, idempotency and webhook deduplication', async () => {
    const dataSource = createInMemoryDataSource()
    const service = new PaymentService({
      dataSource,
      provider,
      secrets: { encrypt: value => `enc:${value}`, decrypt: value => value.slice(4) },
    })
    const merchant = await service.createMerchant('0xOWNER', {
      name: 'Test merchant',
      callbackUrl: 'http://localhost:8991/payment-callback',
    })
    const requestBody = {
      externalOrderId: 'order-1',
      amountMinor: '100',
      currency: 'CNY',
      description: 'Test order',
      clientType: 'native',
      idempotencyKey: 'idem_12345678',
    }
    const timestamp = String(Date.now())
    const signed = await service.authenticateMerchantRequest({
      merchantId: merchant.merchantId,
      timestamp,
      nonce: 'nonce_123456789012',
      signature: buildMerchantPaymentSignature({ merchantId: merchant.merchantId, timestamp, nonce: 'nonce_123456789012', body: requestBody, secret: merchant.secret }),
      body: requestBody,
    })
    const created = await service.createTransaction(signed, requestBody)
    const replayed = await service.createTransaction(signed, requestBody)
    expect(replayed.tradeNo).toBe(created.tradeNo)
    expect(provider.createPayment).toHaveBeenCalledTimes(1)
    await expect(service.authenticateMerchantRequest({
      merchantId: merchant.merchantId,
      timestamp,
      nonce: 'nonce_123456789012',
      signature: buildMerchantPaymentSignature({ merchantId: merchant.merchantId, timestamp, nonce: 'nonce_123456789012', body: requestBody, secret: merchant.secret }),
      body: requestBody,
    })).rejects.toThrow('PAYMENT_SIGNATURE_REPLAYED')

    const webhook = {
      eventId: 'event-1',
      tradeNo: created.tradeNo,
      amountMinor: '100',
      providerOrderId: 'provider-order-1',
    }
    const completed = await service.handleProviderWebhook('mock', { rawBody: '', body: webhook })
    expect(completed.transaction.status).toBe('paid')
    expect(await dataSource.getRepository(PaymentWebhookDeliveryDO).findOneBy({ eventId: `payment.succeeded:${created.tradeNo}` })).toMatchObject({ status: 'pending' })
    const duplicate = await service.handleProviderWebhook('mock', { rawBody: '', body: webhook })
    expect(duplicate.duplicate).toBe(true)
    expect((await service.queryTransaction(merchant as any, created.tradeNo)).status).toBe('paid')
  })

  it('rejects over-refunds and tracks asynchronous refund completion', async () => {
    const dataSource = createInMemoryDataSource()
    const service = new PaymentService({
      dataSource,
      provider,
      secrets: { encrypt: value => `enc:${value}`, decrypt: value => value.slice(4) },
    })
    const merchant = await service.createMerchant('0xOWNER', {
      name: 'Test merchant',
      callbackUrl: 'http://localhost:8991/payment-callback',
    })
    const transaction = await service.createTransaction(merchant as any, {
      externalOrderId: 'order-2', amountMinor: '100', description: 'Refundable', idempotencyKey: 'idem_22345678',
    })
    await service.handleProviderWebhook('mock', {
      rawBody: '',
      body: { eventId: 'event-2', tradeNo: transaction.tradeNo, amountMinor: '100', providerOrderId: 'provider-order-2' },
    })
    await expect(service.requestRefund(merchant as any, {
      tradeNo: transaction.tradeNo, amountMinor: '101', reason: 'too much', idempotencyKey: 'refund_12345678',
    })).rejects.toThrow('PAYMENT_REFUND_AMOUNT_EXCEEDED')
    const refund = await service.requestRefund(merchant as any, {
      tradeNo: transaction.tradeNo, amountMinor: '100', reason: 'customer request', idempotencyKey: 'refund_12345678',
    })
    expect(refund.status).toBe('processing')
    const completed = await service.queryRefund(merchant as any, refund.refundNo)
    expect(completed.status).toBe('succeeded')
    expect((await service.queryTransaction(merchant as any, transaction.tradeNo)).status).toBe('refunded')
  })

  it('rolls back payment state and provider event when the callback outbox write fails', async () => {
    const dataSource = createInMemoryDataSource()
    const service = new PaymentService({
      dataSource,
      provider,
      secrets: { encrypt: value => `enc:${value}`, decrypt: value => value.slice(4) },
    })
    const merchant = await service.createMerchant('0xOWNER', {
      name: 'Transactional merchant', callbackUrl: 'http://localhost:8991/payment-callback',
    })
    const transaction = await service.createTransaction(merchant as any, {
      externalOrderId: 'order-atomic', amountMinor: '100', description: 'Atomic', idempotencyKey: 'idem_atomic_1',
    })
    const originalGetRepository = dataSource.getRepository
    dataSource.getRepository = (target: any) => {
      const repo = originalGetRepository(target)
      if (target === PaymentWebhookDeliveryDO) {
        const originalSave = repo.save
        repo.save = async () => { throw new Error('outbox unavailable') }
        void originalSave
      }
      return repo
    }
    await expect(service.handleProviderWebhook('mock', {
      rawBody: '', body: { eventId: 'event-atomic', tradeNo: transaction.tradeNo, amountMinor: '100', providerOrderId: 'provider-atomic' },
    })).rejects.toThrow('outbox unavailable')
    dataSource.getRepository = originalGetRepository
    expect((await dataSource.getRepository(PaymentTransactionDO).findOneBy({ tradeNo: transaction.tradeNo }))?.status).toBe('pending')
    expect(await dataSource.getRepository(PaymentProviderEventDO).findOneBy({ eventId: 'event-atomic', provider: 'mock' })).toBeNull()
  })

  it('does not overwrite a payment notification that arrives before provider order creation returns', async () => {
    const dataSource = createInMemoryDataSource()
    let service: PaymentService
    const racingProvider: PaymentProvider = {
      ...provider,
      createPayment: vi.fn(async input => {
        await service.handleProviderWebhook('mock', {
          rawBody: '',
          body: {
            eventId: 'event-before-create-return', tradeNo: input.tradeNo,
            amountMinor: input.amountMinor, providerOrderId: 'provider-order-from-notification',
          },
        })
        return { providerOrderId: 'provider-order-from-create', paymentUrl: `https://pay.invalid/${input.tradeNo}`, raw: {} }
      }),
    }
    service = new PaymentService({
      dataSource,
      provider: racingProvider,
      secrets: { encrypt: value => `enc:${value}`, decrypt: value => value.slice(4) },
    })
    const merchant = await service.createMerchant('0xOWNER', {
      name: 'Fast payment merchant', callbackUrl: 'http://localhost:8991/payment-callback',
    })
    const transaction = await service.createTransaction(merchant as any, {
      externalOrderId: 'order-fast', amountMinor: '100', description: 'Fast payment', idempotencyKey: 'idem_fast_1',
    })
    expect(transaction.status).toBe('paid')
    expect((await dataSource.getRepository(PaymentTransactionDO).findOneBy({ tradeNo: transaction.tradeNo }))?.providerOrderId)
      .toBe('provider-order-from-notification')
  })

  it('fails closed when the provider cannot be initialized', async () => {
    const dataSource = createInMemoryDataSource()
    const service = new PaymentService({
      dataSource,
      secrets: { encrypt: value => `enc:${value}`, decrypt: value => value.slice(4) },
    })
    const merchant = await service.createMerchant('0xOWNER', {
      name: 'Disabled provider merchant', callbackUrl: 'http://localhost:8991/payment-callback',
    })
    await expect(service.createTransaction(merchant as any, {
      externalOrderId: 'order-provider-disabled', amountMinor: '100', description: 'Provider disabled',
      idempotencyKey: 'idem_provider_1',
    })).rejects.toThrow('PAYMENT_MOCK_PROVIDER_DISABLED')
    expect(await dataSource.getRepository(PaymentTransactionDO).findOneBy({ idempotencyKey: 'idem_provider_1' }))
      .toMatchObject({ status: 'failed', paymentUrl: '' })
  })

  it('does not retry a callback delivery after its configured attempt limit', async () => {
    const dataSource = createInMemoryDataSource()
    const deliverWebhook = vi.fn(async () => { throw new Error('network unavailable') })
    const service = new PaymentService({
      dataSource,
      provider,
      deliverWebhook: deliverWebhook as any,
      secrets: { encrypt: value => `enc:${value}`, decrypt: value => value.slice(4) },
    })
    const merchant = await service.createMerchant('0xOWNER', {
      name: 'Retry merchant', callbackUrl: 'http://localhost:8991/payment-callback',
    })
    const delivery = new PaymentWebhookDeliveryDO()
    Object.assign(delivery, {
      eventId: 'payment.succeeded:retry', merchantId: merchant.merchantId,
      targetUrl: merchant.callbackUrl, payloadJson: JSON.stringify({ merchantId: merchant.merchantId }),
      status: 'failed', attemptCount: 3, nextRetryAt: '', lockToken: '', lockedAt: '',
      lastError: 'previous failure', deliveredAt: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await dataSource.getRepository(PaymentWebhookDeliveryDO).save(delivery)
    expect(await service.deliverCallbacksOnce()).toBe(0)
    expect(deliverWebhook).not.toHaveBeenCalled()
  })
})
