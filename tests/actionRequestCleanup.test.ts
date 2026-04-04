import fs from 'fs'
import os from 'os'
import path from 'path'
import { DataSource } from 'typeorm'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { ActionRequestDO } from '../src/domain/mapper/entity'
import { DataSourceBuilder } from '../src/infrastructure/db'

vi.doMock('../src/config/runtime', () => ({
  getConfig: vi.fn().mockImplementation((key: string) => {
    if (key === 'idempotency') {
      return {
        successRetentionDays: 7,
        failureRetentionDays: 1,
        pendingTimeoutMs: 15 * 60 * 1000,
        cleanupIntervalMs: 15 * 60 * 1000,
      }
    }
    return undefined
  }),
}))

const { runActionRequestCleanupOnce } = await import('../src/domain/service/actionRequestCleanup')

function createDbPath() {
  return path.join(
    os.tmpdir(),
    `yeying-action-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  )
}

async function initDatasource(database: string) {
  const builder = new DataSourceBuilder({
    type: 'better-sqlite3',
    database,
    synchronize: true,
  })
  builder.entities([ActionRequestDO])
  builder.migrations([])
  const datasource = await builder.build().initialize()
  SingletonDataSource.set(datasource)
  return datasource
}

async function closeDatasource(datasource?: DataSource | null) {
  if (!datasource?.isInitialized) {
    return
  }
  await datasource.destroy()
}

function removeDbFiles(database: string) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const target = `${database}${suffix}`
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true })
    }
  }
}

function isoFrom(baseMs: number, deltaMs: number) {
  return new Date(baseMs + deltaMs).toISOString()
}

describe('runActionRequestCleanupOnce', () => {
  let database = ''
  let datasource: DataSource | null = null

  afterEach(async () => {
    await closeDatasource(datasource)
    datasource = null
    if (database) {
      removeDbFiles(database)
      database = ''
    }
  })

  it('cleans success, failure and pending requests with separate retention policies', async () => {
    const now = Date.parse('2026-04-03T12:00:00.000Z')
    database = createDbPath()
    datasource = await initDatasource(database)
    const repository = datasource.getRepository(ActionRequestDO)

    await repository.insert([
      {
        actor: 'actor-success-old',
        action: 'write',
        requestId: 'success-old',
        payloadHash: 'hash',
        signedAt: isoFrom(now, -8 * 24 * 60 * 60 * 1000),
        signature: 'sig',
        createdAt: isoFrom(now, -8 * 24 * 60 * 60 * 1000),
        status: 'completed',
        responseCode: 200,
        responseBody: '{"ok":true}',
        completedAt: isoFrom(now, -8 * 24 * 60 * 60 * 1000),
      },
      {
        actor: 'actor-success-keep',
        action: 'write',
        requestId: 'success-keep',
        payloadHash: 'hash',
        signedAt: isoFrom(now, -2 * 24 * 60 * 60 * 1000),
        signature: 'sig',
        createdAt: isoFrom(now, -2 * 24 * 60 * 60 * 1000),
        status: 'completed',
        responseCode: 200,
        responseBody: '{"ok":true}',
        completedAt: isoFrom(now, -2 * 24 * 60 * 60 * 1000),
      },
      {
        actor: 'actor-failure-old',
        action: 'write',
        requestId: 'failure-old',
        payloadHash: 'hash',
        signedAt: isoFrom(now, -2 * 24 * 60 * 60 * 1000),
        signature: 'sig',
        createdAt: isoFrom(now, -2 * 24 * 60 * 60 * 1000),
        status: 'completed',
        responseCode: 409,
        responseBody: '{"ok":false}',
        completedAt: isoFrom(now, -2 * 24 * 60 * 60 * 1000),
      },
      {
        actor: 'actor-failure-keep',
        action: 'write',
        requestId: 'failure-keep',
        payloadHash: 'hash',
        signedAt: isoFrom(now, -12 * 60 * 60 * 1000),
        signature: 'sig',
        createdAt: isoFrom(now, -12 * 60 * 60 * 1000),
        status: 'completed',
        responseCode: 500,
        responseBody: '{"ok":false}',
        completedAt: isoFrom(now, -12 * 60 * 60 * 1000),
      },
      {
        actor: 'actor-pending-old',
        action: 'write',
        requestId: 'pending-old',
        payloadHash: 'hash',
        signedAt: isoFrom(now, -16 * 60 * 1000),
        signature: 'sig',
        createdAt: isoFrom(now, -16 * 60 * 1000),
        status: 'pending',
        responseCode: 0,
        responseBody: '',
        completedAt: '',
      },
      {
        actor: 'actor-pending-keep',
        action: 'write',
        requestId: 'pending-keep',
        payloadHash: 'hash',
        signedAt: isoFrom(now, -5 * 60 * 1000),
        signature: 'sig',
        createdAt: isoFrom(now, -5 * 60 * 1000),
        status: 'pending',
        responseCode: 0,
        responseBody: '',
        completedAt: '',
      },
    ])

    await runActionRequestCleanupOnce(now)

    const remainingIds = (await repository.find())
      .map((item) => item.requestId)
      .sort()

    expect(remainingIds).toEqual(['failure-keep', 'pending-keep', 'success-keep'])
  })
})
