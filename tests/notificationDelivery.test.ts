import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/security/secretVault', () => ({
  getDerivedRuntimeSecret: () => 'notification-webhook-master-key-for-test',
}))
vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => key === 'notification'
    ? {
        webhookDeliveryEnabled: true,
        webhookDeliveryBatchSize: 10,
        webhookDeliveryTimeoutMs: 1000,
        webhookClaimTimeoutMs: 60 * 1000,
        webhookMaxAttempts: 3,
        webhookRetryBaseDelayMs: 1000,
        webhookRetryMaxDelayMs: 10 * 1000,
      }
    : undefined,
}))
import {
  buildNotificationWebhookSignature,
  decryptNotificationWebhookSecret,
  encryptNotificationWebhookSecret,
  runNotificationWebhookDeliveryOnce,
} from '../src/domain/service/notificationDelivery'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { NotificationDO, NotificationDeliveryDO, NotificationWebhookDO } from '../src/domain/mapper/entity'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('notification webhook delivery helpers', () => {
  it('encrypts and decrypts webhook secret with the configured master key', () => {
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

  it('does not process a webhook delivery when a concurrent worker wins the fallback claim', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const dataSource = createInMemoryDataSource()
    dataSource.options = { type: 'mysql' }
    SingletonDataSource.set(dataSource)

    await dataSource.getRepository(NotificationDO).save({
      uid: 'notification-race',
      type: 'audit.approved',
      source: 'audit',
      subjectType: 'application',
      subjectId: 'application-1',
      actor: '',
      audienceType: 'user',
      audienceIds: '[]',
      level: 'success',
      title: '审核通过',
      body: '应用已通过审核。',
      payload: '{}',
      status: 'delivered',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '',
    })
    await dataSource.getRepository(NotificationWebhookDO).save({
      uid: 'webhook-race',
      owner: '0x1111111111111111111111111111111111111111',
      applicationUid: 'application-1',
      eventsJson: '[]',
      targetUrl: 'https://example.com/webhook',
      secretMasked: '',
      secretCiphertext: '',
      enabled: true,
      lastTriggeredAt: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    await dataSource.getRepository(NotificationDeliveryDO).save({
      uid: 'delivery-race',
      webhookUid: 'webhook-race',
      notificationUid: 'notification-race',
      channel: 'webhook',
      target: 'https://example.com/webhook',
      status: 'pending',
      lockToken: '',
      lockedAt: '',
      attemptCount: 0,
      lastError: '',
      deliveredAt: '',
      nextRetryAt: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })

    const originalGetRepository = dataSource.getRepository.bind(dataSource)
    let simulatedRace = false
    dataSource.getRepository = (target: any) => {
      const repository = originalGetRepository(target)
      if (target === NotificationDeliveryDO) {
        const originalUpdate = repository.update.bind(repository)
        repository.update = async (where: Record<string, unknown>, values: Record<string, unknown>) => {
          if (!simulatedRace && where.status === 'pending') {
            simulatedRace = true
            await originalUpdate(
              { uid: 'delivery-race' },
              {
                status: 'delivering',
                lockToken: 'worker-b',
                lockedAt: '2026-09-01T00:00:01.000Z',
              }
            )
            return { affected: 0 }
          }
          return originalUpdate(where, values)
        }
      }
      return repository
    }

    await runNotificationWebhookDeliveryOnce(Date.parse('2026-09-01T00:01:00.000Z'))

    expect(fetchMock).not.toHaveBeenCalled()
    const delivery = await originalGetRepository(NotificationDeliveryDO).findOneBy({ uid: 'delivery-race' })
    expect(delivery).toMatchObject({
      status: 'delivering',
      lockToken: 'worker-b',
      attemptCount: 0,
    })
  })
})
