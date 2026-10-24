import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/security/secretVault', () => ({
  getDerivedRuntimeSecret: () => 'ab'.repeat(32),
}))

import {
  buildMerchantPaymentSignature,
  canonicalPaymentJson,
  decryptPaymentMerchantSecret,
  encryptPaymentMerchantSecret,
  verifyMerchantPaymentSignature,
} from '../src/domain/service/paymentCrypto'

describe('payment request signatures', () => {
  it('encrypts and decrypts merchant secrets with the derived 32-byte key', () => {
    const encrypted = encryptPaymentMerchantSecret('merchant-secret')

    expect(encrypted).toMatch(/^v1\./)
    expect(decryptPaymentMerchantSecret(encrypted)).toBe('merchant-secret')
  })

  it('canonicalizes object keys and verifies the signed request', () => {
    const body = { amountMinor: '100', nested: { z: 2, a: 1 }, items: ['b', 'a'] }
    expect(canonicalPaymentJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    const signature = buildMerchantPaymentSignature({
      merchantId: 'pm_test',
      timestamp: '1792000000000',
      nonce: 'nonce_1234567890',
      body,
      secret: 'merchant-secret',
    })
    expect(verifyMerchantPaymentSignature({
      merchantId: 'pm_test',
      timestamp: '1792000000000',
      nonce: 'nonce_1234567890',
      body: { items: ['b', 'a'], nested: { a: 1, z: 2 }, amountMinor: '100' },
      secret: 'merchant-secret',
      signature,
    })).toBe(true)
    expect(verifyMerchantPaymentSignature({
      merchantId: 'pm_test',
      timestamp: '1792000000000',
      nonce: 'nonce_1234567890',
      body: { ...body, amountMinor: '101' },
      secret: 'merchant-secret',
      signature,
    })).toBe(false)
    expect(verifyMerchantPaymentSignature({
      merchantId: 'pm_other',
      timestamp: '1792000000000',
      nonce: 'nonce_1234567890',
      body,
      secret: 'merchant-secret',
      signature,
    })).toBe(false)
  })
})
