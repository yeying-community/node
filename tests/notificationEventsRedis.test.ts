import { describe, expect, it, vi } from 'vitest'

const redisClients: FakeRedis[] = []
const published: Array<{ channel: string; payload: string }> = []

class FakeRedis {
  handlers = new Map<string, (...args: any[]) => void>()
  subscriptions = new Set<string>()

  constructor() {
    redisClients.push(this)
  }

  async subscribe(channel: string) {
    this.subscriptions.add(channel)
    return 1
  }

  async publish(channel: string, payload: string) {
    published.push({ channel, payload })
    for (const client of redisClients) {
      if (client.subscriptions.has(channel)) {
        client.handlers.get('message')?.(channel, payload)
      }
    }
    return redisClients.filter((client) => client.subscriptions.has(channel)).length
  }

  on(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(event, handler)
    return this
  }
}

vi.mock('ioredis', () => ({ default: FakeRedis }))
vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => key === 'redis'
    ? {
        enabled: true,
        notificationChannel: 'test:notification-events',
        instanceId: 'node-a',
      }
    : undefined,
}))
vi.mock('../src/security/secretVault', () => ({
  getRuntimeSecret: () => '',
}))
vi.mock('../src/domain/facade/logger', () => ({
  SingletonLogger: {
    get: () => ({ warn: vi.fn() }),
  },
}))

const notificationEvents = await import('../src/domain/service/notificationEvents')

describe('notification Redis event bus', () => {
  it('fans out events to local listeners and remote-origin listeners without duplicates', async () => {
    const received: Array<Record<string, unknown>> = []
    const unsubscribe = notificationEvents.subscribeNotificationEvents(
      '0x1111111111111111111111111111111111111111',
      (event) => received.push(event as unknown as Record<string, unknown>)
    )

    const event = {
      event: 'notification.created' as const,
      recipient: '0x1111111111111111111111111111111111111111',
      notificationUid: 'notification-1',
      unreadCount: 1,
      timestamp: 1,
      id: '2026-09-21T00:00:00.000Z|notification-1',
    }
    notificationEvents.publishNotificationEvent(event)
    await Promise.resolve()

    expect(received).toEqual([event])
    expect(published).toHaveLength(1)
    expect(JSON.parse(published[0].payload)).toMatchObject({
      ...event,
      origin: 'node-a',
    })

    const sub = redisClients.find((client) => client.subscriptions.has('test:notification-events'))
    expect(sub).toBeTruthy()
    sub!.handlers.get('message')?.(
      'test:notification-events',
      JSON.stringify({ ...event, origin: 'node-b' })
    )
    expect(received).toEqual([event, event])

    unsubscribe()
  })
})
