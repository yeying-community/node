import express, { Express } from 'express'
import { AddressInfo } from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Wallet } from 'ethers'
import { DataSource } from 'typeorm'
import { buildActionSignatureMessage, executeSignedAction, getActionSignatureErrorStatus } from '../src/auth/actionSignature'
import { fail, ok } from '../src/auth/envelope'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { ActionRequestDO } from '../src/domain/mapper/entity'
import { ActionRequestService } from '../src/domain/service/actionRequest'
import { DataSourceBuilder } from '../src/infrastructure/db'

function createDbPath() {
  return path.join(
    os.tmpdir(),
    `yeying-action-request-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
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

function buildRequestInput(overrides?: Partial<Parameters<ActionRequestService['begin']>[0]>) {
  return {
    actor: '0x1111111111111111111111111111111111111111',
    action: 'integration_write',
    requestId: 'req-multi-instance',
    payloadHash: 'payload-hash',
    signedAt: '2026-04-03T00:00:00.000Z',
    signature: 'signature',
    createdAt: '2026-04-03T00:00:00.000Z',
    status: 'pending',
    responseCode: 0,
    responseBody: '',
    completedAt: '',
    ...overrides,
  }
}

function createSignedRouteApp(instanceId: string, executionLog: string[]) {
  const app = express()
  app.use(express.json())
  app.post('/signed', async (req, res) => {
    const body = req.body || {}
    const actor = String(body.actor || '').trim().toLowerCase()
    const value = String(body.value || '')
    const result = await executeSignedAction({
      raw: body,
      action: 'integration_write',
      actor,
      payload: { value },
      execute: async () => {
        executionLog.push(instanceId)
        return {
          status: 200,
          body: ok({
            handledBy: instanceId,
            executionCount: executionLog.length,
            value,
          }),
        }
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'write failed'
        const status = getActionSignatureErrorStatus(message) ?? 500
        return { status, body: fail(status, message) }
      },
    })
    res.status(result.status).json(result.body)
  })
  return app
}

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = await new Promise<import('http').Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    return await run(baseUrl)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

async function signBody(
  wallet: { address: string; signMessage: (message: string) => Promise<string> },
  requestId: string,
  value: string
) {
  const actor = wallet.address.toLowerCase()
  const timestamp = new Date().toISOString()
  const signature = await wallet.signMessage(
    buildActionSignatureMessage({
      action: 'integration_write',
      actor,
      timestamp,
      requestId,
      payload: { value },
    })
  )
  return {
    actor,
    value,
    requestId,
    timestamp,
    signature,
  }
}

describe('ActionRequestService multi-instance', () => {
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

  it('keeps pending request state after a restarted instance', async () => {
    database = createDbPath()

    datasource = await initDatasource(database)
    const firstInstance = new ActionRequestService()
    await expect(firstInstance.begin(buildRequestInput())).resolves.toEqual({ kind: 'new' })
    await closeDatasource(datasource)

    datasource = await initDatasource(database)
    const restartedInstance = new ActionRequestService()

    await expect(restartedInstance.begin(buildRequestInput())).rejects.toThrow('Request in progress')
  })

  it('replays completed responses after a restarted instance', async () => {
    database = createDbPath()
    const responseBody = JSON.stringify(ok({ handledBy: 'instance-a' }))

    datasource = await initDatasource(database)
    const firstInstance = new ActionRequestService()
    await expect(firstInstance.begin(buildRequestInput())).resolves.toEqual({ kind: 'new' })
    await firstInstance.complete({
      actor: '0x1111111111111111111111111111111111111111',
      requestId: 'req-multi-instance',
      responseCode: 200,
      responseBody,
      completedAt: '2026-04-03T00:01:00.000Z',
    })
    await closeDatasource(datasource)

    datasource = await initDatasource(database)
    const restartedInstance = new ActionRequestService()

    await expect(restartedInstance.begin(buildRequestInput())).resolves.toEqual({
      kind: 'replay',
      responseCode: 200,
      responseBody,
    })
  })

  it('replays the first route response across restarted instances', async () => {
    database = createDbPath()
    const wallet = Wallet.createRandom()
    const requestId = 'req-route-multi-instance'
    const signedBody = await signBody(wallet, requestId, 'hello')
    const executionLog: string[] = []

    datasource = await initDatasource(database)
    const appA = createSignedRouteApp('instance-a', executionLog)
    const firstJson = await withServer(appA, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      expect(response.status).toBe(200)
      return response.json()
    })
    expect(executionLog).toEqual(['instance-a'])
    await closeDatasource(datasource)

    datasource = await initDatasource(database)
    const appB = createSignedRouteApp('instance-b', executionLog)
    const secondJson = await withServer(appB, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      expect(response.status).toBe(200)
      return response.json()
    })

    expect(secondJson).toEqual(firstJson)
    expect(secondJson.data).toEqual({
      handledBy: 'instance-a',
      executionCount: 1,
      value: 'hello',
    })
    expect(executionLog).toEqual(['instance-a'])
  })
})
