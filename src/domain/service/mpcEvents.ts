import Redis, { RedisOptions } from 'ioredis'
import { v4 as uuidv4 } from 'uuid'
import { SingletonLogger } from '../facade/logger'
import { getConfig } from '../../config/runtime'
import { RedisRuntimeConfig } from '../../config'

export type MpcEvent = {
  type: string
  sessionId: string
  data: unknown
  timestamp: number
  origin?: string
  streamId?: string
}

type Listener = (event: MpcEvent) => void

const listenersBySession = new Map<string, Set<Listener>>()

type RedisState = {
  enabled: boolean
  ready: boolean
  channel: string
  instanceId: string
  streamEnabled: boolean
  streamOnly: boolean
  streamKeyPrefix: string
  streamMaxLen: number
  streamApprox: boolean
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
    username: config.username || undefined,
    password: config.password || undefined,
    db: config.db ?? 0,
    keyPrefix: config.keyPrefix || undefined
  }
  if (normalizeBoolean(config.tls)) {
    options.tls = {}
  }
  return options
}

function ensureRedisState(): RedisState {
  if (redisState) return redisState
  const config = getRedisConfig()
  const enabled = normalizeBoolean(config.enabled)
  const channel = config.channel || 'mpc_events'
  const instanceId = config.instanceId || uuidv4()
  const streamEnabled = normalizeBoolean(config.streamEnabled)
  const streamOnly = normalizeBoolean(config.streamOnly)
  const streamKeyPrefix = config.streamKeyPrefix || 'mpc:events:'
  const streamMaxLen = Number.isFinite(config.streamMaxLen) ? Number(config.streamMaxLen) : 10000
  const streamApprox = config.streamApprox !== undefined ? normalizeBoolean(config.streamApprox) : true
  redisState = {
    enabled,
    ready: false,
    channel,
    instanceId,
    streamEnabled,
    streamOnly,
    streamKeyPrefix,
    streamMaxLen,
    streamApprox
  }
  return redisState
}

function deliverLocal(sessionId: string, event: MpcEvent) {
  const listeners = listenersBySession.get(sessionId)
  if (!listeners || listeners.size === 0) return
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // ignore listener errors
    }
  }
}

function ensureRedisPubSub() {
  const state = ensureRedisState()
  if (!state.enabled || state.pub || state.sub) {
    return state
  }
  const logger = SingletonLogger.get()
  const config = getRedisConfig()
  const options = buildRedisOptions(config)
  const pub = new Redis(options)
  state.pub = pub
  if (state.streamOnly) {
    state.ready = true
    return state
  }
  const sub = new Redis(options)
  state.sub = sub

  const channel = state.channel
  sub.subscribe(channel).then(() => {
    state.ready = true
  }).catch((error) => {
    const errMsg = error instanceof Error ? error.message : 'unknown'
    logger.warn(`mpc redis subscribe failed: ${errMsg}`)
  })

  sub.on('message', (_channel, payload) => {
    try {
      const parsed = JSON.parse(payload) as MpcEvent
      if (!parsed || !parsed.sessionId) return
      deliverLocal(parsed.sessionId, parsed)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown'
      logger.warn(`mpc redis message parse failed: ${errMsg}`)
    }
  })

  pub.on('error', (error) => {
    const errMsg = error instanceof Error ? error.message : 'unknown'
    logger.warn(`mpc redis publish error: ${errMsg}`)
  })
  sub.on('error', (error) => {
    const errMsg = error instanceof Error ? error.message : 'unknown'
    logger.warn(`mpc redis subscribe error: ${errMsg}`)
  })

  return state
}

export function initMpcEventBus() {
  ensureRedisPubSub()
}

