import { Wallet } from 'ethers'
import { mockClass } from './support/mockClass'

const mockBegin = vi.fn()
const mockComplete = vi.fn()

vi.doMock('../src/domain/service/actionRequest', () => ({
  ActionRequestService: mockClass(() => ({
    begin: mockBegin,
    complete: mockComplete
  })),
}))

const {
  buildActionSignatureMessage,
  executeSignedAction,
  getActionSignatureErrorStatus
} = await import('../src/auth/actionSignature')
const { fail, ok } = await import('../src/auth/envelope')

function mapSignedActionError(error: unknown) {
  const message = error instanceof Error ? error.message : 'unknown'
  const status = getActionSignatureErrorStatus(message) ?? 500
  return {
    status,
    body: fail(status, message)
  }
}

async function createSignedRaw(input: {
  wallet: { address: string; signMessage(message: string): Promise<string> }
  action: string
  requestId: string
  payload: unknown
  timestamp?: string
}) {
  const actor = input.wallet.address.toLowerCase()
  const timestamp = input.timestamp || new Date().toISOString()
  const message = buildActionSignatureMessage({
    action: input.action,
    actor,
    timestamp,
    requestId: input.requestId,
    payload: input.payload
  })
  const signature = await input.wallet.signMessage(message)
  return {
    actor,
    raw: {
      requestId: input.requestId,
      timestamp,
      signature
    }
  }
}

describe('executeSignedAction', () => {
  beforeEach(() => {
    mockBegin.mockReset()
    mockComplete.mockReset()
  })

  it('executes and persists the first successful request', async () => {
    const wallet = Wallet.createRandom()
    const payload = { applicationUid: 'app-1' }
    const { actor, raw } = await createSignedRaw({
      wallet,
      action: 'application_publish',
      requestId: 'req-first',
      payload
    })

    mockBegin.mockResolvedValue({ kind: 'new' })
    mockComplete.mockResolvedValue(undefined)

    const execute = vi.fn().mockResolvedValue({
      status: 200,
      body: ok({ published: true })
    })

    const result = await executeSignedAction({
      raw,
      action: 'application_publish',
      actor,
      payload,
      execute,
      onError: mapSignedActionError
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual(
      expect.objectContaining({
        code: 0,
        message: 'ok',
        data: { published: true }
      })
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(mockBegin).toHaveBeenCalledTimes(1)
    expect(mockComplete).toHaveBeenCalledTimes(1)
    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        requestId: 'req-first',
        responseCode: 200
      })
    )
  })

  it('replays the cached response for a completed requestId', async () => {
    const wallet = Wallet.createRandom()
    const payload = { serviceUid: 'svc-1' }
    const { actor, raw } = await createSignedRaw({
      wallet,
      action: 'service_delete',
      requestId: 'req-replay',
      payload
    })

    const cachedBody = ok({ deleted: true })
    mockBegin.mockResolvedValue({
      kind: 'replay',
      responseCode: 200,
      responseBody: JSON.stringify(cachedBody)
    })

    const execute = vi.fn()

    const result = await executeSignedAction({
      raw,
      action: 'service_delete',
      actor,
      payload,
      execute,
      onError: mapSignedActionError
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual(cachedBody)
    expect(execute).not.toHaveBeenCalled()
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('returns 409 when the same requestId is reused with a different payload', async () => {
    const wallet = Wallet.createRandom()
    const payload = { auditId: 'audit-1', decision: 'approve' }
    const { actor, raw } = await createSignedRaw({
      wallet,
      action: 'audit_decision',
      requestId: 'req-mismatch',
      payload
    })

    mockBegin.mockRejectedValue(new Error('Request replay payload mismatch'))

    const execute = vi.fn()

    const result = await executeSignedAction({
      raw,
      action: 'audit_decision',
      actor,
      payload,
      execute,
      onError: mapSignedActionError
    })

    expect(result.status).toBe(409)
    expect(result.body).toEqual(
      expect.objectContaining({
        code: 409,
        message: 'Request replay payload mismatch',
        data: null
      })
    )
    expect(execute).not.toHaveBeenCalled()
    expect(mockComplete).not.toHaveBeenCalled()
  })

  it('returns 409 while the original request is still pending', async () => {
    const wallet = Wallet.createRandom()
    const payload = { sessionId: 'mpc-1', messageId: 'msg-1' }
    const { actor, raw } = await createSignedRaw({
      wallet,
      action: 'mpc_message_send',
      requestId: 'req-pending',
      payload
    })

    mockBegin.mockRejectedValue(new Error('Request in progress'))

    const execute = vi.fn()

    const result = await executeSignedAction({
      raw,
      action: 'mpc_message_send',
      actor,
      payload,
      execute,
      onError: mapSignedActionError
    })

    expect(result.status).toBe(409)
    expect(result.body).toEqual(
      expect.objectContaining({
        code: 409,
        message: 'Request in progress',
        data: null
      })
    )
    expect(execute).not.toHaveBeenCalled()
    expect(mockComplete).not.toHaveBeenCalled()
  })
})
