import { apiUrl } from '@/plugins/api'
import { getStoredAuthToken } from '@/plugins/auth'

type Envelope<T> = {
  code: number
  message: string
  data: T
  timestamp: number
}

export type NotificationListItem = {
  uid: string
  notificationUid: string
  type: string
  source: string
  subjectType: string
  subjectId: string
  actor: string
  audienceType: string
  audienceIds: string[]
  level: string
  title: string
  body: string
  payload: Record<string, unknown>
  status: string
  isRead: boolean
  readAt: string
  deliveredAt: string
  archivedAt: string
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export type NotificationPageResult = {
  items: NotificationListItem[]
  page: {
    total: number
    page: number
    pageSize: number
  }
}

export type NotificationUnreadCount = {
  unreadCount: number
}

export type NotificationStreamPayload =
  | {
      event: 'notification.created' | 'notification.read'
      recipient: string
      notificationUid: string
      unreadCount?: number
      timestamp: number
    }
  | {
      recipient: string
      timestamp: number
    }
  | {
      unreadCount: number
      timestamp: number
    }
  | {
      message: string
    }

export type NotificationWebhookItem = {
  uid: string
  owner: string
  applicationUid: string
  events: string[]
  targetUrl: string
  secretMasked: string
  enabled: boolean
  lastTriggeredAt: string
  createdAt: string
  updatedAt: string
}

type NotificationStreamHandlers = {
  onEvent?: (event: string, data: NotificationStreamPayload) => void
  onError?: (error: Error) => void
}

function getAuthorizationHeaders(): Record<string, string> {
  const token = getStoredAuthToken()
  if (!token) {
    throw new Error('缺少登录态，请重新登录')
  }
  return {
    Authorization: `Bearer ${token}`,
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as Envelope<T>
  if (!response.ok || payload?.code !== 0) {
    const message = String(payload?.message || response.statusText || 'Request failed')
    throw new Error(message)
  }
  return payload.data
}

function splitSseBlocks(input: string): { blocks: string[]; remain: string } {
  const normalized = input.replace(/\r\n/g, '\n')
  const blocks = normalized.split('\n\n')
  if (normalized.endsWith('\n\n')) {
    return { blocks: blocks.filter(Boolean), remain: '' }
  }
  const remain = blocks.pop() || ''
  return { blocks: blocks.filter(Boolean), remain }
}

function parseSseBlock(block: string): { id: string; event: string; data: string } | null {
  const lines = block.split('\n')
  let id = ''
  let event = 'message'
  const dataLines: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(':')) {
      continue
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message'
      continue
    }
    if (line.startsWith('id:')) {
      id = line.slice(3).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) {
    return null
  }
  return {
    id,
    event,
    data: dataLines.join('\n'),
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false
  const message = error instanceof Error ? error.message : String(error)
  const normalizedMessage = message.toLowerCase()
  const name = error instanceof Error ? error.name : ''
  return (
    name === 'AbortError' ||
    message.includes('BodyStreamBuffer was aborted') ||
    message.includes('The operation was aborted') ||
    normalizedMessage.includes('aborted')
  )
}

let lastStreamEventId = ''

class NotificationClient {
  async list(input: {
    page?: number
    pageSize?: number
    unreadOnly?: boolean
    source?: string
    level?: string
    applicationUid?: string
  } = {}) {
    const params = new URLSearchParams()
    params.set('page', String(input.page || 1))
    params.set('pageSize', String(input.pageSize || 20))
    if (input.unreadOnly) {
      params.set('unreadOnly', 'true')
    }
    if (input.source) {
      params.set('source', input.source)
    }
    if (input.level) {
      params.set('level', input.level)
    }
    if (input.applicationUid) {
      params.set('applicationUid', input.applicationUid)
    }
    const response = await fetch(apiUrl(`/api/v1/public/notifications?${params.toString()}`), {
      method: 'GET',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<NotificationPageResult>(response)
  }

  async detail(notificationUid: string) {
    const response = await fetch(apiUrl(`/api/v1/public/notifications/${notificationUid}`), {
      method: 'GET',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<NotificationListItem>(response)
  }

  async unreadCount() {
    const response = await fetch(apiUrl('/api/v1/public/notifications/unread-count'), {
      method: 'GET',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<NotificationUnreadCount>(response)
  }

  async markRead(notificationUid: string) {
    const response = await fetch(apiUrl(`/api/v1/public/notifications/${notificationUid}/read`), {
      method: 'POST',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<{ notificationUid: string; isRead: boolean; readAt: string }>(response)
  }

  async markAllRead() {
    const response = await fetch(apiUrl('/api/v1/public/notifications/read-all'), {
      method: 'POST',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<{ updatedCount: number }>(response)
  }

  async listWebhooks() {
    const response = await fetch(apiUrl('/api/v1/public/notifications/webhooks'), {
      method: 'GET',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<{ items: NotificationWebhookItem[] }>(response)
  }

  async createWebhook(input: {
    applicationUid?: string
    events: string[]
    targetUrl: string
    secret?: string
    enabled?: boolean
  }) {
    const response = await fetch(apiUrl('/api/v1/public/notifications/webhooks'), {
      method: 'POST',
      headers: {
        ...getAuthorizationHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    return await parseEnvelope<NotificationWebhookItem>(response)
  }

  async updateWebhook(uid: string, input: {
    applicationUid?: string
    events?: string[]
    targetUrl?: string
    secret?: string
    enabled?: boolean
  }) {
    const response = await fetch(apiUrl(`/api/v1/public/notifications/webhooks/${uid}`), {
      method: 'PATCH',
      headers: {
        ...getAuthorizationHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    return await parseEnvelope<NotificationWebhookItem>(response)
  }

  async deleteWebhook(uid: string) {
    const response = await fetch(apiUrl(`/api/v1/public/notifications/webhooks/${uid}`), {
      method: 'DELETE',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<{ deleted: boolean }>(response)
  }

  openStream(handlers: NotificationStreamHandlers = {}) {
    const controller = new AbortController()
    let closed = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let closePromise: Promise<void> | null = null

    const run = async () => {
      try {
        const streamPath = lastStreamEventId
          ? `/api/v1/public/notifications/stream?cursor=${encodeURIComponent(lastStreamEventId)}`
          : '/api/v1/public/notifications/stream'
        const response = await fetch(apiUrl(streamPath), {
          method: 'GET',
          headers: {
            ...getAuthorizationHeaders(),
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          throw new Error(`通知流连接失败: ${response.status}`)
        }
        reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        while (!closed) {
          const { value, done } = await reader.read()
          if (done) {
            break
          }
          buffer += decoder.decode(value, { stream: true })
          const { blocks, remain } = splitSseBlocks(buffer)
          buffer = remain
          for (const block of blocks) {
            const parsed = parseSseBlock(block)
            if (!parsed) {
              continue
            }
            if (parsed.id) {
              lastStreamEventId = parsed.id
            }
            try {
              const data = JSON.parse(parsed.data) as NotificationStreamPayload
              handlers.onEvent?.(parsed.event, data)
            } catch {
              // ignore invalid event payload
            }
          }
        }
      } catch (error) {
        if (closed || controller.signal.aborted || isAbortLikeError(error)) {
          return
        }
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      } finally {
        try {
          reader?.releaseLock()
        } catch {
          // ignore stream cleanup errors
        }
        reader = null
      }
    }

    const runPromise = run()

    return {
      close(): Promise<void> {
        if (closePromise) {
          return closePromise
        }
        closed = true
        controller.abort()
        const cancelPromise = reader?.cancel().catch(() => undefined) ?? Promise.resolve()
        closePromise = Promise.all([cancelPromise, runPromise]).then(() => undefined)
        return closePromise
      },
    }
  }
}

const notificationClient = new NotificationClient()

export default notificationClient
