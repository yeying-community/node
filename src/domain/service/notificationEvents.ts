import Redis, { RedisOptions } from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { getConfig } from '../../config/runtime'
import { RedisRuntimeConfig } from '../../config'
import { getRuntimeSecret } from '../../security/secretVault'
import { SingletonLogger } from '../facade/logger'

export type NotificationStreamEvent =
  | {
      event: 'notification.created'
      recipient: string
      notificationUid: string
      unreadCount?: number
      timestamp: number
      id?: string
      origin?: string
    }
  | {
      event: 'notification.read'
      recipient: string
      notificationUid: string
      unreadCount?: number
      timestamp: number
      id?: string
      origin?: string
    }

type Listener = (event: NotificationStreamEvent) => void

const listenersByRecipient = new Map<string, Set<Listener>>()

type RedisState = {
  enabled: boolean
  ready: boolean
  channel: string
  instanceId: string
  pub?: Redis
  sub?: Redis
}

let redisState: RedisState | null = null

function normalizeRecipient(input: unknown): string {
  return String(input || '').trim().toLowerCase()
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return String(value || '').trim().toLowerCase() === 'true'
}

function getRedisConfig(): RedisRuntimeConfig {
  return (getConfig<RedisRuntimeConfig>('redis') || {}) as RedisRuntimeConfig
}

function buildRedisOptions(config: RedisRuntimeConfig): RedisOptions {
  const options: RedisOptions = {
    host: config.host || '127.0.0.1',
    port: config.port ?? 6379,
    username: getRuntimeSecret('REDIS_USERNAME') || undefined,
    password: getRuntimeSecret('REDIS_PASSWORD') || undefined,
    db: config.db ?? 0,
    keyPrefix: config.keyPrefix || undefined,
  }
  if (normalizeBoolean(config.tls)) {
    options.tls = {}
  }
  return options
}

function ensureRedisState(): RedisState {
  if (redisState) {
    return redisState
  }
  const config = getRedisConfig()
  redisState = {
    enabled: normalizeBoolean(config.enabled),
    ready: false,
    channel: config.notificationChannel || 'notification_events',
    instanceId: config.instanceId || uuidv4(),
  }
  return redisState
}

function logRedisWarning(message: string): void {
  try {
    SingletonLogger.get()?.warn?.(message)
  } catch {
    // Notification delivery must remain local if Redis logging is unavailable.
  }
}

function deliverLocal(event: NotificationStreamEvent): void {
  const recipient = normalizeRecipient(event.recipient)
  if (!recipient) {
    return
  }
  const listeners = listenersByRecipient.get(recipient)
  if (!listeners || listeners.size === 0) {
    return
  }
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // Ignore one broken SSE listener.
    }
  }
}

function ensureRedisPubSub(): RedisState {
  const state = ensureRedisState()
  if (!state.enabled || state.pub || state.sub) {
    return state
  }
  const options = buildRedisOptions(getRedisConfig())
  const pub = new Redis(options)
  const sub = new Redis(options)
  state.pub = pub
  state.sub = sub

  sub.subscribe(state.channel).then(() => {
    state.ready = true
  }).catch((error) => {
    logRedisWarning(`notification redis subscribe failed: ${error instanceof Error ? error.message : String(error)}`)
  })

  sub.on('message', (_channel, payload) => {
    try {
      const parsed = JSON.parse(payload) as NotificationStreamEvent
      if (!parsed || !parsed.recipient || parsed.origin === state.instanceId) {
        return
      }
      const { origin: _origin, ...event } = parsed
      deliverLocal(event)
    } catch (error) {
      logRedisWarning(`notification redis message parse failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  pub.on('error', (error) => {
    logRedisWarning(`notification redis publish error: ${error instanceof Error ? error.message : String(error)}`)
  })
  sub.on('error', (error) => {
    logRedisWarning(`notification redis subscribe error: ${error instanceof Error ? error.message : String(error)}`)
  })

  return state
}

export function initNotificationEventBus(): void {
  ensureRedisPubSub()
}

export function publishNotificationEvent(event: NotificationStreamEvent): void {
  const recipient = normalizeRecipient(event.recipient)
  if (!recipient) {
    return
  }
  const state = ensureRedisPubSub()
  const localEvent = { ...event, recipient }
  deliverLocal(localEvent)

  if (state.enabled && state.pub) {
    state.pub.publish(
      state.channel,
      JSON.stringify({ ...localEvent, origin: state.instanceId })
    ).catch((error) => {
      logRedisWarning(`notification redis publish failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}

export function subscribeNotificationEvents(recipientInput: string, listener: Listener) {
  const recipient = normalizeRecipient(recipientInput)
  if (!recipient) {
    return () => {}
  }
  const listeners = listenersByRecipient.get(recipient) ?? new Set<Listener>()
  listeners.add(listener)
  listenersByRecipient.set(recipient, listeners)
  return () => {
    const current = listenersByRecipient.get(recipient)
    if (!current) {
      return
    }
    current.delete(listener)
    if (current.size === 0) {
      listenersByRecipient.delete(recipient)
    }
  }
}
