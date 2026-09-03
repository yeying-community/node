import express, { Express } from 'express'
import { AddressInfo } from 'net'
import { mockClass } from './support/mockClass'

const mailProviderMocks = {
  getMailProviderStatus: vi.fn(),
  sendMail: vi.fn(),
}

const pusherServiceMocks = {
  listEmailTemplates: vi.fn(),
  upsertEmailTemplate: vi.fn(),
}

vi.doMock('../src/domain/service/mailProvider', () => mailProviderMocks)

vi.doMock('../src/domain/service/pusher', () => ({
  PusherService: mockClass(() => pusherServiceMocks),
}))

const { registerAdminMailRoutes } = await import('../src/routes/admin/mail')

function createTestApp() {
  const app = express()
  app.use(express.json())
  registerAdminMailRoutes(app)
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

describe('mail admin routes', () => {
  beforeEach(() => {
    for (const fn of Object.values(mailProviderMocks)) {
      fn.mockReset()
    }
    for (const fn of Object.values(pusherServiceMocks)) {
      fn.mockReset()
    }
    mailProviderMocks.getMailProviderStatus.mockReturnValue({
      provider: 'smtp',
      configured: true,
      host: 'smtp.example.org',
      port: 465,
      secure: true,
      from: 'YeYing Notifications <no-reply@example.org>',
      replyTo: 'support@example.org',
      hasAuthUser: true,
      hasAuthPassword: true,
      issues: [],
      delivery: {
        enabled: true,
        intervalMs: 30000,
        batchSize: 20,
        maxAttempts: 5,
        retryBaseDelayMs: 30000,
        retryMaxDelayMs: 900000,
      },
    })
    mailProviderMocks.sendMail.mockResolvedValue('message-1')
    pusherServiceMocks.listEmailTemplates.mockResolvedValue([])
    pusherServiceMocks.upsertEmailTemplate.mockResolvedValue({
      uid: 'template-1',
      templateId: 'project-task-updated',
      version: 1,
      appId: 'project',
      category: 'transactional',
      eventTypes: ['project.task.updated'],
      subject: { 'zh-CN': '任务已更新' },
      htmlBody: { 'zh-CN': '<p>{{notification.title}}</p>' },
      textBody: { 'zh-CN': '{{notification.title}}' },
      variables: ['notification.title'],
      enabled: true,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    })
  })

  it('returns mail provider status without SMTP secrets', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/admin/mail/settings`)
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.configured).toBe(true)
      expect(json.data.host).toBe('smtp.example.org')
      expect(json.data.hasAuthUser).toBe(true)
      expect(json.data.auth).toBeUndefined()
      expect(json.data.password).toBeUndefined()
      expect(json.data.smtpPassword).toBeUndefined()
    })
  })

  it('sends a mail test through the shared mail provider', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/admin/mail/tests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'Admin@Example.org', subject: 'Custom test' }),
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data).toEqual({ accepted: true, messageId: 'message-1' })
    })

    expect(mailProviderMocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@example.org',
      subject: 'Custom test',
    }))
  })

  it('upserts email templates from the dedicated mail endpoint', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/admin/mail/templates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          templateId: 'project-task-updated',
          version: 1,
          appId: 'project',
          category: 'transactional',
          eventTypes: ['project.task.updated'],
          subject: { 'zh-CN': '任务已更新' },
          htmlBody: { 'zh-CN': '<p>{{notification.title}}</p>' },
          textBody: { 'zh-CN': '{{notification.title}}' },
          variables: ['notification.title'],
          enabled: true,
        }),
      })
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.templateId).toBe('project-task-updated')
    })

    expect(pusherServiceMocks.upsertEmailTemplate).toHaveBeenCalledWith({
      templateId: 'project-task-updated',
      version: 1,
      appId: 'project',
      category: 'transactional',
      eventTypes: ['project.task.updated'],
      subject: { 'zh-CN': '任务已更新' },
      htmlBody: { 'zh-CN': '<p>{{notification.title}}</p>' },
      textBody: { 'zh-CN': '{{notification.title}}' },
      variables: ['notification.title'],
      enabled: true,
    })
  })
})
