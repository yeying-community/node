import express, { Express } from 'express'
import { AddressInfo } from 'node:net'
import { runWithRequestContext } from '../src/common/requestContext'

const serviceMocks = {
  createMerchant: vi.fn(),
  listMerchants: vi.fn(),
  disableMerchant: vi.fn(),
  authenticateMerchantRequest: vi.fn(),
  createTransaction: vi.fn(),
  queryProviderPayment: vi.fn(),
  cancelTransaction: vi.fn(),
  requestRefund: vi.fn(),
  queryRefund: vi.fn(),
  handleProviderWebhook: vi.fn(),
}

vi.doMock('../src/common/permission', () => ({
  ensureUserActive: vi.fn().mockResolvedValue(undefined),
  ensureUserCanWriteBusinessData: vi.fn().mockResolvedValue(undefined),
}))

vi.doMock('../src/domain/service/payment', () => ({
  PaymentService: class { constructor() { return serviceMocks as any } },
}))

const { registerPublicPaymentGatewayRoutes } = await import('../src/routes/public/paymentGateway')

function createTestApp(): Express {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => runWithRequestContext({
    address: '0x1111111111111111111111111111111111111111', authType: 'jwt',
  }, next))
  registerPublicPaymentGatewayRoutes(app)
  return app
}

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = await new Promise<import('http').Server>(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  try {
    const address = server.address() as AddressInfo
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

describe('payment gateway routes', () => {
  beforeEach(() => {
    Object.values(serviceMocks).forEach(mock => mock.mockReset())
  })

  it('extracts signature headers without including them in the signed body', async () => {
    const merchant = { merchantId: 'pm_test' }
    serviceMocks.authenticateMerchantRequest.mockResolvedValue(merchant)
    serviceMocks.createTransaction.mockResolvedValue({ tradeNo: 'PAY-1', status: 'pending' })
    const app = createTestApp()
    await withServer(app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/v1/public/payment/gateway/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-payment-merchant': 'pm_test',
          'x-payment-timestamp': String(Date.now()),
          'x-payment-nonce': 'nonce_123456789012',
          'x-payment-signature': 'sha256=test',
          'x-forwarded-for': '203.0.113.99',
        },
        body: JSON.stringify({ externalOrderId: 'order-1', amountMinor: '100', description: 'test', idempotencyKey: 'idem_route_1' }),
      })
      expect(response.status).toBe(200)
      expect(serviceMocks.authenticateMerchantRequest).toHaveBeenCalledWith(expect.objectContaining({
        merchantId: 'pm_test',
        body: { externalOrderId: 'order-1', amountMinor: '100', description: 'test', idempotencyKey: 'idem_route_1' },
      }))
      expect(serviceMocks.createTransaction).toHaveBeenCalledWith(merchant, expect.objectContaining({
        externalOrderId: 'order-1', clientIp: expect.any(String),
      }))
      expect(serviceMocks.createTransaction.mock.calls[0][1].clientIp).not.toContain('203.0.113.99')
    })
  })

  it('does not expose provider error text to API callers', async () => {
    serviceMocks.authenticateMerchantRequest.mockRejectedValue(new Error('upstream included a secret key'))
    await withServer(createTestApp(), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/v1/public/payment/gateway/transactions/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-payment-merchant': 'pm_test',
          'x-payment-timestamp': String(Date.now()),
          'x-payment-nonce': 'nonce_123456789012',
          'x-payment-signature': 'sha256=test',
        },
        body: JSON.stringify({ tradeNo: 'PAY-1' }),
      })
      expect(response.status).toBe(500)
      const payload = await response.json()
      expect(payload.message).toBe('PAYMENT_REQUEST_FAILED')
      expect(JSON.stringify(payload)).not.toContain('secret key')
    })
  })
})
