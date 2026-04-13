import { Express, Request, Response } from 'express'
import { executeSignedAction, getActionSignatureErrorStatus } from '../../auth/actionSignature'
import { ok, fail } from '../../auth/envelope'
import { isUcanToken, verifyUcanInvocationWithCap } from '../../auth/ucan'
import { getRequestUser } from '../../common/requestContext'
import { ensureUserActive, ensureUserCanWriteBusinessData } from '../../common/permission'
import { getConfig } from '../../config/runtime'
import { MpcRuntimeConfig, RedisRuntimeConfig } from '../../config'
import { MpcService } from '../../domain/service/mpc'
import { createMpcStreamReader, readMpcEventStream, subscribeMpcEvents } from '../../domain/service/mpcEvents'

function normalizeStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean)
      }
    } catch {
      // ignore parse errors
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function parseNumber(input: unknown): number | undefined {
  if (input === undefined || input === null || input === '') return undefined
  const numeric = Number(input)
  return Number.isFinite(numeric) ? numeric : undefined
}

function getBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization || ''
  const [scheme, rawToken] = authHeader.split(' ')
  const token = scheme?.toLowerCase() === 'bearer' ? rawToken : authHeader
  return token || undefined
}

function requireMpcUcan(req: Request) {
  const user = getRequestUser()
  if (!user?.address) {
    throw new Error('Missing access token')
  }
  const token = getBearerToken(req)
  if (!token) {
    throw new Error('Missing access token')
  }
  if (!isUcanToken(token)) {
    throw new Error('UCAN token required')
  }
  const config = (getConfig<MpcRuntimeConfig>('mpc') || {}) as MpcRuntimeConfig
  const resource = (config.ucanWith || '').trim()
  const action = (config.ucanCan || '').trim()
  if (!resource && !action) {
    return
  }
  verifyUcanInvocationWithCap(token, [
    {
      with: resource || '*',
      can: action || '*'
    }
  ])
}

function mapMpcError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : 'MPC request failed'
  const signatureStatus = getActionSignatureErrorStatus(raw)
  if (signatureStatus !== undefined) {
    return { status: signatureStatus, message: raw }
  }
  switch (raw) {
    case 'SESSION_NOT_FOUND':
      return { status: 404, message: 'Session not found' }
    case 'SESSION_EXISTS':
      return { status: 409, message: 'Session already exists' }
    case 'SESSION_EXPIRED':
      return { status: 410, message: 'Session expired' }
    case 'FORBIDDEN':
      return { status: 403, message: 'Forbidden' }
    case 'PARTICIPANT_NOT_ALLOWED':
      return { status: 403, message: 'Participant not allowed' }
    case 'PARTICIPANT_NOT_JOINED':
      return { status: 403, message: 'Participant not joined' }
    case 'IDENTITY_MISMATCH':
      return { status: 403, message: 'Identity mismatch' }
    case 'INVALID_SESSION_TYPE':
      return { status: 400, message: 'Invalid session type' }
    case 'INVALID_THRESHOLD':
      return { status: 400, message: 'Invalid threshold' }
    case 'MISSING_WALLET_ID':
      return { status: 400, message: 'Missing walletId' }
    case 'MISSING_PARTICIPANTS':
      return { status: 400, message: 'Missing participants' }
    case 'THRESHOLD_EXCEEDS_PARTICIPANTS':
      return { status: 400, message: 'Threshold exceeds participant count' }
    case 'Missing access token':
      return { status: 401, message: 'Missing access token' }
    case 'USER_BLOCKED':
      return { status: 403, message: 'User blocked' }
    case 'USER_ROLE_DENIED':
      return { status: 403, message: 'User role denied' }
    case 'UCAN capability denied':
      return { status: 403, message: 'UCAN capability denied' }
    case 'UCAN token required':
      return { status: 401, message: 'UCAN token required' }
    case 'UCAN audience mismatch':
    case 'Invalid UCAN token':
    case 'Invalid UCAN signature':
    case 'UCAN expired':
    case 'UCAN not active':
      return { status: 401, message: 'Invalid UCAN token' }
    default:
      return { status: 500, message: raw }
  }
}

