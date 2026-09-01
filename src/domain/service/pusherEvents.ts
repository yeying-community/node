import Redis, { RedisOptions } from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { RedisRuntimeConfig } from '../../config'
import { getConfig } from '../../config/runtime'
import { getRuntimeSecret } from '../../security/secretVault'
import { SingletonLogger } from '../facade/logger'

export type PusherStreamEvent = {
  id: string
  appId: string
  type: string
  channels: string[]
  data: Record<string, unknown>
  source: string
  actor: string
  createdAt: string
}

type Listener = (event: PusherStreamEvent) => void

const listenersByChannel = new Map<string, Set<Listener>>()

type RedisState = {
  enabled: boolean
  ready: boolean
  channel: string
  instanceId: string
  pub?: Redis
  sub?: Redis
}

let redisState: RedisState | null = null

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true'
  }
  return false
}

function getRedisConfig(): RedisRuntimeConfig {
  return (getConfig<RedisRuntimeConfig>('redis') || {}) as RedisRuntimeConfig
}

function buildRedisOptions(config: RedisRuntimeConfig) {
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
  if (redisState) return redisState
  const config = getRedisConfig()
  redisState = {
    enabled: normalizeBoolean(config.enabled),
    ready: false,
    channel: config.pusherChannel || 'pusher_events',
    instanceId: config.instanceId || uuidv4(),
  }
  return redisState
}

function ensureRedisPubSub(): RedisState {
  const state = ensureRedisState()
  if (!state.enabled || state.pub || state.sub) {
    return state
  }
  const logger = SingletonLogger.get()
  const warn = (message: string) => {
    try {
      logger?.warn?.(message)
    } catch {
      // ignore logging errors
    }
  }
  const options = buildRedisOptions(getRedisConfig())
  const pub = new Redis(options)
  const sub = new Redis(options)
  state.pub = pub
  state.sub = sub

  sub.subscribe(state.channel).then(() => {
    state.ready = true
  }).catch((error) => {
    warn(`pusher redis subscribe failed: ${error instanceof Error ? error.message : String(error)}`)
  })

  sub.on('message', (_channel, payload) => {
    try {
      const parsed = JSON.parse(payload) as PusherStreamEvent & { origin?: string }
      if (!parsed || !Array.isArray(parsed.channels) || parsed.origin === state.instanceId) {
        return
      }
      deliverLocal(parsed)
    } catch (error) {
      warn(`pusher redis message parse failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  pub.on('error', (error) => {
    warn(`pusher redis publish error: ${error instanceof Error ? error.message : String(error)}`)
  })
  sub.on('error', (error) => {
    warn(`pusher redis subscribe error: ${error instanceof Error ? error.message : String(error)}`)
  })

  return state
}

function normalizeChannel(input: unknown): string {
  return String(input || '').trim()
}

function deliverLocal(event: PusherStreamEvent): void {
  const delivered = new Set<Listener>()
  for (const channel of event.channels.map(normalizeChannel).filter(Boolean)) {
    const listeners = listenersByChannel.get(channel)
    if (!listeners) {
      continue
    }
    for (const listener of listeners) {
      if (delivered.has(listener)) {
        continue
      }
      delivered.add(listener)
      try {
        listener(event)
      } catch {
        // ignore listener errors
      }
    }
  }
}

export function initPusherEventBus(): void {
  ensureRedisPubSub()
}

export function publishPusherEvent(event: PusherStreamEvent): void {
  const state = ensureRedisPubSub()
  const payload = {
    ...event,
    origin: state.instanceId,
  }
  if (state.enabled && state.ready && state.pub) {
    state.pub.publish(state.channel, JSON.stringify(payload)).catch(() => {
      deliverLocal(event)
    })
    return
  }
  deliverLocal(event)
}

export function subscribePusherEvents(channels: string[], listener: Listener): () => void {
  ensureRedisPubSub()
  const normalized = Array.from(new Set(channels.map(normalizeChannel).filter(Boolean)))
  for (const channel of normalized) {
    const listeners = listenersByChannel.get(channel) || new Set<Listener>()
    listeners.add(listener)
    listenersByChannel.set(channel, listeners)
  }

  return () => {
    for (const channel of normalized) {
      const listeners = listenersByChannel.get(channel)
      if (!listeners) {
        continue
      }
      listeners.delete(listener)
      if (listeners.size === 0) {
        listenersByChannel.delete(channel)
      }
    }
  }
}
