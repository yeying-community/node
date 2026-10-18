import express, { Express } from 'express'
import { AddressInfo } from 'net'

const revokeRefreshTokenMock = vi.fn()
const consumeRefreshTokenMock = vi.fn()
const issueTokensMock = vi.fn()
const provisionUserStateMock = vi.fn()

vi.doMock('../src/config/runtime', () => ({
  getConfig: vi.fn((key: string) => {
    const values: Record<string, unknown> = {
      'auth.refreshCookieName': 'refresh_token',
      'auth.cookieSameSite': 'lax',
      'auth.cookieSecure': false,
    }
    return values[key]
  }),
}))

vi.doMock('../src/auth/siwe', () => ({
  consumeRefreshToken: consumeRefreshTokenMock,
  deleteChallenge: vi.fn(),
  getChallenge: vi.fn(),
  issueChallenge: vi.fn(),
  issueTokens: issueTokensMock,
  revokeRefreshToken: revokeRefreshTokenMock,
  verifyChallengeSignature: vi.fn(),
}))

vi.doMock('../src/common/permission', () => ({
  provisionUserState: provisionUserStateMock,
}))

const { registerPublicAuthRoutes } = await import('../src/routes/publicAuth')

function createTestApp() {
  const app = express()
  app.use(express.json())
  registerPublicAuthRoutes(app)
  return app
}

function createEmailAuthTestApp(emailAuth: any) {
  const app = express()
  app.use(express.json())
  registerPublicAuthRoutes(app, emailAuth)
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

describe('public auth routes', () => {
  beforeEach(() => {
    revokeRefreshTokenMock.mockReset()
    consumeRefreshTokenMock.mockReset()
    issueTokensMock.mockReset()
    provisionUserStateMock.mockReset()
  })

  it('revokes refresh token and clears cookie on logout', async () => {
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/auth/logout`, {
        method: 'POST',
        headers: {
          cookie: 'refresh_token=test-refresh-token',
        },
      })

      expect(response.status).toBe(200)
      expect(revokeRefreshTokenMock).toHaveBeenCalledWith('test-refresh-token')

      const payload = await response.json()
      expect(payload.code).toBe(0)
      expect(payload.data).toEqual({ logout: true })

      const setCookie = response.headers.get('set-cookie') || ''
      expect(setCookie).toContain('refresh_token=')
      expect(setCookie.toLowerCase()).toContain('max-age=0')
    })
  })

  it('clears cookie and returns 401 when refresh token is invalid', async () => {
    consumeRefreshTokenMock.mockReturnValue(null)
    const app = createTestApp()

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/public/auth/refresh`, {
        method: 'POST',
        headers: {
          cookie: 'refresh_token=expired-token',
        },
      })

      expect(response.status).toBe(401)
      expect(consumeRefreshTokenMock).toHaveBeenCalledWith('expired-token')
      expect(provisionUserStateMock).not.toHaveBeenCalled()

      const payload = await response.json()
      expect(payload.code).toBe(401)
      expect(payload.message).toBe('Invalid refresh token')

      const setCookie = response.headers.get('set-cookie') || ''
      expect(setCookie).toContain('refresh_token=')
      expect(setCookie.toLowerCase()).toContain('max-age=0')
    })
  })

  it('exposes registration resend and cancel with stable error status mapping', async () => {
    const emailAuth = {
      resendRegister: vi.fn().mockRejectedValueOnce(new Error('IDENTITY_EMAIL_RESEND_RATE_LIMITED')),
      cancelRegister: vi.fn().mockResolvedValue({ cancelled: true }),
    }
    const app = createEmailAuthTestApp(emailAuth)

    await withServer(app, async (baseUrl) => {
      const resend = await fetch(`${baseUrl}/api/v1/public/auth/email/register/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verificationId: 'verification-id' }),
      })
      expect(resend.status).toBe(429)
      expect(await resend.json()).toMatchObject({ code: 429, message: 'IDENTITY_EMAIL_RESEND_RATE_LIMITED' })

      const cancel = await fetch(`${baseUrl}/api/v1/public/auth/email/register/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verificationId: 'verification-id' }),
      })
      expect(cancel.status).toBe(200)
      expect(await cancel.json()).toMatchObject({ code: 0, data: { cancelled: true } })
      expect(emailAuth.cancelRegister).toHaveBeenCalledWith({ verificationId: 'verification-id' })
    })
  })
})
