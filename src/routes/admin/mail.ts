import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { getMailProviderStatus, sendMail } from '../../domain/service/mailProvider'
import { PusherService } from '../../domain/service/pusher'
import { executeSignedAction, getActionSignatureErrorStatus } from '../../auth/actionSignature'
import { getRequestUser } from '../../common/requestContext'

function parseChannels(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || '').trim()).filter(Boolean)
  }
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseObject(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => [String(key || '').trim(), String(value || '')])
      .filter(([key]) => Boolean(key))
  )
}

function mapMailError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : 'Mail request failed'
  if (message === 'Missing access token') {
    return { status: 401, message }
  }
  if (message.includes('permission') || message.includes('denied') || message === 'USER_BLOCKED') {
    return { status: 403, message }
  }
  return { status: 400, message }
}

function normalizeEmail(input: unknown): string {
  return String(input || '').trim().toLowerCase()
}

export function registerAdminMailRoutes(app: Express) {
  const pusherService = new PusherService()

  app.get('/api/v1/admin/mail/settings', async (_req: Request, res: Response) => {
    try {
      res.json(ok(getMailProviderStatus()))
    } catch (error) {
      const mapped = mapMailError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/admin/mail/tests', async (req: Request, res: Response) => {
    try {
      const to = normalizeEmail(req.body?.to)
      if (!to || !to.includes('@')) {
        throw new Error('Test email recipient is required')
      }
      const subject = String(req.body?.subject || 'YeYing Node mail test').trim() || 'YeYing Node mail test'
      const now = new Date().toISOString()
      const text = `YeYing Node mail delivery test succeeded at ${now}.`
      const html = `<p>YeYing Node mail delivery test succeeded at <strong>${now}</strong>.</p>`
      const actor = getRequestUser()
      if (!actor?.address) { res.status(401).json(fail(401, 'Missing access token')); return }
      const result = await executeSignedAction({ raw: req.body || {}, action: 'admin_mail_test', actor: actor.address, payload: { to, subject }, execute: async () => {
        const messageId = await sendMail({ to, subject, text, html })
        return { status: 200, body: ok({ accepted: true, messageId }) }
      }, onError: error => { const message = error instanceof Error ? error.message : 'Mail request failed'; const status = getActionSignatureErrorStatus(message) ?? 400; return { status, body: fail(status, message) } } })
      res.status(result.status).json(result.body)
    } catch (error) {
      const mapped = mapMailError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/admin/mail/templates', async (_req: Request, res: Response) => {
    try {
      const items = await pusherService.listEmailTemplates()
      res.json(ok({ items }))
    } catch (error) {
      const mapped = mapMailError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/admin/mail/templates', async (req: Request, res: Response) => {
    try {
      const actor = getRequestUser()
      if (!actor?.address) { res.status(401).json(fail(401, 'Missing access token')); return }
      const payload = {
        templateId: req.body?.templateId,
        version: req.body?.version,
        appId: req.body?.appId,
        category: req.body?.category,
        eventTypes: parseChannels(req.body?.eventTypes),
        subject: parseObject(req.body?.subject),
        htmlBody: parseObject(req.body?.htmlBody),
        textBody: parseObject(req.body?.textBody),
        variables: parseChannels(req.body?.variables),
        enabled: req.body?.enabled,
      }
      const result = await executeSignedAction({ raw: req.body || {}, action: 'admin_mail_template_upsert', actor: actor.address, payload, execute: async () => ({ status: 200, body: ok(await pusherService.upsertEmailTemplate(payload)) }), onError: error => { const message = error instanceof Error ? error.message : 'Mail request failed'; const status = getActionSignatureErrorStatus(message) ?? 400; return { status, body: fail(status, message) } } })
      res.status(result.status).json(result.body)
    } catch (error) {
      const mapped = mapMailError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.patch('/api/v1/admin/mail/templates/:templateId', async (req: Request, res: Response) => {
    try {
      const actor = getRequestUser()
      if (!actor?.address) { res.status(401).json(fail(401, 'Missing access token')); return }
      const payload = {
        templateId: req.params.templateId,
        version: req.body?.version,
        appId: req.body?.appId,
        category: req.body?.category,
        eventTypes: parseChannels(req.body?.eventTypes),
        subject: parseObject(req.body?.subject),
        htmlBody: parseObject(req.body?.htmlBody),
        textBody: parseObject(req.body?.textBody),
        variables: parseChannels(req.body?.variables),
        enabled: req.body?.enabled,
      }
      const result = await executeSignedAction({ raw: req.body || {}, action: 'admin_mail_template_upsert', actor: actor.address, payload, execute: async () => ({ status: 200, body: ok(await pusherService.upsertEmailTemplate(payload)) }), onError: error => { const message = error instanceof Error ? error.message : 'Mail request failed'; const status = getActionSignatureErrorStatus(message) ?? 400; return { status, body: fail(status, message) } } })
      res.status(result.status).json(result.body)
    } catch (error) {
      const mapped = mapMailError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })
}
