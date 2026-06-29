import express, { Express } from 'express'
import { AddressInfo } from 'net'
import { runWithRequestContext } from '../src/common/requestContext'
import { mockClass } from './support/mockClass'

const serviceMocks = {
  list: vi.fn(),
  getByNotificationUid: vi.fn(),
  getUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  listCreatedAfterCursor: vi.fn(),
  buildEventId: vi.fn(),
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  listDeliveriesByNotificationUid: vi.fn(),
  listDeliveriesByWebhook: vi.fn(),
  retryWebhookDelivery: vi.fn(),
  replayWebhookDelivery: vi.fn(),
}

vi.doMock('../src/common/permission', () => ({
  ensureUserActive: vi.fn().mockResolvedValue(undefined),
}))

vi.doMock('../src/domain/service/notification', () => ({
  NotificationService: mockClass(() => serviceMocks),
}))

const { registerPublicNotificationRoutes } = await import('../src/routes/public/notifications')

const actor = '0x1111111111111111111111111111111111111111'

function createTestApp(address = actor) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    runWithRequestContext(
      {
        address,
        authType: 'jwt',
      },
      next
    )
  })
  registerPublicNotificationRoutes(app)
  return app
}

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = await new Promise<import('http').Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  try {
    const address = server.address() as AddressInfo
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

async function readSseUntil(baseUrl: string, path: string, expected: string) {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: 'text/event-stream',
    },
    signal: controller.signal,
  })
  expect(response.status).toBe(200)
  expect(response.body).toBeTruthy()
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (!text.includes(expected)) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    controller.abort()
  }
  return text
}

