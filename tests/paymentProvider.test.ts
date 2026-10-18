import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ environment: 'test' }))

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => {
    if (key === 'app.env') return runtime.environment
    if (key === 'payment.wechat') return { enabled: true, notifyUrl: 'https://node.example.com/payment-hook' }
    if (key === 'payment.allowMockProvider') return true
    return undefined
  },
}))

vi.mock('../src/security/secretVault', () => ({
  getRuntimeSecret: (name: string) => ({
    PAYMENT_WECHAT_APP_ID: 'app-test',
    PAYMENT_WECHAT_MCH_ID: 'merchant-test',
    PAYMENT_WECHAT_API_V2_KEY: 'api-key-test',
  }[name]),
}))

import { defaultPaymentProviderResolver, WechatPayV2Provider } from '../src/domain/service/paymentProvider'

function signV2(fields: Record<string, string>, key: string): string {
  const canonical = Object.keys(fields).sort().map(name => `${name}=${fields[name]}`).join('&')
  return crypto.createHash('md5').update(`${canonical}&key=${key}`).digest('hex').toUpperCase()
}

function webhookXml(overrides: Record<string, string> = {}): string {
  const fields = {
    appid: 'app-test',
    mch_id: 'merchant-test',
    return_code: 'SUCCESS',
    result_code: 'SUCCESS',
    out_trade_no: 'PAY-123',
    transaction_id: 'WX-456',
    total_fee: '100',
    time_end: '20261016010101',
    ...overrides,
  }
  const signed = { ...fields, sign: signV2(fields, 'api-key-test') }
  return `<xml>${Object.entries(signed).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</xml>`
}

describe('WeChat Pay V2 provider', () => {
  it('verifies signed success events and rejects forged or unsupported refund notifications', async () => {
    const provider = new WechatPayV2Provider()
    await expect(provider.verifyWebhook({ rawBody: webhookXml() })).resolves.toMatchObject({
      eventId: 'WX-456', tradeNo: 'PAY-123', amountMinor: '100', status: 'paid',
    })
    await expect(provider.verifyWebhook({ rawBody: webhookXml().replace('<total_fee>100</total_fee>', '<total_fee>101</total_fee>') }))
      .rejects.toThrow('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
    await expect(provider.verifyWebhook({ rawBody: webhookXml({ out_refund_no: 'REFUND-1' }) })).rejects.toThrow('PAYMENT_WEBHOOK_EVENT_UNSUPPORTED')
    await expect(provider.verifyWebhook({ rawBody: '<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///etc/passwd">]><xml>&x;</xml>' }))
      .rejects.toThrow('PAYMENT_PROVIDER_RESPONSE_INVALID')
  })

  it('allows the mock provider only outside production', () => {
    expect(defaultPaymentProviderResolver('mock').name).toBe('mock')
    runtime.environment = 'production'
    expect(() => defaultPaymentProviderResolver('mock')).toThrow('PAYMENT_MOCK_PROVIDER_DISABLED')
    runtime.environment = 'test'
  })
})
