import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/security/secretVault', () => ({
  getDerivedRuntimeSecret: () => 'notification-webhook-master-key-for-test',
}))
vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) =>
    key === 'notification'
      ? {
          dingtalkDeliveryEnabled: true,
          dingtalkDeliveryTimeoutMs: 1000,
          dingtalkMaxAttempts: 3,
          feishuDeliveryEnabled: true,
          feishuDeliveryTimeoutMs: 1000,
          feishuMaxAttempts: 3,
        }
      : undefined,
}))

import { SingletonDataSource } from '../src/domain/facade/datasource'
import { NotificationDO, NotificationWebhookDO } from '../src/domain/mapper/entity'
import { dingtalkDeliveryProvider } from '../src/domain/service/delivery/providers/dingtalkProvider'
import { feishuDeliveryProvider } from '../src/domain/service/delivery/providers/feishuProvider'
import { encryptNotificationWebhookSecret } from '../src/domain/service/delivery/webhookSecret'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

function buildNotification(): NotificationDO {
  return {
    uid: 'notification-bot',
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
  } as NotificationDO
}

async function saveWebhook(format: string, targetUrl: string, secret: string): Promise<NotificationWebhookDO> {
  const repository = SingletonDataSource.get().getRepository(NotificationWebhookDO)
  return await repository.save({
    uid: `webhook-${format}`,
    owner: '0x1111111111111111111111111111111111111111',
    applicationUid: 'application-1',
    eventsJson: '[]',
    targetUrl,
    format,
    secretMasked: '',
    secretCiphertext: secret ? encryptNotificationWebhookSecret(secret) : '',
    enabled: true,
    lastTriggeredAt: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as NotificationWebhookDO)
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  }
}

beforeEach(() => {
  SingletonDataSource.set(createInMemoryDataSource() as any)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dingtalk delivery provider', () => {
  it('posts a signed markdown message and succeeds on errcode 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { errcode: 0, errmsg: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)
    const webhook = await saveWebhook('dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=abc', 'bot-secret')
    const delivery = { uid: 'd1', channel: 'dingtalk', webhookUid: webhook.uid, attemptCount: 1 } as any

    await expect(
      dingtalkDeliveryProvider.send({ notification: buildNotification(), delivery, webhook })
    ).resolves.toBeDefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('timestamp=')
    expect(String(url)).toContain('sign=')
    const body = JSON.parse(String(init.body))
    expect(body.msgtype).toBe('markdown')
    expect(body.markdown.title).toBe('审核通过')
    expect(body.markdown.text).toContain('应用已通过审核。')

    const stored = await SingletonDataSource.get().getRepository(NotificationWebhookDO).findOneBy({ uid: webhook.uid })
    expect(stored?.lastTriggeredAt).not.toBe('')
  })

  it('fails when dingtalk returns a non-zero errcode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { errcode: 310000, errmsg: 'keyword not found' }))
    vi.stubGlobal('fetch', fetchMock)
    const webhook = await saveWebhook('dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=abc', 'bot-secret')
    const delivery = { uid: 'd2', channel: 'dingtalk', webhookUid: webhook.uid, attemptCount: 1 } as any

    await expect(
      dingtalkDeliveryProvider.send({ notification: buildNotification(), delivery, webhook })
    ).rejects.toThrow(/310000/)
  })
})

describe('feishu delivery provider', () => {
  it('posts a signed text message and succeeds on code 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { code: 0, msg: 'success' }))
    vi.stubGlobal('fetch', fetchMock)
    const webhook = await saveWebhook('feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/xyz', 'bot-secret')
    const delivery = { uid: 'd3', channel: 'feishu', webhookUid: webhook.uid, attemptCount: 1 } as any

    await expect(
      feishuDeliveryProvider.send({ notification: buildNotification(), delivery, webhook })
    ).resolves.toBeDefined()

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/xyz')
    const body = JSON.parse(String(init.body))
    expect(body.msg_type).toBe('text')
    expect(body.content.text).toContain('审核通过')
    expect(typeof body.timestamp).toBe('string')
    expect(typeof body.sign).toBe('string')
  })

  it('fails when feishu returns a non-zero code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { code: 19021, msg: 'sign match fail' }))
    vi.stubGlobal('fetch', fetchMock)
    const webhook = await saveWebhook('feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/xyz', 'bot-secret')
    const delivery = { uid: 'd4', channel: 'feishu', webhookUid: webhook.uid, attemptCount: 1 } as any

    await expect(
      feishuDeliveryProvider.send({ notification: buildNotification(), delivery, webhook })
    ).rejects.toThrow(/19021/)
  })
})
