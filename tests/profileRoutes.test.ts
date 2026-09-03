import express, { Express, Request } from 'express'
import { AddressInfo } from 'net'

const permissionMocks = {
  isAdminUser: vi.fn(),
}

vi.doMock('../src/common/permission', () => permissionMocks)

const { registerPublicProfileRoute } = await import('../src/routes/privateProfile')

const actor = '0x1111111111111111111111111111111111111111'

function createTestApp(address = actor) {
  const app = express()
  app.use((req: Request & { user?: unknown }, _res, next) => {
    req.user = {
      address,
      authType: 'jwt',
      issuer: 'issuer-1',
    }
    next()
  })
  registerPublicProfileRoute(app)
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

describe('profile routes', () => {
  beforeEach(() => {
    permissionMocks.isAdminUser.mockReset()
    permissionMocks.isAdminUser.mockResolvedValue(false)
  })

  it('returns whether the current user can access admin features', async () => {
    permissionMocks.isAdminUser.mockResolvedValue(true)
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/profile/me`)
      const json = await response.json()
      expect(response.status).toBe(200)
      expect(json.data.address).toBe(actor)
      expect(json.data.authType).toBe('jwt')
      expect(json.data.isAdmin).toBe(true)
    })

    expect(permissionMocks.isAdminUser).toHaveBeenCalledWith(actor)
  })
})
