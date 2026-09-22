import { vi } from 'vitest'

let mpcConfig: { ucanWith?: string; ucanCan?: string } | undefined = {
  ucanWith: 'mpc',
  ucanCan: 'coordinate',
}
let routePolicyConfig: { routePolicyEnabled?: boolean; strictRoutePolicy?: boolean } = {}

const ucanMock = vi.hoisted(() => ({
  getRequiredUcanAudience: vi.fn(() => 'did:web:node.example'),
  getRequiredUcanCapability: vi.fn(() => ({ with: 'app:all', can: 'invoke' })),
  isUcanToken: vi.fn((token: string) => token.startsWith('ucan:')),
  peekUcanTokenPayload: vi.fn(() => null),
  verifyUcanInvocation: vi.fn(),
  verifyUcanInvocationWithCap: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  getConfig: vi.fn((key: string) => {
    if (key === 'custody') {
      return { ucanWith: 'custody', ucanCan: 'write' }
    }
    if (key === 'mpc') {
      return mpcConfig
    }
    if (key === 'ucan') {
      return routePolicyConfig
    }
    if (key === 'issuer.baseUrl') return 'http://localhost:8100'
    return undefined
  }),
}))

vi.mock('../src/auth/ucan', () => ucanMock)

vi.mock('../src/domain/facade/logger', () => ({
  SingletonLogger: {
    get: () => ({
      warn: vi.fn(),
    }),
  },
}))

const { default: authenticateToken, getRouteRequiredUcanCapabilities } = await import('../src/middleware/authMiddleware')
const { getRouteUcanPolicy } = await import('../src/auth/routeUcanPolicy')

describe('auth middleware route capabilities', () => {
  afterEach(() => {
    mpcConfig = { ucanWith: 'mpc', ucanCan: 'coordinate' }
    routePolicyConfig = {}
    vi.clearAllMocks()
  })

  it('uses custody capability when middleware is mounted at /api/v1', () => {
    expect(
      getRouteRequiredUcanCapabilities({
        baseUrl: '/api/v1',
        path: '/public/custody/status',
      }),
    ).toEqual([{ with: 'custody', can: 'write' }])
  })

  it('uses MPC capability when middleware is mounted at /api/v1', () => {
    expect(
      getRouteRequiredUcanCapabilities({
        baseUrl: '/api/v1',
        path: '/public/mpc/sessions',
      }),
    ).toEqual([{ with: 'mpc', can: 'coordinate' }])
  })

  it('uses MPC capability for MPC-scoped notification reads', () => {
    expect(
      getRouteRequiredUcanCapabilities({
        baseUrl: '/api/v1',
        path: '/public/notifications',
        query: { source: 'mpc' },
      }),
    ).toEqual([{ with: 'mpc', can: 'coordinate' }])
  })

  it('uses the MPC defaults when the local config omits the mpc section', () => {
    mpcConfig = undefined
    expect(
      getRouteRequiredUcanCapabilities({
        baseUrl: '/api/v1',
        path: '/public/mpc/sessions',
      }),
    ).toEqual([{ with: 'mpc', can: 'coordinate' }])
  })

  it('falls back to the global capability for unrelated routes', () => {
    expect(
      getRouteRequiredUcanCapabilities({
        baseUrl: '/api/v1',
        path: '/public/applications',
      }),
    ).toBeNull()
  })

  it('declares route capabilities when the policy registry is enabled', () => {
    routePolicyConfig = { routePolicyEnabled: true, strictRoutePolicy: false }
    expect(
      getRouteRequiredUcanCapabilities({
        baseUrl: '/api/v1',
        path: '/public/applications',
      }),
    ).toEqual([{ with: 'node:application:public', can: 'read' }])
    expect(
      getRouteUcanPolicy({
        method: 'POST',
        baseUrl: '/api/v1',
        path: '/public/notifications/read-all',
      }),
    ).toEqual({
      strict: false,
      anyOf: [[{ with: 'node:notification:own', can: 'write' }]],
    })
    expect(
      getRouteUcanPolicy({
        method: 'GET',
        baseUrl: '/api/v1',
        path: '/public/audits/audit-1',
      }),
    ).toMatchObject({
      strict: false,
      anyOf: expect.arrayContaining([
        [{ with: 'node:audit:own', can: 'read' }],
        [{ with: 'node:audit:approver', can: 'read' }],
      ]),
    })
  })

  it('keeps strict mode in the route policy contract', () => {
    routePolicyConfig = { routePolicyEnabled: true, strictRoutePolicy: true }
    expect(
      getRouteUcanPolicy({
        method: 'GET',
        baseUrl: '/api/v1',
        path: '/public/applications',
      }),
    ).toMatchObject({ strict: true })
  })

  it('verifies a UCAN against the enabled route policy', async () => {
    routePolicyConfig = { routePolicyEnabled: true, strictRoutePolicy: false }
    ucanMock.verifyUcanInvocationWithCap.mockResolvedValueOnce({
      address: '0x1111111111111111111111111111111111111111',
      issuer: 'did:key:zIssuer',
      source: 'wallet',
    })
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const next = vi.fn()

    await authenticateToken(
      {
        method: 'GET',
        baseUrl: '/api/v1',
        path: '/public/applications',
        originalUrl: '/api/v1/public/applications',
        headers: { authorization: 'Bearer ucan:valid' },
        query: {},
        socket: {},
      } as any,
      { status, json } as any,
      next,
    )

    expect(ucanMock.verifyUcanInvocationWithCap).toHaveBeenCalledWith(
      'ucan:valid',
      [{ with: 'node:application:public', can: 'read' }],
    )
    expect(next).toHaveBeenCalledOnce()
    expect(status).not.toHaveBeenCalled()
  })

  it('rejects a UCAN that does not satisfy the enabled route policy', async () => {
    routePolicyConfig = { routePolicyEnabled: true, strictRoutePolicy: false }
    ucanMock.verifyUcanInvocationWithCap.mockRejectedValueOnce(new Error('UCAN capability denied'))
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const next = vi.fn()

    await authenticateToken(
      {
        method: 'GET',
        baseUrl: '/api/v1',
        path: '/public/applications',
        originalUrl: '/api/v1/public/applications',
        headers: { authorization: 'Bearer ucan:denied' },
        query: {},
        socket: {},
      } as any,
      { status, json } as any,
      next,
    )

    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 401,
      message: 'UCAN capability denied',
    }))
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects non-UCAN tokens on capability routes', () => {
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const next = vi.fn()

    authenticateToken(
      {
        method: 'GET',
        baseUrl: '/api/v1',
        path: '/public/custody/status',
        originalUrl: '/api/v1/public/custody/status',
        headers: {
          authorization: 'Bearer jwt-token',
        },
        query: {},
        socket: {},
      } as any,
      { status, json } as any,
      next,
    )

    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 401,
      message: 'UCAN token required',
    }))
    expect(next).not.toHaveBeenCalled()
  })

  it('lets custody recovery routes validate their dedicated recovery token', () => {
    const status = vi.fn().mockReturnThis()
    const json = vi.fn()
    const next = vi.fn()

    authenticateToken(
      {
        method: 'GET',
        baseUrl: '/api/v1',
        path: '/public/custody/recovery/secrets',
        originalUrl: '/api/v1/public/custody/recovery/secrets',
        headers: {},
        query: {},
        socket: {},
      } as any,
      { status, json } as any,
      next,
    )

    expect(next).toHaveBeenCalledOnce()
    expect(status).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
  })
})
