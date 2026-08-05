import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { verifyAccessToken } from '../auth/siwe'
import { verifyUcanInvocation } from '../auth/ucan'
import { PassportError, PassportService } from '../domain/service/passport'

const BASE_PATH = '/api/v1/public/auth/passport'

function parseBearerToken(req: Request): string {
  const authHeader = String(req.headers.authorization || '').trim()
  if (!authHeader) return ''
  const [scheme, value] = authHeader.split(' ')
  if (scheme?.toLowerCase() === 'bearer') {
    return String(value || '').trim()
  }
  return authHeader
}

function normalizeSubject(input: unknown): string {
  const value = String(input || '').trim()
  if (!value) return ''
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase()
  return value
}

function requireBearerSubject(req: Request): string {
  const token = parseBearerToken(req)
  if (!token) {
    throw new PassportError(401, 'PASSPORT_TOKEN_MISSING', 'Missing access token')
  }
  const jwtPayload = verifyAccessToken(token)
  if (jwtPayload) {
    const subject = normalizeSubject(jwtPayload.address)
    if (subject) return subject
  }
  try {
    const ucan = verifyUcanInvocation(token)
    const subject = normalizeSubject(ucan.address)
    if (subject) return subject
  } catch {
    // handled below as a uniform auth error
  }
  throw new PassportError(401, 'PASSPORT_TOKEN_INVALID', 'Invalid or expired access token')
}

function mapPassportError(error: unknown): { status: number; message: string } {
  if (error instanceof PassportError) {
    return { status: error.status, message: error.message }
  }
  if (error && typeof error === 'object' && 'status' in error) {
    const candidate = Number((error as { status?: unknown }).status)
    if (Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
      return { status: candidate, message: error instanceof Error ? error.message : 'Passport request failed' }
    }
  }
  const message = error instanceof Error ? error.message : 'Passport request failed'
  if (message.includes('Missing')) return { status: 400, message }
  return { status: 500, message }
}

export function registerPublicAuthPassportRoutes(app: Express) {
  const service = new PassportService()

  app.get(`${BASE_PATH}/status`, (_req: Request, res: Response) => {
    res.json(ok(service.getStatus()))
  })

  app.post(`${BASE_PATH}/bind/request`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.ensureWalletSubject(address, {
        source: 'bearer',
        requestedAt: Date.now(),
      })
      res.json(ok({
        subjectId: result.subjectId,
        walletAddress: result.walletAddress,
        status: 'ready',
      }))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/bind/confirm`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.ensureWalletSubject(address, req.body?.proof || {
        source: 'bearer',
        confirmedAt: Date.now(),
      })
      res.json(ok({
        subjectId: result.subjectId,
        walletAddress: result.walletAddress,
      }))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get(`${BASE_PATH}/bindings`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.listBindingsByWallet(address)
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/bind/unlink/request`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.createWalletUnbindRequest(address)
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/bind/unlink/confirm`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.confirmWalletUnbind({
        walletAddress: address,
        requestId: req.body?.requestId,
        timestamp: req.body?.timestamp,
        signature: req.body?.signature,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/passkey/register/request`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.createPasskeyRegisterRequest({
        walletAddress: address,
        deviceName: req.body?.deviceName,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/passkey/register/confirm`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.confirmPasskeyRegistration({
        walletAddress: address,
        requestId: req.body?.requestId,
        deviceName: req.body?.deviceName,
        credential: req.body?.credential,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get(`${BASE_PATH}/passkey/credentials`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.listPasskeyCredentialsByWallet(address)
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/passkey/credentials/revoke`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.revokePasskeyCredentialByWallet(address, req.body?.credentialId)
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/passkey/credentials/rename`, async (req: Request, res: Response) => {
    try {
      const address = requireBearerSubject(req)
      const result = await service.renamePasskeyCredentialByWallet(
        address,
        req.body?.credentialId,
        req.body?.deviceName,
      )
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/authorize/request`, async (req: Request, res: Response) => {
    try {
      const result = await service.createAuthorizationRequest({
        appId: req.body?.appId,
        redirectUri: req.body?.redirectUri,
        state: req.body?.state,
        codeChallenge: req.body?.codeChallenge ?? req.body?.code_challenge,
        codeChallengeMethod: req.body?.codeChallengeMethod ?? req.body?.code_challenge_method,
        requestTtlMs: req.body?.requestTtlMs,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get(`${BASE_PATH}/authorize/request/:requestId`, async (req: Request, res: Response) => {
    try {
      const result = await service.getAuthorizationRequest(req.params.requestId)
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/authorize/challenge`, async (req: Request, res: Response) => {
    try {
      const result = await service.createPasskeyAuthorizationChallenge({
        requestId: req.body?.requestId,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/authorize/approve`, async (req: Request, res: Response) => {
    try {
      const token = parseBearerToken(req)
      const result = token
        ? await service.approveAuthorizationRequest({
            requestId: req.body?.requestId,
            walletAddress: requireBearerSubject(req),
            codeTtlMs: req.body?.codeTtlMs,
          })
        : await service.confirmPasskeyAuthorization({
            requestId: req.body?.requestId,
            passkeyRequestId: req.body?.passkeyRequestId ?? req.body?.challengeId,
            credential: req.body?.credential,
            codeTtlMs: req.body?.codeTtlMs,
          })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/authorize/exchange`, async (req: Request, res: Response) => {
    try {
      const result = await service.exchangeAuthorizationCode({
        code: req.body?.code,
        appId: req.body?.appId,
        redirectUri: req.body?.redirectUri,
        codeVerifier: req.body?.codeVerifier ?? req.body?.code_verifier,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPassportError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })
}
