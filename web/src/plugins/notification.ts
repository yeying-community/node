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

function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split('\n')
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
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) {
    return null
  }
  return {
    event,
    data: dataLines.join('\n'),
  }
}

class NotificationClient {
  async list(input: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}) {
    const params = new URLSearchParams()
    params.set('page', String(input.page || 1))
    params.set('pageSize', String(input.pageSize || 20))
    if (input.unreadOnly) {
      params.set('unreadOnly', 'true')
    }
    const response = await fetch(apiUrl(`/api/v1/public/notifications?${params.toString()}`), {
      method: 'GET',
      headers: {
        ...getAuthorizationHeaders(),
      },
    })
    return await parseEnvelope<NotificationPageResult>(response)
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

  openStream(handlers: NotificationStreamHandlers = {}) {
    const controller = new AbortController()
    let closed = false

    const run = async () => {
      try {
        const response = await fetch(apiUrl('/api/v1/public/notifications/stream'), {
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
        const reader = response.body.getReader()
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
            try {
              const data = JSON.parse(parsed.data) as NotificationStreamPayload
              handlers.onEvent?.(parsed.event, data)
            } catch {
              // ignore invalid event payload
            }
          }
        }
      } catch (error) {
        if (closed || controller.signal.aborted) {
          return
        }
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }

    void run()

    return {
      close() {
        closed = true
        controller.abort()
      },
    }
  }
}

const notificationClient = new NotificationClient()

export default notificationClient
