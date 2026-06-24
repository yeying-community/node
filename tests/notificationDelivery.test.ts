import { afterEach, describe, expect, it } from 'vitest'
import {
  buildNotificationWebhookSignature,
  decryptNotificationWebhookSecret,
  encryptNotificationWebhookSecret,
} from '../src/domain/service/notificationDelivery'

const originalMasterKey = process.env.NOTIFICATION_WEBHOOK_MASTER_KEY

describe('notification webhook delivery helpers', () => {
  afterEach(() => {
    if (originalMasterKey === undefined) {
      delete process.env.NOTIFICATION_WEBHOOK_MASTER_KEY
    } else {
      process.env.NOTIFICATION_WEBHOOK_MASTER_KEY = originalMasterKey
    }
  })

  it('encrypts and decrypts webhook secret with the configured master key', () => {
    process.env.NOTIFICATION_WEBHOOK_MASTER_KEY = 'notification-webhook-master-key-for-test'
    const ciphertext = encryptNotificationWebhookSecret('secret-value-123')
    expect(ciphertext).toMatch(/^v1\./)
    expect(ciphertext).not.toContain('secret-value-123')
    expect(decryptNotificationWebhookSecret(ciphertext)).toBe('secret-value-123')
  })

  it('builds deterministic sha256 webhook signatures', () => {
    const signature = buildNotificationWebhookSignature(
      '2026-06-24T08:00:00.000Z',
      '{"ok":true}',
      'secret-value-123'
    )
    expect(signature).toBe('sha256=1bc6212931611be0415907121d7e0fde64b9217aceb27700ac8749a875462c7f')
  })
})
