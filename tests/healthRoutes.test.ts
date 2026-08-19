import express from 'express'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { registerPublicHealthRoute } from '../src/routes/public/health'

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express()
  registerPublicHealthRoute(app)
  const server = await new Promise<import('http').Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

afterEach(() => {
  SingletonDataSource.set(undefined as any)
})

describe('public health routes', () => {
  it('reports database readiness from the initialized application datasource', async () => {
    const query = async () => [{ '?column?': 1 }]
    SingletonDataSource.set({ isInitialized: true, query } as any)
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/v1/public/ready`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { status: 'ok', database: 'ok' } })
    })
  })

  it('returns service unavailable when the datasource is not ready', async () => {
    SingletonDataSource.set({ isInitialized: false, query: async () => [] } as any)
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/v1/public/ready`)
      expect(response.status).toBe(503)
    })
  })
})
