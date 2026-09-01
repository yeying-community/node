import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { ensureUserActive } from '../../common/permission'
import { getRequestUser } from '../../common/requestContext'
import { PusherService } from '../../domain/service/pusher'
import { subscribePusherEvents } from '../../domain/service/pusherEvents'

function parseChannels(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || '').trim()).filter(Boolean)
  }
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeSubject(input: unknown): string {
  return String(input || '').trim().toLowerCase()
}

function currentSubject(): string {
  return normalizeSubject(getRequestUser()?.address)
}

function mapPusherError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : 'Pusher request failed'
  if (message === 'Missing access token') {
    return { status: 401, message }
  }
  if (
    message.includes('not found') ||
    message.includes('Invalid pusher key') ||
    message.includes('Invalid pusher signature') ||
    message.includes('Invalid pusher timestamp')
  ) {
    return { status: 401, message }
  }
  if (message.includes('denied') || message.includes('not allowed') || message === 'USER_BLOCKED') {
    return { status: 403, message }
  }
  return { status: 400, message }
}

export function registerPublicPusherRoutes(app: Express) {
  const service = new PusherService()

  app.post('/api/v1/public/pusher/apps/:appId/events', async (req: Request, res: Response) => {
    try {
      const result = await service.publish({
        appId: req.params.appId,
        key: String(req.headers['x-pusher-key'] || '').trim(),
        timestamp: String(req.headers['x-pusher-timestamp'] || '').trim(),
        signature: String(req.headers['x-pusher-signature'] || '').trim(),
        body: req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {},
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/pusher/apps/:appId/stream', async (req: Request, res: Response) => {
    const user = getRequestUser()
    const subject = normalizeSubject(user?.address)
    if (!subject) {
      res.status(401).json(fail(401, 'Missing access token'))
      return
    }

    const channels = parseChannels(req.query.channels)
    try {
      await ensureUserActive(subject)
      await service.assertCanSubscribe({
        appId: req.params.appId,
        channels,
        subject,
        origin: req.headers.origin,
      })

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()

      const writeEvent = (event: string, data: unknown, id?: string) => {
        if (id) {
          res.write(`id: ${id}\n`)
        }
        res.write(`event: ${event}\n`)
        res.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      writeEvent('ready', {
        appId: req.params.appId,
        channels,
        timestamp: Date.now(),
      })

      const cursor = String(req.headers['last-event-id'] || req.query.cursor || '').trim()
      if (cursor) {
        const backlog = await service.listBacklog({
          appId: req.params.appId,
          channels,
          cursor,
          limit: 200,
        })
        for (const item of backlog) {
          writeEvent(item.type, item, item.id)
        }
      }

      const unsubscribe = subscribePusherEvents(channels, (event) => {
        writeEvent(event.type, event, event.id)
      })

      const heartbeat = setInterval(() => {
        res.write(`: ping ${Date.now()}\n\n`)
      }, 15000)

      req.on('close', () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
    } catch (error) {
      const mapped = mapPusherError(error)
      if (!res.headersSent) {
        res.status(mapped.status).json(fail(mapped.status, mapped.message))
        return
      }
      res.write('event: error\n')
      res.write(`data: ${JSON.stringify({ message: mapped.message })}\n\n`)
      res.end()
    }
  })

  app.get('/api/v1/public/pusher/notification-preferences', async (_req: Request, res: Response) => {
    const subject = currentSubject()
    if (!subject) {
      res.status(401).json(fail(401, 'Missing access token'))
      return
    }
    try {
      await ensureUserActive(subject)
      const items = await service.listNotificationPreferences(subject)
      res.json(ok({ items }))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.patch('/api/v1/public/pusher/notification-preferences', async (req: Request, res: Response) => {
    const subject = currentSubject()
    if (!subject) {
      res.status(401).json(fail(401, 'Missing access token'))
      return
    }
    try {
      await ensureUserActive(subject)
      const item = await service.upsertNotificationPreference({
        subject,
        appId: req.body?.appId,
        eventType: req.body?.eventType,
        inboxEnabled: req.body?.inboxEnabled,
        emailEnabled: req.body?.emailEnabled,
        digestMode: req.body?.digestMode,
      })
      res.json(ok(item))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })
}

export function registerAdminPusherRoutes(app: Express) {
  const service = new PusherService()

  app.get('/api/v1/admin/pusher/apps', async (_req: Request, res: Response) => {
    try {
      const items = await service.listApps()
      res.json(ok({ items }))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/admin/pusher/apps', async (req: Request, res: Response) => {
    try {
      const item = await service.createApp({
        appId: req.body?.appId,
        allowedOrigins: parseChannels(req.body?.allowedOrigins),
        channelPatterns: parseChannels(req.body?.channelPatterns),
      })
      res.json(ok(item))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/admin/pusher/project-identities', async (req: Request, res: Response) => {
    try {
      const items = await service.listProjectIdentityMappings(String(req.query.instanceId || '').trim())
      res.json(ok({ items }))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/admin/pusher/project-identities', async (req: Request, res: Response) => {
    try {
      const item = await service.upsertProjectIdentityMapping({
        instanceId: req.body?.instanceId,
        projectUserId: req.body?.projectUserId,
        identityDid: req.body?.identityDid,
        walletAddress: req.body?.walletAddress,
        metadata: req.body?.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : {},
        status: req.body?.status,
      })
      res.json(ok(item))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/admin/pusher/email/templates', async (_req: Request, res: Response) => {
    try {
      const items = await service.listEmailTemplates()
      res.json(ok({ items }))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/admin/pusher/email/templates', async (req: Request, res: Response) => {
    try {
      const item = await service.upsertEmailTemplate({
        templateId: req.body?.templateId,
        version: req.body?.version,
        appId: req.body?.appId,
        category: req.body?.category,
        eventTypes: parseChannels(req.body?.eventTypes),
        subject: req.body?.subject && typeof req.body.subject === 'object' && !Array.isArray(req.body.subject)
          ? req.body.subject
          : {},
        htmlBody: req.body?.htmlBody && typeof req.body.htmlBody === 'object' && !Array.isArray(req.body.htmlBody)
          ? req.body.htmlBody
          : {},
        textBody: req.body?.textBody && typeof req.body.textBody === 'object' && !Array.isArray(req.body.textBody)
          ? req.body.textBody
          : {},
        variables: parseChannels(req.body?.variables),
        enabled: req.body?.enabled,
      })
      res.json(ok(item))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.patch('/api/v1/admin/pusher/email/templates/:templateId', async (req: Request, res: Response) => {
    try {
      const item = await service.upsertEmailTemplate({
        templateId: req.params.templateId,
        version: req.body?.version,
        appId: req.body?.appId,
        category: req.body?.category,
        eventTypes: parseChannels(req.body?.eventTypes),
        subject: req.body?.subject && typeof req.body.subject === 'object' && !Array.isArray(req.body.subject)
          ? req.body.subject
          : {},
        htmlBody: req.body?.htmlBody && typeof req.body.htmlBody === 'object' && !Array.isArray(req.body.htmlBody)
          ? req.body.htmlBody
          : {},
        textBody: req.body?.textBody && typeof req.body.textBody === 'object' && !Array.isArray(req.body.textBody)
          ? req.body.textBody
          : {},
        variables: parseChannels(req.body?.variables),
        enabled: req.body?.enabled,
      })
      res.json(ok(item))
    } catch (error) {
      const mapped = mapPusherError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })
}
