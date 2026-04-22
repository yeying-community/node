import express, { Express } from 'express'
import { AddressInfo } from 'net'
import { Wallet } from 'ethers'
import { runWithRequestContext } from '../src/common/requestContext'
import { mockClass } from './support/mockClass'
import {
  USER_ROLE_OWNER,
  USER_STATUS_ACTIVE,
  USER_STATUS_DISABLE
} from '../src/domain/model/user'

const auditStore = new Map<string, any>()
const userStateStore = new Map<string, any>()
const mpcSessionStore = new Map<string, any>()
const mpcParticipantStore = new Map<string, any>()
const mpcMessageStore = new Map<string, any>()

const createAuditMock = vi.fn()
const approveAuditMock = vi.fn()
const cancelAuditMock = vi.fn()
const queryAuditMock = vi.fn()
const saveUserStateMock = vi.fn()
const createMpcSessionMock = vi.fn()
const joinMpcSessionMock = vi.fn()
const sendMpcMessageMock = vi.fn()

let auditSearchResult: { data: any[]; page: { total: number; page: number; pageSize: number } } = {
  data: [],
  page: {
    total: 0,
    page: 1,
    pageSize: 10,
  },
}

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

vi.doMock('../src/auth/ucan', () => ({
  isUcanToken: vi.fn().mockReturnValue(true),
  verifyUcanInvocationWithCap: vi.fn(),
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

vi.doMock('../src/domain/service/audit', () => ({
  AuditService: mockClass(() => ({
    create: async (meta: any) => {
      createAuditMock(meta)
      const created = { ...meta }
      auditStore.set(created.uid, created)
      return created
    },
    approve: async (input: any) => {
      approveAuditMock(input)
      return {
        ...input,
        status: 'COMMENT_STATUS_AGREE',
      }
    },
    reject: async (input: any) => ({
      ...input,
      status: 'COMMENT_STATUS_REJECT',
    }),
    detail: async (uid: string) => {
      const existing = auditStore.get(uid)
      if (!existing) {
        throw new Error('Audit not found')
      }
      return { meta: existing, comments: [] }
    },
    cancel: async (uid: string) => {
      cancelAuditMock(uid)
      auditStore.delete(uid)
      return { deleted: true, uid }
    },
    queryByCondition: async (input: any) => {
      queryAuditMock(input)
      return auditSearchResult
    },
  })),
}))

vi.doMock('../src/domain/service/user', () => ({
  UserService: mockClass(() => ({
    getUser: async () => null,
    getState: async (did: string) => userStateStore.get(did) || null,
    listUsers: async () => ({ users: [], total: 0 }),
    saveState: async (state: any) => {
      saveUserStateMock(state)
      const next = { ...state }
      userStateStore.set(next.did, next)
      return next
    },
  })),
}))

vi.doMock('../src/domain/service/mpc', () => ({
  MpcService: mockClass(() => ({
    createSession: async (input: any, actor: string) => {
      createMpcSessionMock(input, actor)
      const session = {
        id: input.id || `session-${mpcSessionStore.size + 1}`,
        type: input.type,
        walletId: input.walletId,
        threshold: input.threshold,
        participants: input.participants,
        status: 'created',
        round: 0,
        curve: input.curve || 'secp256k1',
        keyVersion: input.keyVersion ?? 0,
        shareVersion: input.shareVersion ?? 0,
        createdAt: '0',
        expiresAt: input.expiresAt || '',
        actor,
      }
      mpcSessionStore.set(session.id, session)
      return session
    },
    joinSession: async (sessionId: string, input: any, actor: string) => {
      joinMpcSessionMock(sessionId, input, actor)
      const session = mpcSessionStore.get(sessionId)
      if (!session) {
        throw new Error('SESSION_NOT_FOUND')
      }
      const participant = {
        sessionId,
        participantId: input.participantId,
        deviceId: input.deviceId,
        identity: input.identity,
        e2ePublicKey: input.e2ePublicKey,
        signingPublicKey: input.signingPublicKey || '',
        status: 'active',
        joinedAt: '0',
      }
      mpcParticipantStore.set(`${sessionId}:${participant.participantId}`, participant)
      const joinedParticipants = Array.from(mpcParticipantStore.values()).filter(
        (item) => item.sessionId === sessionId
      )
      return {
        participant,
        session: {
          ...session,
          joinedParticipants,
          joinedCount: joinedParticipants.length,
        },
      }
    },
    sendMessage: async (sessionId: string, input: any, actor: string) => {
      sendMpcMessageMock(sessionId, input, actor)
      const session = mpcSessionStore.get(sessionId)
      if (!session) {
        throw new Error('SESSION_NOT_FOUND')
      }
      const message = {
        id: input.id,
        sessionId,
        sender: input.from,
        receiver: input.to || '',
        round: input.round ?? 0,
        type: input.type,
        seq: input.seq ?? 0,
        envelope: input.envelope ?? {},
        createdAt: '0',
      }
      mpcMessageStore.set(`${sessionId}:${message.id}`, message)
      return message
    },
    fetchMessages: async () => ({ messages: [] }),
    getSession: async (sessionId: string) => {
      const session = mpcSessionStore.get(sessionId) || null
      if (!session) {
        return null
      }
      const joinedParticipants = Array.from(mpcParticipantStore.values()).filter(
        (item) => item.sessionId === sessionId
      )
      return {
        ...session,
        joinedParticipants,
        joinedCount: joinedParticipants.length,
      }
    },
  })),
}))

const { buildActionSignatureMessage } = await import('../src/auth/actionSignature')
const { registerPublicAuditRoutes } = await import('../src/routes/public/audits')
const { registerAdminAuditRoutes } = await import('../src/routes/admin/audits')
const { registerAdminUserRoutes } = await import('../src/routes/admin/users')
const { registerPublicMpcRoutes } = await import('../src/routes/public/mpc')

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
  registerPublicAuditRoutes(app)
  registerAdminAuditRoutes(app)
  registerAdminUserRoutes(app)
  registerPublicMpcRoutes(app)
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
  action: string
  requestId: string
  rawBody: Record<string, unknown>
  signablePayload: Record<string, unknown>
}) {
  const actor = input.wallet.address.toLowerCase()
  const timestamp = new Date().toISOString()
  const message = buildActionSignatureMessage({
    action: input.action,
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

describe('signed action routes', () => {
  beforeEach(() => {
    auditStore.clear()
    userStateStore.clear()
    mpcSessionStore.clear()
    mpcParticipantStore.clear()
    mpcMessageStore.clear()
    requestReplayStore.clear()
    createAuditMock.mockClear()
    approveAuditMock.mockClear()
    cancelAuditMock.mockClear()
    queryAuditMock.mockClear()
    saveUserStateMock.mockClear()
    createMpcSessionMock.mockClear()
    joinMpcSessionMock.mockClear()
    sendMpcMessageMock.mockClear()
    auditSearchResult = {
      data: [],
      page: {
        total: 0,
        page: 1,
        pageSize: 10,
      },
    }
  })

  it('forwards audit search filters and pagination to the audit service', async () => {
    const actor = Wallet.createRandom().address.toLowerCase()
    const app = createTestApp(actor)
    auditSearchResult = {
      data: [
        {
          meta: {
            uid: 'audit-search-1',
            auditType: 'application',
            applicant: `${actor}::${actor}`,
            approver: `${actor}::${actor}`,
            reason: '申请使用',
            createdAt: '2026-04-03T00:00:00.000Z',
            updatedAt: '2026-04-03T00:00:00.000Z',
            signature: 'sig',
            appOrServiceMetadata: JSON.stringify({
              operateType: 'application',
              did: 'did:app:search-1',
              version: 1,
              name: 'Search App',
            }),
          },
          commentMeta: [],
        },
      ],
      page: {
        total: 3,
        page: 2,
        pageSize: 1,
      },
    }

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/audits/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          condition: {
            approver: `${actor}::${actor}`,
            auditType: 'application',
            states: ['审批通过'],
            name: 'Search App',
            startTime: '2026-04-01T00:00:00.000Z',
            endTime: '2026-04-03T23:59:59.999Z',
          },
          page: 2,
          pageSize: 1,
        }),
      })
      const json = await response.json()

      expect(response.status).toBe(200)
      expect(queryAuditMock).toHaveBeenCalledWith({
        approver: `${actor}::${actor}`,
        applicant: undefined,
        name: 'Search App',
        auditType: 'application',
        states: ['审批通过'],
        startTime: '2026-04-01T00:00:00.000Z',
        endTime: '2026-04-03T23:59:59.999Z',
        page: 2,
        pageSize: 1,
      })
      expect(json.data.page).toEqual({
        total: 3,
        page: 2,
        pageSize: 1,
      })
      expect(json.data.items).toHaveLength(1)
      expect(json.data.items[0].meta.uid).toBe('audit-search-1')
    })
  })

  it('returns 409 when audit submit reuses requestId with a different payload', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const metadata = JSON.stringify({
      operateType: 'application',
      did: 'did:app:audit-1',
      version: 1,
      owner: actor,
      name: 'Audit App',
    })
    const baseRawBody = {
      appOrServiceMetadata: metadata,
      auditType: 'application',
      applicant: `${actor}::alice`,
      approver: '["0x1111111111111111111111111111111111111111"]',
      reason: '申请上架',
    }
    const baseSignablePayload = {
      auditType: 'application',
      targetType: 'application',
      targetDid: 'did:app:audit-1',
      targetVersion: 1,
      applicant: `${actor}::alice`,
      approver: '["0x1111111111111111111111111111111111111111"]',
      reason: '申请上架',
      appOrServiceMetadata: metadata,
    }
    const requestId = 'req-audit-submit-mismatch'
    const firstBody = await signBody({
      wallet,
      action: 'audit_submit',
      requestId,
      rawBody: baseRawBody,
      signablePayload: baseSignablePayload,
    })
    const secondBody = await signBody({
      wallet,
      action: 'audit_submit',
      requestId,
      rawBody: {
        ...baseRawBody,
        reason: '申请上架-变更',
      },
      signablePayload: {
        ...baseSignablePayload,
        reason: '申请上架-变更',
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/audits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(firstBody),
      })
      const second = await fetch(`${baseUrl}/api/v1/public/audits`, {
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
      expect(createAuditMock).toHaveBeenCalledTimes(1)
    })
  })

  it('replays the first admin audit approve response and only approves once', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const signedBody = await signBody({
      wallet,
      action: 'audit_decision',
      requestId: 'req-admin-audit-approve-replay',
      rawBody: {
        text: 'approved',
      },
      signablePayload: {
        auditId: 'audit-approve-1',
        decision: 'approve',
        approver: actor,
        text: 'approved',
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/admin/audits/audit-approve-1/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      const second = await fetch(`${baseUrl}/api/v1/admin/audits/audit-approve-1/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(approveAuditMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.auditId).toBe('audit-approve-1')
      expect(firstJson.data.status).toBe('COMMENT_STATUS_AGREE')
    })
  })

  it('replays the first audit cancel response after the audit has already been removed', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const existing = {
      uid: 'audit-cancel-1',
      auditType: 'application',
      applicant: `${actor}::alice`,
      approver: '',
      appOrServiceMetadata: JSON.stringify({
        operateType: 'application',
        did: 'did:app:audit-cancel-1',
        version: 1,
      }),
    }
    auditStore.set(existing.uid, existing)
    const signedBody = await signBody({
      wallet,
      action: 'audit_cancel',
      requestId: 'req-audit-cancel-replay',
      rawBody: {},
      signablePayload: {
        auditId: existing.uid,
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/audits/${existing.uid}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      expect(auditStore.get(existing.uid)).toBeUndefined()

      const second = await fetch(`${baseUrl}/api/v1/public/audits/${existing.uid}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(cancelAuditMock).toHaveBeenCalledTimes(1)
      expect(firstJson).toEqual(
        expect.objectContaining({
          code: 0,
          message: 'ok',
          data: {
            deleted: true,
            uid: existing.uid,
          },
        })
      )
    })
  })

  it('replays the first admin user role update response and only saves once', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const targetDid = 'did:user:test-1'
    const signedBody = await signBody({
      wallet,
      action: 'admin_user_role_update',
      requestId: 'req-admin-user-role-replay',
      rawBody: {
        role: USER_ROLE_OWNER,
      },
      signablePayload: {
        targetDid,
        role: USER_ROLE_OWNER,
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/admin/users/${encodeURIComponent(targetDid)}/role`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      const second = await fetch(`${baseUrl}/api/v1/admin/users/${encodeURIComponent(targetDid)}/role`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(saveUserStateMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.updated).toBe(true)
      expect(firstJson.data.state.did).toBe(targetDid)
      expect(firstJson.data.state.role).toBe(USER_ROLE_OWNER)
      expect(firstJson.data.state.status).toBe(USER_STATUS_ACTIVE)
      expect(userStateStore.get(targetDid)).toEqual(
        expect.objectContaining({
          did: targetDid,
          role: USER_ROLE_OWNER,
          status: USER_STATUS_ACTIVE,
        })
      )
    })
  })

  it('replays the first admin user status update response and only saves once', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const targetDid = 'did:user:test-status-1'
    const signedBody = await signBody({
      wallet,
      action: 'admin_user_status_update',
      requestId: 'req-admin-user-status-replay',
      rawBody: {
        status: USER_STATUS_DISABLE,
      },
      signablePayload: {
        targetDid,
        status: USER_STATUS_DISABLE,
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/admin/users/${encodeURIComponent(targetDid)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      const second = await fetch(`${baseUrl}/api/v1/admin/users/${encodeURIComponent(targetDid)}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(saveUserStateMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.updated).toBe(true)
      expect(firstJson.data.state.did).toBe(targetDid)
      expect(firstJson.data.state.status).toBe(USER_STATUS_DISABLE)
      expect(firstJson.data.state.role).toBe('USER_ROLE_UNKNOWN')
    })
  })

  it('replays the first mpc session create response and only creates once', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    const rawBody = {
      type: 'keygen',
      walletId: 'wallet-1',
      threshold: 2,
      participants: ['p1', 'p2', 'p3'],
      curve: 'secp256k1',
    }
    const signablePayload = {
      requestedSessionId: '',
      type: 'keygen',
      walletId: 'wallet-1',
      threshold: 2,
      participants: ['p1', 'p2', 'p3'],
      curve: 'secp256k1',
      expiresAt: '',
    }
    const signedBody = await signBody({
      wallet,
      action: 'mpc_session_create',
      requestId: 'req-mpc-session-create-replay',
      rawBody,
      signablePayload,
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/mpc/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ucan-token' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      const second = await fetch(`${baseUrl}/api/v1/public/mpc/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ucan-token' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(createMpcSessionMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.walletId).toBe('wallet-1')
      expect(firstJson.data.status).toBe('created')
    })
  })

  it('replays the first mpc session join response and only joins once', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    mpcSessionStore.set('session-join-1', {
      id: 'session-join-1',
      type: 'keygen',
      walletId: 'wallet-join-1',
      threshold: 2,
      participants: ['p1', 'p2'],
      status: 'created',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      createdAt: '0',
      expiresAt: '',
    })
    const rawBody = {
      participantId: 'p1',
      deviceId: 'device-1',
      identity: `did:pkh:eip155:1:${actor}`,
      e2ePublicKey: 'e2e-key',
      signingPublicKey: 'sign-key',
    }
    const signedBody = await signBody({
      wallet,
      action: 'mpc_session_join',
      requestId: 'req-mpc-join-replay',
      rawBody,
      signablePayload: {
        sessionId: 'session-join-1',
        participantId: 'p1',
        deviceId: 'device-1',
        identity: `did:pkh:eip155:1:${actor}`,
        e2ePublicKey: 'e2e-key',
        signingPublicKey: 'sign-key',
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/mpc/sessions/session-join-1/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ucan-token' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      const second = await fetch(`${baseUrl}/api/v1/public/mpc/sessions/session-join-1/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ucan-token' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(joinMpcSessionMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.participant.participantId).toBe('p1')
      expect(firstJson.data.session.joinedCount).toBe(1)
    })
  })

  it('replays the first mpc message send response and only sends once', async () => {
    const wallet = Wallet.createRandom()
    const actor = wallet.address.toLowerCase()
    const app = createTestApp(actor)
    mpcSessionStore.set('session-message-1', {
      id: 'session-message-1',
      type: 'keygen',
      walletId: 'wallet-message-1',
      threshold: 2,
      participants: ['p1', 'p2'],
      status: 'rounds',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      createdAt: '0',
      expiresAt: '',
    })
    const rawBody = {
      id: 'msg-1',
      from: 'p1',
      type: 'round1',
      round: 1,
      seq: 1,
      envelope: { cipher: 'abc' },
    }
    const signedBody = await signBody({
      wallet,
      action: 'mpc_message_send',
      requestId: 'req-mpc-message-replay',
      rawBody,
      signablePayload: {
        sessionId: 'session-message-1',
        messageId: 'msg-1',
        from: 'p1',
        to: '',
        round: 1,
        type: 'round1',
        seq: 1,
        envelope: { cipher: 'abc' },
      },
    })

    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/v1/public/mpc/sessions/session-message-1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ucan-token' },
        body: JSON.stringify(signedBody),
      })
      const firstJson = await first.json()

      const second = await fetch(`${baseUrl}/api/v1/public/mpc/sessions/session-message-1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ucan-token' },
        body: JSON.stringify(signedBody),
      })
      const secondJson = await second.json()

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(firstJson).toEqual(secondJson)
      expect(sendMpcMessageMock).toHaveBeenCalledTimes(1)
      expect(firstJson.data.id).toBe('msg-1')
      expect(firstJson.data.type).toBe('round1')
    })
  })

  it('returns 400 when mpc message id is missing', async () => {
    const actor = Wallet.createRandom().address.toLowerCase()
    const app = createTestApp(actor)
    mpcSessionStore.set('session-message-2', {
      id: 'session-message-2',
      type: 'keygen',
      walletId: 'wallet-message-2',
      threshold: 2,
      participants: ['p1', 'p2'],
      status: 'rounds',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      createdAt: '0',
      expiresAt: '',
    })

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/mpc/sessions/session-message-2/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ucan-token' },
        body: JSON.stringify({
          from: 'p1',
          type: 'round1',
          envelope: { cipher: 'abc' },
        }),
      })
      const responseJson = await response.json()

      expect(response.status).toBe(400)
      expect(responseJson).toEqual(
        expect.objectContaining({
          code: 400,
          message: 'Missing message id',
          data: null,
        })
      )
      expect(sendMpcMessageMock).not.toHaveBeenCalled()
    })
  })
})