export function publishMpcEvent(sessionId: string, event: MpcEvent) {
  const state = ensureRedisPubSub()
  const baseEvent: MpcEvent = {
    ...event,
    sessionId,
    origin: state.instanceId
  }

  const publishNow = (payload: MpcEvent) => {
    if (state.streamOnly) {
      deliverLocal(sessionId, payload)
      return
    }
    if (state.enabled && state.ready && state.pub) {
      state.pub.publish(state.channel, JSON.stringify(payload)).catch(() => {
        deliverLocal(sessionId, payload)
      })
      return
    }
    deliverLocal(sessionId, payload)
  }

  if (state.enabled && state.streamEnabled && state.pub) {
    const streamKey = `${state.streamKeyPrefix}${sessionId}`
    const maxLen = Math.max(state.streamMaxLen, 1)
    const args: Array<string | number> = ['MAXLEN']
    if (state.streamApprox) {
      args.push('~')
    }
    args.push(maxLen)
    state.pub
      .xadd(streamKey, ...args, '*', 'event', JSON.stringify(baseEvent))
      .then((streamId) => {
        const enriched = { ...baseEvent, streamId: String(streamId) }
        publishNow(enriched)
      })
      .catch(() => publishNow(baseEvent))
    return
  }

  publishNow(baseEvent)
}

export function subscribeMpcEvents(sessionId: string, listener: Listener) {
  ensureRedisPubSub()
  const listeners = listenersBySession.get(sessionId) ?? new Set<Listener>()
  listeners.add(listener)
  listenersBySession.set(sessionId, listeners)
  return () => {
    const current = listenersBySession.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      listenersBySession.delete(sessionId)
    }
  }
}

export type MpcEventRecord = {
  id: string
  event: MpcEvent
}

export async function readMpcEventStream(sessionId: string, cursor: string, limit = 100): Promise<MpcEventRecord[]> {
  const state = ensureRedisState()
  if (!state.enabled || !state.streamEnabled) return []
  const config = getRedisConfig()
  const options = buildRedisOptions(config)
  const client = new Redis(options)
  const streamKey = `${state.streamKeyPrefix}${sessionId}`
  try {
    const response = await client.xread('COUNT', limit, 'STREAMS', streamKey, cursor)
    if (!response || response.length === 0) {
      return []
    }
    const records: MpcEventRecord[] = []
    const [, entries] = response[0]
    for (const entry of entries) {
      const [id, fields] = entry
      const fieldPairs = Array.isArray(fields) ? fields : []
      let payload = ''
      for (let i = 0; i < fieldPairs.length; i += 2) {
        if (fieldPairs[i] === 'event') {
          payload = String(fieldPairs[i + 1] || '')
          break
        }
      }
      if (!payload) continue
      try {
        const parsed = JSON.parse(payload) as MpcEvent
        records.push({ id: String(id), event: { ...parsed, streamId: String(id) } })
      } catch {
        continue
      }
    }
    return records
  } finally {
    client.disconnect()
  }
}

export type MpcStreamReader = {
  close: () => void
}

export function createMpcStreamReader(
  sessionId: string,
  startId: string,
  onEvent: (record: MpcEventRecord) => void,
  onError?: (error: Error) => void
): MpcStreamReader {
  const state = ensureRedisState()
  if (!state.enabled || !state.streamEnabled) {
    return { close: () => undefined }
  }
  const config = getRedisConfig()
  const options = buildRedisOptions(config)
  const client = new Redis(options)
  const streamKey = `${state.streamKeyPrefix}${sessionId}`
  let closed = false
  let cursor = startId || '$'

  const loop = async () => {
    while (!closed) {
      try {
        const response = await client.xread('COUNT', 100, 'BLOCK', 15000, 'STREAMS', streamKey, cursor)
        if (!response || response.length === 0) {
          continue
        }
        const [, entries] = response[0]
        for (const entry of entries) {
          const [id, fields] = entry
          const fieldPairs = Array.isArray(fields) ? fields : []
          let payload = ''
          for (let i = 0; i < fieldPairs.length; i += 2) {
            if (fieldPairs[i] === 'event') {
              payload = String(fieldPairs[i + 1] || '')
              break
            }
          }
          if (!payload) continue
          try {
            const parsed = JSON.parse(payload) as MpcEvent
            const record = { id: String(id), event: { ...parsed, streamId: String(id) } }
            onEvent(record)
          } catch {
            continue
          }
          cursor = String(id)
        }
      } catch (error) {
        if (closed) break
        if (onError && error instanceof Error) {
          onError(error)
        }
      }
    }
  }

  loop().catch(() => undefined)

  return {
    close: () => {
      closed = true
      client.disconnect()
    }
  }
}
