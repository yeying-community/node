import express, { Express } from 'express'
import { AddressInfo } from 'net'
import { runWithRequestContext } from '../src/common/requestContext'
import { mockClass } from './support/mockClass'

const serviceMocks = {
  publish: vi.fn(),
  assertCanSubscribe: vi.fn(),
  listBacklog: vi.fn(),
  createApp: vi.fn(),
  listApps: vi.fn(),
  upsertProjectIdentityMapping: vi.fn(),
  listProjectIdentityMappings: vi.fn(),
  listNotificationPreferences: vi.fn(),
  upsertNotificationPreference: vi.fn(),
  listEmailTemplates: vi.fn(),
  upsertEmailTemplate: vi.fn(),
}

vi.doMock('../src/common/permission', () => ({
  ensureUserActive: vi.fn().mockResolvedValue(undefined),
}))

vi.doMock('../src/domain/service/pusher', () => ({
  PusherService: mockClass(() => serviceMocks),
}))

vi.doMock('../src/domain/service/pusherEvents', () => ({
  subscribePusherEvents: vi.fn().mockReturnValue(() => undefined),
}))

vi.doMock('../src/auth/actionSignature', () => ({
  getActionSignatureErrorStatus: () => undefined,
  executeSignedAction: async (input: any) => input.execute({ requestId: 'request-1' }),
}))

const { registerAdminPusherRoutes, registerPublicPusherRoutes } = await import('../src/routes/public/pusher')

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
  registerPublicPusherRoutes(app)
  registerAdminPusherRoutes(app)
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

