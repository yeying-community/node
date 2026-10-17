import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => key === 'app.env' ? 'dev' : undefined,
}))

import { validatePaymentCallbackUrl } from '../src/domain/service/paymentWebhookDelivery'

describe('payment callback targets', () => {
  it('allows local development callback targets and rejects private production targets', () => {
    expect(validatePaymentCallbackUrl('http://localhost:8991/payment-callback')).toContain('localhost:8991')
    expect(() => validatePaymentCallbackUrl('http://127.0.0.1:8991/payment-callback')).not.toThrow()
    expect(() => validatePaymentCallbackUrl('http://[::1]:8991/payment-callback')).not.toThrow()
    expect(() => validatePaymentCallbackUrl('http://192.168.1.10/callback')).toThrow('PAYMENT_CALLBACK_URL_INVALID')
    expect(() => validatePaymentCallbackUrl('https://[::ffff:192.168.1.10]/callback')).toThrow('PAYMENT_CALLBACK_URL_INVALID')
    expect(() => validatePaymentCallbackUrl('https://192.0.0.10/callback')).toThrow('PAYMENT_CALLBACK_URL_INVALID')
    expect(() => validatePaymentCallbackUrl('file:///tmp/callback')).toThrow('PAYMENT_CALLBACK_URL_INVALID')
  })
})
