const subscriptions: Array<{ channel: string; client: FakeRedis }> = []
const publishedMessages: Array<{ channel: string; payload: string }> = []

class FakeRedis {
  handlers = new Map<string, (...args: unknown[]) => void>()

  async subscribe(channel: string) {
    subscriptions.push({ channel, client: this })
    return 1
  }

  async publish(channel: string, payload: string) {
    publishedMessages.push({ channel, payload })
    return 1
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler)
    return this
  }

  disconnect() {
    return undefined
  }
}

async function loadPusherEvents(config: Record<string, unknown>) {
  vi.resetModules()
  subscriptions.splice(0, subscriptions.length)
  publishedMessages.splice(0, publishedMessages.length)
  vi.doMock('ioredis', () => ({
    default: FakeRedis,
  }))
  vi.doMock('../src/config/runtime', () => ({
    getConfig: vi.fn().mockImplementation((key: string) => (key === 'redis' ? config : undefined)),
  }))
  vi.doMock('../src/security/secretVault', () => ({
    getRuntimeSecret: vi.fn().mockReturnValue(''),
  }))
  vi.doMock('../src/domain/facade/logger', () => ({
    SingletonLogger: {
      get: () => ({
        warn: vi.fn(),
      }),
    },
  }))
  return await import('../src/domain/service/pusherEvents')
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = check()
      if (value !== undefined) {
        resolve(value)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for condition'))
        return
      }
      setTimeout(tick, 5)
    }
    tick()
  })
}

describe('Pusher Redis Pub/Sub event bus', () => {
  it('publishes pusher events to the configured Redis channel', async () => {
    const pusherEvents = await loadPusherEvents({
      enabled: true,
      pusherChannel: 'test:pusher',
      instanceId: 'instance-a',
    })

    let received = false
    pusherEvents.subscribePusherEvents(['private-user.0x1'], () => {
      received = true
    })
    await waitFor(() => (subscriptions.length === 1 ? true : undefined))

    pusherEvents.publishPusherEvent({
      id: 'event-1',
      appId: 'project',
      type: 'project.task.updated',
      channels: ['private-user.0x1'],
      data: { taskId: 123 },
      source: 'project',
      actor: '',
      createdAt: '2026-09-01T00:00:00.000Z',
    })

    await waitFor(() => (publishedMessages.length === 1 ? true : undefined))
    expect(received).toBe(false)
    expect(publishedMessages[0].channel).toBe('test:pusher')
    expect(JSON.parse(publishedMessages[0].payload)).toMatchObject({
      id: 'event-1',
      origin: 'instance-a',
    })
  })

  it('delivers Redis messages from other instances to local subscribers', async () => {
    const pusherEvents = await loadPusherEvents({
      enabled: true,
      pusherChannel: 'test:pusher',
      instanceId: 'instance-a',
    })
    let received: import('../src/domain/service/pusherEvents').PusherStreamEvent | undefined
    pusherEvents.subscribePusherEvents(['private-user.0x1'], (event) => {
      received = event
    })
    await waitFor(() => subscriptions[0]?.client.handlers.get('message') ? true : undefined)

    subscriptions[0].client.handlers.get('message')?.('test:pusher', JSON.stringify({
      id: 'event-2',
      appId: 'project',
      type: 'project.task.updated',
      channels: ['private-user.0x1'],
      data: { taskId: 456 },
      source: 'project',
      actor: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      origin: 'instance-b',
    }))

    const event = await waitFor(() => received)
    expect(event.id).toBe('event-2')
    expect(event.data).toEqual({ taskId: 456 })
  })
})
