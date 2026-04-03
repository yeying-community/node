import express, { Express } from 'express'
import { AddressInfo } from 'net'
import { Wallet } from 'ethers'
import { runWithRequestContext } from '../src/common/requestContext'
import { mockClass } from './support/mockClass'

const applicationStore = new Map<string, any>()
const applicationConfigStore = new Map<string, any>()
const saveApplicationMock = vi.fn()
const deleteApplicationMock = vi.fn()
const upsertApplicationConfigMock = vi.fn()

const requestReplayStore = new Map<
  string,
  {
    action: string
    payloadHash: string
    status: 'pending' | 'completed'
    responseCode: number
    responseBody: string
  }
>()

vi.doMock('../src/common/permission', () => ({
  ensureUserActive: vi.fn().mockResolvedValue({}),
  ensureUserCanWriteBusinessData: vi.fn().mockResolvedValue({}),
  isAdminUser: vi.fn().mockResolvedValue(false),
}))

vi.doMock('../src/domain/service/application', () => ({
  ApplicationService: mockClass(() => ({
    queryByUid: async (uid: string) => applicationStore.get(`uid:${uid}`) || null,
    query: async (did: string, version: number) => applicationStore.get(`did:${did}:${version}`) || null,
    save: async (application: any) => {
      saveApplicationMock(application)
      applicationStore.set(`uid:${application.uid}`, application)
      applicationStore.set(`did:${application.did}:${application.version}`, application)
      return application
    },
    delete: async (did: string, version: number) => {
      deleteApplicationMock(did, version)
      const existing = applicationStore.get(`did:${did}:${version}`) || null
      if (existing) {
        applicationStore.delete(`uid:${existing.uid}`)
        applicationStore.delete(`did:${did}:${version}`)
      }
      return { deleted: true }
    },
  })),
}))

vi.doMock('../src/domain/service/applicationConfig', () => ({
  ApplicationConfigService: mockClass(() => ({
    getByApplicationAndApplicant: async (applicationUid: string, applicant: string) =>
      applicationConfigStore.get(`${applicationUid}:${applicant}`) || null,
    upsert: async (config: any) => {
      upsertApplicationConfigMock(config)
      const saved = { ...config }
      applicationConfigStore.set(`${saved.applicationUid}:${saved.applicant}`, saved)
      return saved
    },
  })),
}))

vi.doMock('../src/domain/service/actionRequest', () => ({
  ActionRequestService: mockClass(() => ({
    begin: async (input: any) => {
      const key = `${input.actor}:${input.requestId}`
      const existing = requestReplayStore.get(key)
      if (!existing) {
        requestReplayStore.set(key, {
          action: input.action,
          payloadHash: input.payloadHash,
          status: 'pending',
          responseCode: 0,
          responseBody: '',
        })
        return { kind: 'new' }
      }
      if (existing.action !== input.action || existing.payloadHash !== input.payloadHash) {
        throw new Error('Request replay payload mismatch')
      }
      if (existing.status !== 'completed') {
        throw new Error('Request in progress')
      }
      return {
        kind: 'replay',
        responseCode: existing.responseCode,
        responseBody: existing.responseBody,
      }
    },
    complete: async (input: any) => {
      const key = `${input.actor}:${input.requestId}`
      const existing = requestReplayStore.get(key)
      if (!existing) {
        return
      }
      requestReplayStore.set(key, {
        ...existing,
        status: 'completed',
        responseCode: input.responseCode,
        responseBody: input.responseBody,
      })
    },
  })),
}))

const { buildActionSignatureMessage } = await import('../src/auth/actionSignature')
const { registerPublicApplicationRoutes } = await import('../src/routes/public/applications')