describe('public notification routes', () => {
  beforeEach(() => {
    for (const fn of Object.values(serviceMocks)) {
      fn.mockReset()
    }
    serviceMocks.list.mockResolvedValue({ items: [], page: { total: 0, page: 1, pageSize: 20 } })
    serviceMocks.getUnreadCount.mockResolvedValue(0)
    serviceMocks.listCreatedAfterCursor.mockResolvedValue([])
    serviceMocks.buildEventId.mockImplementation((item) => `${item.createdAt}|${item.notificationUid}`)
    serviceMocks.listWebhooks.mockResolvedValue([])
    serviceMocks.listDeliveriesByNotificationUid.mockResolvedValue([])
    serviceMocks.listDeliveriesByWebhook.mockResolvedValue([])
    serviceMocks.retryWebhookDelivery.mockResolvedValue(null)
    serviceMocks.replayWebhookDelivery.mockResolvedValue(null)
  })

  it('passes list filters to the notification service', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/public/notifications?page=2&pageSize=5&unreadOnly=true&source=audit&level=warning&applicationUid=app-1`
      )
      expect(response.status).toBe(200)
    })

    expect(serviceMocks.list).toHaveBeenCalledWith({
      recipient: actor,
      unreadOnly: true,
      source: 'audit',
      level: 'warning',
      applicationUid: 'app-1',
      page: 2,
      pageSize: 5,
    })
  })

  it('returns a notification detail scoped to the current user', async () => {
    serviceMocks.getByNotificationUid.mockResolvedValue({
      notificationUid: 'notification-1',
      title: '待审批',
    })
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/notifications/notification-1`)
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.notificationUid).toBe('notification-1')
    })

    expect(serviceMocks.getByNotificationUid).toHaveBeenCalledWith('notification-1', actor)
  })

  it('replays notification.created events from an SSE cursor', async () => {
    serviceMocks.getUnreadCount.mockResolvedValue(3)
    serviceMocks.listCreatedAfterCursor.mockResolvedValue([
      {
        notificationUid: 'notification-2',
        createdAt: '2026-05-12T01:00:00.000Z',
      },
    ])
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const text = await readSseUntil(
        baseUrl,
        '/api/v1/public/notifications/stream?cursor=2026-05-12T00%3A00%3A00.000Z%7Cnotification-1',
        'event: unread-count'
      )
      expect(text).toContain('event: ready')
      expect(text).toContain('id: 2026-05-12T01:00:00.000Z|notification-2')
      expect(text).toContain('event: notification.created')
      expect(text).toContain('"notificationUid":"notification-2"')
      expect(text).toContain('"unreadCount":3')
    })

    expect(serviceMocks.listCreatedAfterCursor).toHaveBeenCalledWith(
      actor,
      '2026-05-12T00:00:00.000Z|notification-1',
      200
    )
  })

  it('creates and lists webhook subscriptions for the current user', async () => {
    serviceMocks.createWebhook.mockResolvedValue({
      uid: 'webhook-1',
      owner: actor,
      applicationUid: 'app-1',
      events: ['application.created'],
      targetUrl: 'https://example.com/webhook',
      secretMasked: 'sec***12',
      enabled: true,
      lastTriggeredAt: '',
      createdAt: '2026-06-24T00:00:00.000Z',
      updatedAt: '2026-06-24T00:00:00.000Z',
    })
    serviceMocks.listWebhooks.mockResolvedValue([
      {
        uid: 'webhook-1',
        owner: actor,
        applicationUid: 'app-1',
        events: ['application.created'],
        targetUrl: 'https://example.com/webhook',
        secretMasked: 'sec***12',
        enabled: true,
        lastTriggeredAt: '',
        createdAt: '2026-06-24T00:00:00.000Z',
        updatedAt: '2026-06-24T00:00:00.000Z',
      },
    ])

    const app = createTestApp()
    await withServer(app, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/v1/public/notifications/webhooks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applicationUid: 'app-1',
          events: ['application.created'],
          targetUrl: 'https://example.com/webhook',
          secret: 'secret-12',
          enabled: true,
        }),
      })
      expect(createResponse.status).toBe(200)

      const listResponse = await fetch(`${baseUrl}/api/v1/public/notifications/webhooks`)
      const listJson = await listResponse.json()
      expect(listResponse.status).toBe(200)
      expect(Array.isArray(listJson.data.items)).toBe(true)
      expect(listJson.data.items[0].uid).toBe('webhook-1')
    })

    expect(serviceMocks.createWebhook).toHaveBeenCalledWith({
      owner: actor,
      applicationUid: 'app-1',
      events: ['application.created'],
      targetUrl: 'https://example.com/webhook',
      secret: 'secret-12',
      enabled: true,
    })
    expect(serviceMocks.listWebhooks).toHaveBeenCalledWith(actor)
  })

  it('lists webhook deliveries scoped to the current user', async () => {
    serviceMocks.listDeliveriesByWebhook.mockResolvedValue([
      {
        uid: 'delivery-1',
        webhookUid: 'webhook-1',
        notificationUid: 'notification-1',
        channel: 'webhook',
        target: 'https://example.com/webhook',
        status: 'failed',
        attemptCount: 2,
        lastError: 'timeout',
        deliveredAt: '',
        nextRetryAt: '2026-06-24T09:00:00.000Z',
        createdAt: '2026-06-24T08:59:00.000Z',
        updatedAt: '2026-06-24T08:59:00.000Z',
      },
    ])
    const app = createTestApp()
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/notifications/webhooks/webhook-1/deliveries?limit=10`)
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.items[0].uid).toBe('delivery-1')
    })
    expect(serviceMocks.listDeliveriesByWebhook).toHaveBeenCalledWith('webhook-1', actor, 10)
  })

  it('retries one webhook delivery for the current user', async () => {
    serviceMocks.retryWebhookDelivery.mockResolvedValue({
      uid: 'delivery-1',
      webhookUid: 'webhook-1',
      notificationUid: 'notification-1',
      channel: 'webhook',
      target: 'https://example.com/webhook',
      status: 'delivered',
      attemptCount: 3,
      lastError: '',
      deliveredAt: '2026-06-24T09:01:00.000Z',
      nextRetryAt: '',
      createdAt: '2026-06-24T08:59:00.000Z',
      updatedAt: '2026-06-24T09:01:00.000Z',
    })
    const app = createTestApp()
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/notifications/webhooks/webhook-1/deliveries/delivery-1/retry`, {
        method: 'POST',
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.status).toBe('delivered')
    })
    expect(serviceMocks.retryWebhookDelivery).toHaveBeenCalledWith('webhook-1', 'delivery-1', actor)
  })

  it('replays one notification to webhook for the current user', async () => {
    serviceMocks.replayWebhookDelivery.mockResolvedValue({
      uid: 'delivery-2',
      webhookUid: 'webhook-1',
      notificationUid: 'notification-1',
      channel: 'webhook',
      target: 'https://example.com/webhook',
      status: 'delivered',
      attemptCount: 1,
      lastError: '',
      deliveredAt: '2026-06-24T09:02:00.000Z',
      nextRetryAt: '',
      createdAt: '2026-06-24T09:02:00.000Z',
      updatedAt: '2026-06-24T09:02:00.000Z',
    })
    const app = createTestApp()
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/notifications/webhooks/webhook-1/replay/notification-1`, {
        method: 'POST',
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.uid).toBe('delivery-2')
    })
    expect(serviceMocks.replayWebhookDelivery).toHaveBeenCalledWith('webhook-1', 'notification-1', actor)
  })
})
