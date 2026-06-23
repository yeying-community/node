import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { verifyAccessToken } from '../auth/siwe'
import { verifyUcanInvocation } from '../auth/ucan'
import {
  createPasskeyAuthorizeRequest,
  createPasskeyRegisterRequest,
  confirmPasskeyAuthorize,
  confirmPasskeyRegistration,
  getPasskeyAuthStatus,
  listPasskeyCredentials,
  revokePasskeyCredential,
  PasskeyAuthError,
} from '../auth/passkeyAuth'
import {
  approveTotpAuthorizeRequestBySubject,
  createTotpAuthorizeCode,
  createTotpAuthorizeRequest,
  exchangeTotpAuthorizeCode,
  getTotpAuthorizePendingApproval,
  getTotpAuthorizeRequest,
} from '../auth/totpAuthorize'
import { TotpAuthError } from '../auth/totpAuth'
import { createCentralIssueSession, issueCentralUcanBySession } from '../auth/ucanIssuer'
import { issueTokens } from '../auth/siwe'
import { provisionUserState } from '../common/permission'

const BASE_PATH = '/api/v1/public/auth/passkey'
const RATE_LIMIT_STORE = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_GC_INTERVAL_MS = 5 * 60 * 1000
let nextRateLimitGcAt = 0

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
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase()
  }
  return value
}

function resolveBearerSubject(
  rawToken: string
): { subject: string; authType: 'jwt' | 'ucan' } {
  const token = String(rawToken || '').trim()
  if (!token) {
    throw new PasskeyAuthError(401, 'PASSKEY_AUTH_TOKEN_MISSING', 'Missing access token')
  }

  const jwtPayload = verifyAccessToken(token)
  if (jwtPayload) {
    const subject = normalizeSubject(jwtPayload.address)
    if (!subject) {
      throw new PasskeyAuthError(401, 'PASSKEY_AUTH_TOKEN_INVALID', 'Invalid access token subject')
    }
    return { subject, authType: 'jwt' }
  }

  try {
    const ucan = verifyUcanInvocation(token)
    const subject = normalizeSubject(ucan.address)
    if (!subject) {
      throw new PasskeyAuthError(401, 'PASSKEY_AUTH_TOKEN_INVALID', 'Invalid access token subject')
    }
    return { subject, authType: 'ucan' }
  } catch {
    throw new PasskeyAuthError(401, 'PASSKEY_AUTH_TOKEN_INVALID', 'Invalid or expired access token')
  }
}

function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0] || '').trim()
  }
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return req.socket.remoteAddress || ''
}

function cleanupRateLimitStore(nowMs = Date.now()): void {
  if (RATE_LIMIT_STORE.size === 0) {
    nextRateLimitGcAt = nowMs + RATE_LIMIT_GC_INTERVAL_MS
    return
  }
  for (const [key, record] of RATE_LIMIT_STORE.entries()) {
    if (record.resetAt <= nowMs) {
      RATE_LIMIT_STORE.delete(key)
    }
  }
  nextRateLimitGcAt = nowMs + RATE_LIMIT_GC_INTERVAL_MS
}

function consumeRateLimit(key: string, windowMs: number, max: number): boolean {
  const nowMs = Date.now()
  if (nextRateLimitGcAt === 0 || nowMs >= nextRateLimitGcAt) {
    cleanupRateLimitStore(nowMs)
  }
  const current = RATE_LIMIT_STORE.get(key)
  if (!current || current.resetAt <= nowMs) {
    RATE_LIMIT_STORE.set(key, { count: 1, resetAt: nowMs + windowMs })
    return true
  }
  if (current.count >= max) {
    return false
  }
  current.count += 1
  RATE_LIMIT_STORE.set(key, current)
  return true
}