function createTestApp(address: string) {
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    runWithRequestContext(
      {
        address,
        authType: 'jwt',
      },
      next
    )
  })
  registerPublicApplicationRoutes(app)
  return app
}

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>) {
  const server = await new Promise<import('http').Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  try {
    const address = server.address() as AddressInfo
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

async function signBody(input: {
  wallet: { address: string; signMessage(message: string): Promise<string> }
  action?: string
  requestId: string
  rawBody: Record<string, unknown>
  signablePayload: Record<string, unknown>
}) {
  const actor = input.wallet.address.toLowerCase()
  const timestamp = new Date().toISOString()
  const message = buildActionSignatureMessage({
    action: input.action || 'application_create',
    actor,
    timestamp,
    requestId: input.requestId,
    payload: input.signablePayload,
  })
  const signature = await input.wallet.signMessage(message)
  return {
    ...input.rawBody,
    requestId: input.requestId,
    timestamp,
    signature,
  }
}

describe('public application routes idempotency', () => {
  beforeEach(() => {
    applicationStore.clear()
    applicationConfigStore.clear()
    requestReplayStore.clear()
    saveApplicationMock.mockClear()
    deleteApplicationMock.mockClear()
    upsertApplicationConfigMock.mockClear()
  })

  it('replays the first create response and only saves once', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const rawBody = {
      owner: actor,
      did: 'did:app:test-1',
      version: 1,
      name: 'Test App',
      description: 'desc',
      code: 'APPLICATION_CODE_TEST',
      location: '/index',
      serviceCodes: ['svc-a'],
      avatar: 'avatar',
      codePackagePath: '/pkg',
    }
    const signablePayload = {
      requestedUid: '',
      owner: actor,
      ownerName: actor,
      network: '',
      address: '',
      did: 'did:app:test-1',
      version: 1,
      name: 'Test App',
      description: 'desc',
      code: 'APPLICATION_CODE_TEST',
      location: '/index',
      serviceCodes: 'svc-a',
      avatar: 'avatar',
      codePackagePath: '/pkg',
    }
    const signedBody = await signBody({
      wallet,
      requestId: 'req-route-replay',
      rawBody,
      signablePayload,
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      const second = await fetch(`${baseUrl}/api/v1/public/applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(saveApplicationMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.uid).toBeDefined()
      expect(firstJson.data.did).toBe(rawBody.did)
    })
  })

  it('returns 409 when the same requestId is reused with a different payload', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const baseRawBody = {
      owner: actor,
      did: 'did:app:test-2',
      version: 1,
      name: 'Test App',
      description: 'desc',
      code: 'APPLICATION_CODE_TEST',
      location: '/index',
      serviceCodes: ['svc-a'],
      avatar: 'avatar',
      codePackagePath: '/pkg',
    }
    const baseSignablePayload = {
      requestedUid: '',
      owner: actor,
      ownerName: actor,
      network: '',
      address: '',
      did: 'did:app:test-2',
      version: 1,
      name: 'Test App',
      description: 'desc',
      code: 'APPLICATION_CODE_TEST',
      location: '/index',
      serviceCodes: 'svc-a',
      avatar: 'avatar',
      codePackagePath: '/pkg',
    }
    const requestId = 'req-route-mismatch'
    const firstBody = await signBody({
      wallet,
      requestId,
      rawBody: baseRawBody,
      signablePayload: baseSignablePayload,
    })
    const secondBody = await signBody({
      wallet,
      requestId,
      rawBody: {
        ...baseRawBody,
        name: 'Changed App',
      },
      signablePayload: {
        ...baseSignablePayload,
        name: 'Changed App',
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(firstBody),
      })
      const second = await fetch(`${baseUrl}/api/v1/public/applications`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(secondBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(409)
      expect(secondJson).toEqual(
        expect.objectContaining({
          code: 409,
          message: 'Request replay payload mismatch',
          data: null,
        })
      )
      expect(saveApplicationMock).toHaveBeenCalledTimes(1)
    })
  })

  it('replays the first delete response after the application has already been removed', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const existing = {
      uid: 'app-delete-1',
      owner: actor,
      ownerName: actor,
      network: '',
      address: '',
      did: 'did:app:delete-1',
      version: 1,
      name: 'Delete App',
      description: 'desc',
      code: 'APPLICATION_CODE_TEST',
      location: '/delete',
      serviceCodes: 'svc-a',
      avatar: 'avatar',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      signature: '',
      codePackagePath: '/pkg',
      status: 'BUSINESS_STATUS_PENDING',
      isOnline: false,
    }
    applicationStore.set(`uid:${existing.uid}`, existing)
    applicationStore.set(`did:${existing.did}:${existing.version}`, existing)

    const signedBody = await signBody({
      wallet,
      action: 'application_delete',
      requestId: 'req-application-delete-replay',
      rawBody: {},
      signablePayload: {
        applicationUid: existing.uid,
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/applications/${existing.uid}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      expect(applicationStore.get(`uid:${existing.uid}`)).toBeUndefined()

      const second = await fetch(`${baseUrl}/api/v1/public/applications/${existing.uid}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(deleteApplicationMock).toHaveBeenCalledTimes(1)
      expect(firstJson).toEqual(
        expect.objectContaining({
          code: 0,
          message: 'ok',
          data: { deleted: true },
        })
      )
    })
  })

  it('replays the first update response after the application is later removed', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const existing = {
      uid: 'app-update-1',
      owner: actor,
      ownerName: actor,
      network: '',
      address: '',
      did: 'did:app:update-1',
      version: 1,
      name: 'Before Update',
      description: 'desc',
      code: 'APPLICATION_CODE_TEST',
      location: '/before',
      serviceCodes: 'svc-a',
      avatar: 'avatar',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      signature: '',
      codePackagePath: '/pkg',
      status: 'BUSINESS_STATUS_PENDING',
      isOnline: false,
    }
    applicationStore.set(`uid:${existing.uid}`, existing)
    applicationStore.set(`did:${existing.did}:${existing.version}`, existing)
    const signedBody = await signBody({
      wallet,
      action: 'application_update',
      requestId: 'req-application-update-replay',
      rawBody: {
        name: 'After Update',
        location: '/after',
      },
      signablePayload: {
        applicationUid: existing.uid,
        name: 'After Update',
        location: '/after',
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/applications/${existing.uid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      applicationStore.delete(`uid:${existing.uid}`)
      applicationStore.delete(`did:${existing.did}:${existing.version}`)

      const second = await fetch(`${baseUrl}/api/v1/public/applications/${existing.uid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(saveApplicationMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.name).toBe('After Update')
      expect(firstJson.data.location).toBe('/after')
    })
  })

  it('replays the first config upsert response after the application is later removed', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const existing = {
      uid: 'app-config-1',
      owner: actor,
      ownerName: actor,
      network: '',
      address: '',
      did: 'did:app:config-1',
      version: 1,
      name: 'Config App',
      description: 'desc',
      code: 'APPLICATION_CODE_TEST',
      location: '/config',
      serviceCodes: 'svc-a',
      avatar: 'avatar',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      signature: '',
      codePackagePath: '/pkg',
      status: 'BUSINESS_STATUS_PENDING',
      isOnline: false,
    }
    applicationStore.set(`uid:${existing.uid}`, existing)
    applicationStore.set(`did:${existing.did}:${existing.version}`, existing)
    const rawBody = {
      config: [
        { code: 'domain-a', instance: 'inst-1' },
      ],
    }
    const signedBody = await signBody({
      wallet,
      action: 'application_config_upsert',
      requestId: 'req-application-config-replay',
      rawBody,
      signablePayload: {
        applicationUid: existing.uid,
        applicant: actor,
        config: [
          { code: 'domain-a', instance: 'inst-1' },
        ],
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/applications/${existing.uid}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      applicationStore.delete(`uid:${existing.uid}`)
      applicationStore.delete(`did:${existing.did}:${existing.version}`)

      const second = await fetch(`${baseUrl}/api/v1/public/applications/${existing.uid}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(upsertApplicationConfigMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.applicationUid).toBe(existing.uid)
      expect(firstJson.data.applicant).toBe(actor)
      expect(firstJson.data.config).toEqual([{ code: 'domain-a', instance: 'inst-1' }])
    })
  })
})
