import { vi } from 'vitest'

let mpcConfig: { ucanWith?: string; ucanCan?: string } | undefined = {
  ucanWith: 'mpc',
  ucanCan: 'coordinate',
}

vi.mock('../src/config/runtime', () => ({
  getConfig: vi.fn((key: string) => {
    if (key === 'custody') {
      return { ucanWith: 'custody', ucanCan: 'write' }
    }
    if (key === 'mpc') {
      return mpcConfig
    }
    if (key === 'issuer.baseUrl') return 'http://localhost:8100'
    return undefined
  }),
}))

const { getRouteRequiredUcanCapabilities } = await import('../src/middleware/authMiddleware')

describe('auth middleware route capabilities', () => {
  afterEach(() => {
    mpcConfig = { ucanWith: 'mpc', ucanCan: 'coordinate' }
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
})