function requireRateLimit(
  req: Request,
  res: Response,
  input: {
    bucket: string
    key: string
    windowMs: number
    max: number
    message: string
    globalMax?: number
  }
): boolean {
  const ip = resolveClientIp(req)
  const globalKey = `${input.bucket}:${ip}:*`
  const globalMax = Number.isFinite(input.globalMax) && (input.globalMax as number) > 0
    ? Math.trunc(input.globalMax as number)
    : input.max
  if (!consumeRateLimit(globalKey, input.windowMs, globalMax)) {
    res.status(429).json(fail(429, input.message))
    return false
  }
  const normalizedKey = String(input.key || '').trim() || '-'
  const mergedKey = `${input.bucket}:${ip}:${normalizedKey}`
  if (consumeRateLimit(mergedKey, input.windowMs, input.max)) {
    return true
  }
  res.status(429).json(fail(429, input.message))
  return false
}

function mapPasskeyError(error: unknown): { status: number; message: string } {
  if (error instanceof PasskeyAuthError) {
    return { status: error.status, message: error.message }
  }
  if (error instanceof TotpAuthError) {
    return { status: error.status, message: error.message }
  }
  const message = error instanceof Error ? error.message : 'Passkey auth failed'
  if (message.includes('Invalid or expired session token')) {
    return { status: 401, message }
  }
  if (message.includes('disabled') || message.includes('mode does not allow issue')) {
    return { status: 403, message }
  }
  if (message.includes('not ready')) {
    return { status: 503, message }
  }
  return {
    status: 500,
    message,
  }
}

