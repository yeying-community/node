import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { ensureUserActive } from '../../common/permission'
import { getRequestUser } from '../../common/requestContext'
import { NotificationService } from '../../domain/service/notification'
import { subscribeNotificationEvents } from '../../domain/service/notificationEvents'

function normalizeRecipient(input: unknown): string {
  return String(input || '').trim().toLowerCase()
}

function parsePositiveInt(input: unknown, fallback: number): number {
  const value = Number(input)
  if (!Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return Math.trunc(value)
}

function parseBoolean(input: unknown): boolean {
  if (typeof input === 'boolean') {
    return input
  }
  const value = String(input || '').trim().toLowerCase()
  return value === 'true' || value === '1'
}

function resolveCurrentAddress(): string {
  const user = getRequestUser()
  return normalizeRecipient(user?.address)
}

function mapNotificationError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : 'Notification request failed'
  switch (message) {
    case 'Missing access token':
      return { status: 401, message }
    case 'USER_BLOCKED':
      return { status: 403, message }
    default:
      return { status: 500, message }
  }
}

export function registerPublicNotificationRoutes(app: Express) {
  const service = new NotificationService()

  app.get('/api/v1/public/notifications', async (req: Request, res: Response) => {
    try {
      const address = resolveCurrentAddress()
      if (!address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      await ensureUserActive(address)
      const result = await service.list({
        recipient: address,
        unreadOnly: parseBoolean(req.query.unreadOnly),
        page: parsePositiveInt(req.query.page, 1),
        pageSize: parsePositiveInt(req.query.pageSize, 20),
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapNotificationError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/notifications/unread-count', async (_req: Request, res: Response) => {
    try {
      const address = resolveCurrentAddress()
      if (!address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      await ensureUserActive(address)
      const unreadCount = await service.getUnreadCount(address)
      res.json(ok({ unreadCount }))
    } catch (error) {
      const mapped = mapNotificationError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/notifications/:uid/read', async (req: Request, res: Response) => {
    try {
      const address = resolveCurrentAddress()
      if (!address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      await ensureUserActive(address)
      const inbox = await service.markRead(req.params.uid, address)
      if (!inbox) {
        res.status(404).json(fail(404, 'Notification not found'))
        return
      }
      res.json(
        ok({
          notificationUid: inbox.notificationUid,
          isRead: inbox.isRead,
          readAt: inbox.readAt,
        })
      )
    } catch (error) {
      const mapped = mapNotificationError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/notifications/read-all', async (_req: Request, res: Response) => {
    try {
      const address = resolveCurrentAddress()
      if (!address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      await ensureUserActive(address)
      const updatedCount = await service.markAllRead(address)
      res.json(ok({ updatedCount }))
    } catch (error) {
      const mapped = mapNotificationError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/notifications/stream', async (req: Request, res: Response) => {
    const address = resolveCurrentAddress()
    if (!address) {
      res.status(401).json(fail(401, 'Missing access token'))
      return
    }
    try {
      await ensureUserActive(address)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()

      const writeEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`)
        res.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      writeEvent('ready', { recipient: address, timestamp: Date.now() })
      const unreadCount = await service.getUnreadCount(address)
      writeEvent('unread-count', { unreadCount, timestamp: Date.now() })

      const unsubscribe = subscribeNotificationEvents(address, (event) => {
        writeEvent(event.event, event)
      })

      const heartbeat = setInterval(() => {
        res.write(`: ping ${Date.now()}\n\n`)
      }, 15000)

      req.on('close', () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
    } catch (error) {
      const mapped = mapNotificationError(error)
      if (!res.headersSent) {
        res.status(mapped.status).json(fail(mapped.status, mapped.message))
        return
      }
      res.write(`event: error\n`)
      res.write(`data: ${JSON.stringify({ message: mapped.message })}\n\n`)
      res.end()
    }
  })
}
