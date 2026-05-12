type StreamEntry = [string, string[]]

const streams = new Map<string, StreamEntry[]>()
const publishedMessages: Array<{ channel: string; payload: string }> = []
let idCounter = 0

function nextStreamId() {
  idCounter += 1
  return `${idCounter}-0`
}

function compareStreamId(left: string, right: string) {
  if (right === '$') {
    return -1
  }
  const [leftMs, leftSeq] = left.split('-').map((item) => Number(item))
  const [rightMs, rightSeq] = right.split('-').map((item) => Number(item))
  if (leftMs !== rightMs) {
    return leftMs - rightMs
  }
  return leftSeq - rightSeq
}

class FakeRedis {
  handlers = new Map<string, (...args: unknown[]) => void>()

  async subscribe() {
    return 1
  }

  async publish(channel: string, payload: string) {
    publishedMessages.push({ channel, payload })
    return 1
  }

  async xadd(streamKey: string, ...args: Array<string | number>) {
    const eventIndex = args.findIndex((item) => item === 'event')
    const payload = eventIndex >= 0 ? String(args[eventIndex + 1] || '') : ''
    const id = nextStreamId()
    const entries = streams.get(streamKey) || []
    entries.push([id, ['event', payload]])
    streams.set(streamKey, entries)
    return id
  }

  async xread(...args: Array<string | number>) {
    const streamIndex = args.findIndex((item) => item === 'STREAMS')
    const streamKey = String(args[streamIndex + 1] || '')
    const cursor = String(args[streamIndex + 2] || '0-0')
    const countIndex = args.findIndex((item) => item === 'COUNT')
    const limit = countIndex >= 0 ? Number(args[countIndex + 1]) : 100
    const entries = (streams.get(streamKey) || [])
      .filter(([id]) => compareStreamId(id, cursor) > 0)
      .slice(0, Number.isFinite(limit) ? limit : 100)
    return entries.length > 0 ? [[streamKey, entries]] : null
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, handler)
    return this
  }

  disconnect() {
    return undefined
  }
}

async function loadMpcEvents(config: Record<string, unknown>) {
  vi.resetModules()
  streams.clear()
  publishedMessages.splice(0, publishedMessages.length)
  idCounter = 0
  vi.doMock('ioredis', () => ({
    default: FakeRedis,
  }))
  vi.doMock('../src/config/runtime', () => ({
    getConfig: vi.fn().mockImplementation((key: string) => (key === 'redis' ? config : undefined)),
  }))
  return await import('../src/domain/service/mpcEvents')
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

describe('MPC Redis Streams event bus', () => {
  it('writes events to Redis Streams and delivers stream ids in streamOnly mode', async () => {
    const mpcEvents = await loadMpcEvents({
      enabled: true,
      streamEnabled: true,
      streamOnly: true,
      streamKeyPrefix: 'test:mpc:',
      streamMaxLen: 100,
      instanceId: 'instance-a',
    })
    let received: import('../src/domain/service/mpcEvents').MpcEvent | undefined
    const unsubscribe = mpcEvents.subscribeMpcEvents('session-a', (event) => {
      received = event
    })

    mpcEvents.publishMpcEvent('session-a', {
      type: 'session-update',
      sessionId: 'session-a',
      data: { status: 'created' },
      timestamp: 1,
    })

    const event = await waitFor(() => received)
    unsubscribe()

    expect(event.streamId).toBe('1-0')
    expect(event.origin).toBe('instance-a')
    expect(event.data).toEqual({ status: 'created' })
    expect(publishedMessages).toEqual([])
    expect(streams.get('test:mpc:session-a')).toHaveLength(1)
  })

  it('replays stored Redis Stream events after a cursor', async () => {
    const mpcEvents = await loadMpcEvents({
      enabled: true,
      streamEnabled: true,
      streamOnly: true,
      streamKeyPrefix: 'test:mpc:',
      streamMaxLen: 100,
      instanceId: 'instance-a',
    })

    mpcEvents.publishMpcEvent('session-b', {
      type: 'participant-joined',
      sessionId: 'session-b',
      data: { participantId: 'p1' },
      timestamp: 2,
    })
    await waitFor(() => (streams.get('test:mpc:session-b')?.length ? true : undefined))

    const records = await mpcEvents.readMpcEventStream('session-b', '0-0', 10)

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('1-0')
    expect(records[0].event.streamId).toBe('1-0')
    expect(records[0].event.type).toBe('participant-joined')
    expect(records[0].event.data).toEqual({ participantId: 'p1' })
  })
})