describe('pusher routes', () => {
  beforeEach(() => {
    for (const fn of Object.values(serviceMocks)) {
      fn.mockReset()
    }
    serviceMocks.publish.mockResolvedValue({
      eventId: 'evt-1',
      accepted: true,
      idempotent: false,
      channels: ['private-user.0x1111111111111111111111111111111111111111'],
      persisted: true,
    })
    serviceMocks.assertCanSubscribe.mockResolvedValue(undefined)
    serviceMocks.listBacklog.mockResolvedValue([])
    serviceMocks.listApps.mockResolvedValue([])
    serviceMocks.listProjectIdentityMappings.mockResolvedValue([])
    serviceMocks.listNotificationPreferences.mockResolvedValue([])
    serviceMocks.listEmailTemplates.mockResolvedValue([])
    serviceMocks.createApp.mockResolvedValue({
      uid: 'app-uid-1',
      appId: 'project',
      key: 'pk_test',
      secret: 'ps_test',
      secretMasked: 'ps_***test',
      allowedOrigins: [],
      channelPatterns: ['public-*', 'private-user.*'],
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    serviceMocks.upsertProjectIdentityMapping.mockResolvedValue({
      uid: 'mapping-1',
      instanceId: 'project-main',
      projectUserId: '1001',
      identityDid: actor,
      walletAddress: actor,
      metadata: { nickname: 'Alice' },
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    serviceMocks.upsertNotificationPreference.mockResolvedValue({
      uid: 'preference-1',
      subject: actor,
      appId: 'project',
      eventType: 'project.task.updated',
      inboxEnabled: true,
      emailEnabled: false,
      digestMode: 'disabled',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
    serviceMocks.upsertEmailTemplate.mockResolvedValue({
      uid: 'template-1',
      templateId: 'project-task-updated',
      version: 1,
      appId: 'project',
      category: 'transactional',
      eventTypes: ['project.task.updated'],
      subject: { 'zh-CN': '任务已更新' },
      htmlBody: { 'zh-CN': '<p>{{title}}</p>' },
      textBody: { 'zh-CN': '{{title}}' },
      variables: ['title'],
      enabled: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    })
  })

  it('publishes an event using pusher app signature headers', async () => {
    const app = createTestApp()
    const body = {
      eventId: 'evt-1',
      type: 'task.updated',
      channels: ['private-user.0x1111111111111111111111111111111111111111'],
      data: { taskId: 123 },
      persist: true,
      recipients: [actor],
      notification: {
        title: '任务已更新',
      },
    }

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/pusher/apps/project/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pusher-key': 'pk_test',
          'x-pusher-timestamp': '2026-09-01T00:00:00.000Z',
          'x-pusher-signature': 'sha256=abc',
        },
        body: JSON.stringify(body),
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.eventId).toBe('evt-1')
    })

    expect(serviceMocks.publish).toHaveBeenCalledWith({
      appId: 'project',
      key: 'pk_test',
      timestamp: '2026-09-01T00:00:00.000Z',
      signature: 'sha256=abc',
      body,
    })
  })

  it('replays pusher events from an SSE cursor', async () => {
    serviceMocks.listBacklog.mockResolvedValue([
      {
        id: '2026-09-01T00%3A01%3A00.000Z|evt-row-1',
        appId: 'project',
        type: 'task.updated',
        channels: ['private-user.0x1111111111111111111111111111111111111111'],
        data: { taskId: 123 },
        source: 'project',
        actor,
        createdAt: '2026-09-01T00:01:00.000Z',
      },
    ])
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const text = await readSseUntil(
        baseUrl,
        '/api/v1/public/pusher/apps/project/stream?channels=private-user.0x1111111111111111111111111111111111111111&cursor=2026-09-01T00%3A00%3A00.000Z%7Cevt-row-0',
        'event: task.updated'
      )
      expect(text).toContain('event: ready')
      expect(text).toContain('id: 2026-09-01T00%3A01%3A00.000Z|evt-row-1')
      expect(text).toContain('"taskId":123')
    })

    expect(serviceMocks.assertCanSubscribe).toHaveBeenCalledWith({
      appId: 'project',
      channels: ['private-user.0x1111111111111111111111111111111111111111'],
      subject: actor,
      origin: undefined,
    })
    expect(serviceMocks.listBacklog).toHaveBeenCalledWith({
      appId: 'project',
      channels: ['private-user.0x1111111111111111111111111111111111111111'],
      cursor: '2026-09-01T00:00:00.000Z|evt-row-0',
      limit: 200,
    })
  })

  it('returns forbidden when the current user cannot subscribe to a channel', async () => {
    serviceMocks.assertCanSubscribe.mockRejectedValue(new Error('Pusher private channel subscription denied: private-user.other'))
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/pusher/apps/project/stream?channels=private-user.other`)
      const json = await response.json()
      expect(response.status).toBe(403)
      expect(json.message).toContain('denied')
    })
  })

  it('creates pusher apps from the admin endpoint', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/admin/pusher/apps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appId: 'project',
          channelPatterns: ['public-*', 'private-user.*'],
        }),
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.secret).toBe('ps_test')
      expect(json.data.key).toBe('pk_test')
    })

    expect(serviceMocks.createApp).toHaveBeenCalledWith({
      appId: 'project',
      allowedOrigins: [],
      channelPatterns: ['public-*', 'private-user.*'],
    })
  })

  it('upserts project identity mappings from the admin endpoint', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/admin/pusher/project-identities`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'project-main',
          projectUserId: '1001',
          identityDid: actor,
          walletAddress: actor,
          metadata: { nickname: 'Alice' },
        }),
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.uid).toBe('mapping-1')
    })

    expect(serviceMocks.upsertProjectIdentityMapping).toHaveBeenCalledWith({
      instanceId: 'project-main',
      projectUserId: '1001',
      identityDid: actor,
      walletAddress: actor,
      metadata: { nickname: 'Alice' },
      status: undefined,
    })
  })

  it('updates notification preferences for the current user', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/pusher/notification-preferences`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appId: 'project',
          eventType: 'project.task.updated',
          inboxEnabled: true,
          emailEnabled: false,
          digestMode: 'disabled',
        }),
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.emailEnabled).toBe(false)
    })

    expect(serviceMocks.upsertNotificationPreference).toHaveBeenCalledWith({
      subject: actor,
      appId: 'project',
      eventType: 'project.task.updated',
      inboxEnabled: true,
      emailEnabled: false,
      digestMode: 'disabled',
    })
  })

  it('upserts email templates from the admin endpoint', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/admin/pusher/email/templates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          templateId: 'project-task-updated',
          version: 1,
          appId: 'project',
          category: 'transactional',
          eventTypes: ['project.task.updated'],
          subject: { 'zh-CN': '任务已更新' },
          htmlBody: { 'zh-CN': '<p>{{title}}</p>' },
          textBody: { 'zh-CN': '{{title}}' },
          variables: ['title'],
          enabled: true,
        }),
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.templateId).toBe('project-task-updated')
    })

    expect(serviceMocks.upsertEmailTemplate).toHaveBeenCalledWith({
      templateId: 'project-task-updated',
      version: 1,
      appId: 'project',
      category: 'transactional',
      eventTypes: ['project.task.updated'],
      subject: { 'zh-CN': '任务已更新' },
      htmlBody: { 'zh-CN': '<p>{{title}}</p>' },
      textBody: { 'zh-CN': '{{title}}' },
      variables: ['title'],
      enabled: true,
    })
  })
})