export function registerPublicAuthPasskeyRoutes(app: Express) {
  app.get(`${BASE_PATH}/status`, (_req: Request, res: Response) => {
    res.json(ok(getPasskeyAuthStatus()))
  })

  app.post(`${BASE_PATH}/authorize/request`, async (req: Request, res: Response) => {
    try {
      const subject = String(req.body?.address || req.body?.subject || '').trim().toLowerCase()
      const appId = String(req.body?.appId || '').trim()
      if (
        !requireRateLimit(req, res, {
          bucket: 'passkey-authorize-request',
          key: `${subject}:${appId}`,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many authorization requests, please try again later',
        })
      ) {
        return
      }
      const result = await createTotpAuthorizeRequest({
        subject,
        appId: req.body?.appId,
        redirectUri: req.body?.redirectUri,
        state: req.body?.state,
        requestTtlMs: req.body?.requestTtlMs,
        sessionTtlMs: req.body?.sessionTtlMs,
        tokenTtlMs: req.body?.tokenTtlMs ?? req.body?.expiresInMs,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get(`${BASE_PATH}/authorize/request/:requestId`, (req: Request, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim()
      const result = getTotpAuthorizeRequest(requestId)
      if (!result) {
        res.status(404).json(fail(404, 'passkey authorize request not found'))
        return
      }
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/authorize/challenge`, async (req: Request, res: Response) => {
    try {
      const requestId = String(req.body?.requestId || '').trim()
      if (!requestId) {
        res.status(400).json(fail(400, 'Missing requestId'))
        return
      }
      const pending = getTotpAuthorizePendingApproval(requestId)
      if (!pending) {
        res.status(404).json(fail(404, 'passkey authorize request not found'))
        return
      }
      if (
        !requireRateLimit(req, res, {
          bucket: 'passkey-authorize-challenge',
          key: pending.subject,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many passkey authorization challenges, please try again later',
        })
      ) {
        return
      }
      const result = await createPasskeyAuthorizeRequest(pending.subject)
      res.json(ok({ authorizeRequest: pending, passkeyRequest: result }))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/register/request`, async (req: Request, res: Response) => {
    try {
      const accessToken = parseBearerToken(req)
      const auth = resolveBearerSubject(accessToken)

      if (
        !requireRateLimit(req, res, {
          bucket: 'passkey-register-request',
          key: auth.subject,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many passkey register requests, please try again later',
        })
      ) {
        return
      }

      const result = await createPasskeyRegisterRequest({
        subject: auth.subject,
        deviceName: req.body?.deviceName,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/register/confirm`, async (req: Request, res: Response) => {
    try {
      const accessToken = parseBearerToken(req)
      const auth = resolveBearerSubject(accessToken)

      if (
        !requireRateLimit(req, res, {
          bucket: 'passkey-register-confirm',
          key: auth.subject,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many passkey register confirm requests, please try again later',
        })
      ) {
        return
      }

      const result = await confirmPasskeyRegistration({
        subject: auth.subject,
        requestId: req.body?.requestId,
        deviceName: req.body?.deviceName,
        credential: req.body?.credential,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get(`${BASE_PATH}/credentials`, async (req: Request, res: Response) => {
    try {
      const accessToken = parseBearerToken(req)
      const auth = resolveBearerSubject(accessToken)
      const result = await listPasskeyCredentials(auth.subject)
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/credentials/revoke`, async (req: Request, res: Response) => {
    try {
      const accessToken = parseBearerToken(req)
      const auth = resolveBearerSubject(accessToken)
      await revokePasskeyCredential(auth.subject, req.body?.credentialId)
      res.json(ok({ success: true }))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/authorize/approve`, async (req: Request, res: Response) => {
    try {
      const requestId = String(req.body?.requestId || '').trim()
      if (!requestId) {
        res.status(400).json(fail(400, 'Missing requestId'))
        return
      }
      const pending = getTotpAuthorizePendingApproval(requestId)
      if (!pending) {
        res.status(404).json(fail(404, 'passkey authorize request not found'))
        return
      }
      if (
        !requireRateLimit(req, res, {
          bucket: 'passkey-authorize-approve',
          key: requestId,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many passkey authorization approvals, please try again later',
        })
      ) {
        return
      }

      await confirmPasskeyAuthorize({
        subject: pending.subject,
        requestId: req.body?.passkeyRequestId,
        credential: req.body?.credential,
      })

      const consumed = await approveTotpAuthorizeRequestBySubject({
        requestId,
        expectedSubject: pending.subject,
      })

      await provisionUserState(consumed.subject)
      const tokens = issueTokens(consumed.subject)
      const session = createCentralIssueSession({
        subject: consumed.subject,
        expiresInMs: consumed.sessionTtlMs,
      })
      const issued = issueCentralUcanBySession({
        sessionToken: session.sessionToken,
        audience: consumed.audience,
        capabilities: consumed.capabilities,
        expiresInMs: consumed.tokenTtlMs,
      })

      const authCode = await createTotpAuthorizeCode({
        requestId: consumed.requestId,
        subject: consumed.subject,
        appId: consumed.appId,
        redirectUri: consumed.redirectUri,
        state: consumed.state,
        token: tokens.accessToken,
        expiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        ucan: issued.ucan,
        issuer: issued.issuer,
        audience: issued.audience,
        capabilities: issued.capabilities,
        notBefore: issued.notBefore,
        ucanExpiresAt: issued.expiresAt,
      })

      res.json(
        ok({
          requestId: consumed.requestId,
          appName: consumed.appName,
          approvedAt: consumed.approvedAt,
          authorizationCode: authCode.code,
          authorizationCodeExpiresAt: authCode.expiresAt,
          redirectTo: authCode.redirectTo,
        })
      )
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post(`${BASE_PATH}/authorize/exchange`, async (req: Request, res: Response) => {
    try {
      const appId = String(req.body?.appId || '').trim()
      if (
        !requireRateLimit(req, res, {
          bucket: 'passkey-authorize-exchange',
          key: appId,
          windowMs: 60 * 1000,
          max: 30,
          message: 'Too many token exchanges, please try again later',
        })
      ) {
        return
      }
      const result = await exchangeTotpAuthorizeCode({
        code: req.body?.code,
        appId: req.body?.appId,
        redirectUri: req.body?.redirectUri,
      })
      res.json(ok(result))
    } catch (error) {
      const mapped = mapPasskeyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })
}