export function registerPublicMpcRoutes(app: Express) {
  const service = new MpcService()

  app.post('/api/v1/public/mpc/sessions', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      requireMpcUcan(req)
      await ensureUserActive(user.address)
      await ensureUserCanWriteBusinessData(user.address)
      const body = req.body || {}
      const type = String(body.type || '').trim()
      const walletId = String(body.walletId || '').trim()
      const threshold = Number(body.threshold)
      const participants = normalizeStringArray(body.participants)
      const curve = String(body.curve || '').trim()
      const expiresAt = body.expiresAt !== undefined ? String(body.expiresAt) : ''
      const sessionId = body.id || body.sessionId || ''
      const result = await executeSignedAction({
        raw: body,
        action: 'mpc_session_create',
        actor: user.address,
        payload: {
          requestedSessionId: sessionId ? String(sessionId) : '',
          type,
          walletId,
          threshold,
          participants,
          curve: curve || '',
          expiresAt: expiresAt || '',
          keyVersion: parseNumber(body.keyVersion),
          shareVersion: parseNumber(body.shareVersion),
        },
        execute: async () => {
          const session = await service.createSession(
            {
              id: sessionId ? String(sessionId) : undefined,
              type,
              walletId,
              threshold,
              participants,
              curve: curve || undefined,
              expiresAt: expiresAt || undefined,
              keyVersion: parseNumber(body.keyVersion),
              shareVersion: parseNumber(body.shareVersion)
            },
            user.address
          )
          return { status: 200, body: ok(session) }
        },
        onError: (error) => {
          const mapped = mapMpcError(error)
          return { status: mapped.status, body: fail(mapped.status, mapped.message) }
        }
      })
      res.status(result.status).json(result.body)
    } catch (error) {
      const mapped = mapMpcError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/mpc/sessions/:sessionId/join', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      requireMpcUcan(req)
      await ensureUserActive(user.address)
      await ensureUserCanWriteBusinessData(user.address)
      const body = req.body || {}
      const sessionId = req.params.sessionId
      const participantId = String(body.participantId || '').trim()
      const deviceId = String(body.deviceId || '').trim()
      const identity = String(body.identity || '').trim()
      const e2ePublicKey = String(body.e2ePublicKey || '').trim()
      const signingPublicKey = String(body.signingPublicKey || '').trim()

      if (!participantId || !deviceId || !identity || !e2ePublicKey) {
        res.status(400).json(fail(400, 'Missing participant info'))
        return
      }
      const result = await executeSignedAction({
        raw: body,
        action: 'mpc_session_join',
        actor: user.address,
        payload: {
          sessionId,
          participantId,
          deviceId,
          identity,
          e2ePublicKey,
          signingPublicKey: signingPublicKey || ''
        },
        execute: async () => {
          const joined = await service.joinSession(
            sessionId,
            {
              participantId,
              deviceId,
              identity,
              e2ePublicKey,
              signingPublicKey: signingPublicKey || undefined
            },
            user.address
          )
          return { status: 200, body: ok(joined) }
        },
        onError: (error) => {
          const mapped = mapMpcError(error)
          return { status: mapped.status, body: fail(mapped.status, mapped.message) }
        }
      })
      res.status(result.status).json(result.body)
    } catch (error) {
      const mapped = mapMpcError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/mpc/sessions/:sessionId/messages', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      requireMpcUcan(req)
      await ensureUserActive(user.address)
      await ensureUserCanWriteBusinessData(user.address)
      const sessionId = req.params.sessionId
      const payload = req.body?.message ?? req.body ?? {}
      const rawSignature =
        req.body?.message && typeof req.body.message === 'object'
          ? {
              ...(req.body.message as Record<string, unknown>),
              requestId: req.body?.requestId ?? (req.body.message as Record<string, unknown>).requestId,
              timestamp: req.body?.timestamp ?? (req.body.message as Record<string, unknown>).timestamp,
              signature: req.body?.signature ?? (req.body.message as Record<string, unknown>).signature
            }
          : (req.body || {})
      const messageId = String(payload.id || '').trim()
      const sender = String(payload.from || '').trim()
      const messageType = String(payload.type || '').trim()
      if (!messageId) {
        res.status(400).json(fail(400, 'Missing message id'))
        return
      }
      if (!sender || !messageType) {
        res.status(400).json(fail(400, 'Missing message sender or type'))
        return
      }
      const result = await executeSignedAction({
        raw: rawSignature,
        action: 'mpc_message_send',
        actor: user.address,
        payload: {
          sessionId,
          messageId,
          from: sender,
          to: payload.to ? String(payload.to) : '',
          round: parseNumber(payload.round),
          type: messageType,
          seq: parseNumber(payload.seq),
          envelope: payload.envelope ?? {}
        },
        execute: async () => {
          const response = await service.sendMessage(
            sessionId,
            {
              id: messageId,
              from: sender,
              to: payload.to ? String(payload.to) : undefined,
              round: parseNumber(payload.round),
              type: messageType,
              seq: parseNumber(payload.seq),
              envelope: payload.envelope ?? {}
            },
            user.address
          )
          return { status: 200, body: ok(response) }
        },
        onError: (error) => {
          const mapped = mapMpcError(error)
          return { status: mapped.status, body: fail(mapped.status, mapped.message) }
        }
      })
      res.status(result.status).json(result.body)
    } catch (error) {
      const mapped = mapMpcError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/mpc/sessions/:sessionId/messages', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      requireMpcUcan(req)
      await ensureUserActive(user.address)
      const sessionId = req.params.sessionId
      const since = parseNumber(req.query.since)
      const cursor = req.query.cursor ? String(req.query.cursor) : undefined
      const limit = parseNumber(req.query.limit)
      const response = await service.fetchMessages(sessionId, user.address, since, cursor, limit)
      res.json(ok(response))
    } catch (error) {
      const mapped = mapMpcError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/mpc/sessions/:sessionId', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      requireMpcUcan(req)
      await ensureUserActive(user.address)
      const sessionId = req.params.sessionId
      const response = await service.getSession(sessionId, user.address)
      res.json(ok(response))
    } catch (error) {
      const mapped = mapMpcError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/mpc/ws', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser()
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'))
        return
      }
      requireMpcUcan(req)
      await ensureUserActive(user.address)
      const sessionId = String(req.query.sessionId || '').trim()
      if (!sessionId) {
        res.status(400).json(fail(400, 'Missing sessionId'))
        return
      }
      await service.getSession(sessionId, user.address)

      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders?.()

      const lastEventId = String(req.headers['last-event-id'] || req.query.cursor || '').trim()
      const redisConfig = (getConfig<RedisRuntimeConfig>('redis') || {}) as RedisRuntimeConfig
      const streamOnly = Boolean(redisConfig.streamOnly)
      if (lastEventId) {
        const backlog = await readMpcEventStream(sessionId, lastEventId, 200)
        for (const record of backlog) {
          res.write(`id: ${record.id}\n`)
          res.write(`event: ${record.event.type}\n`)
          res.write(`data: ${JSON.stringify(record.event)}\n\n`)
        }
      }

      res.write(`event: connected\n`)
      res.write(`data: ${JSON.stringify({ sessionId, timestamp: Date.now() })}\n\n`)

      let unsubscribe: () => void = () => undefined
      let streamReaderClose: () => void = () => undefined
      if (streamOnly) {
        const startId = lastEventId || '$'
        const reader = createMpcStreamReader(sessionId, startId, (record) => {
          res.write(`id: ${record.id}\n`)
          res.write(`event: ${record.event.type}\n`)
          res.write(`data: ${JSON.stringify(record.event)}\n\n`)
        })
        streamReaderClose = reader.close
      } else {
        unsubscribe = subscribeMpcEvents(sessionId, (event) => {
          if (event.streamId) {
            res.write(`id: ${event.streamId}\n`)
          }
          res.write(`event: ${event.type}\n`)
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        })
      }

      const heartbeat = setInterval(() => {
        res.write(`event: ping\n`)
        res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`)
      }, 20000)

      req.on('close', () => {
        clearInterval(heartbeat)
        unsubscribe()
        streamReaderClose()
      })
    } catch (error) {
      const mapped = mapMpcError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })
}
