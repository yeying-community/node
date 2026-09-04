import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { verifyAccessToken } from '../auth/siwe'
import { ScopedGrantError, ScopedGrantService } from '../domain/service/scopedGrant'
import { executeSignedAction, getActionSignatureErrorStatus } from '../auth/actionSignature'

const BASE_PATH = '/api/v1/public/auth/grants'

function subjectFromRequest(req: Request): string {
  const raw = String(req.headers.authorization || '').trim()
  const token = raw.toLowerCase().startsWith('bearer ') ? raw.slice(7).trim() : raw
  const payload = verifyAccessToken(token)
  const address = String(payload?.address || '').trim().toLowerCase()
  if (!address) throw new ScopedGrantError(401, 'Invalid or expired access token')
  return address
}

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'Scoped grant request failed'
  const status = getActionSignatureErrorStatus(message) ?? (error instanceof ScopedGrantError ? error.status : 500)
  res.status(status).json(fail(status, message))
}

export function registerPublicAuthGrantRoutes(app: Express) {
  const service = new ScopedGrantService()
  app.post(BASE_PATH, async (req, res) => { try {
    const subjectId = subjectFromRequest(req); const payload = { appId: req.body?.appId, audience: req.body?.audience, capabilities: req.body?.capabilities, expiresAt: req.body?.expiresAt }
    const result = await executeSignedAction({ raw: req.body || {}, action: 'ucan_grant_create', actor: subjectId, payload, execute: async () => ({ status: 200, body: ok(await service.create({ subjectId, ...payload })) }), onError: error => { const message = error instanceof Error ? error.message : 'Scoped grant request failed'; const status = getActionSignatureErrorStatus(message) ?? 500; return { status, body: fail(status, message) } } })
    res.status(result.status).json(result.body)
  } catch (error) { sendError(res, error) } })
  app.get(BASE_PATH, async (req, res) => { try { res.json(ok(await service.list(subjectFromRequest(req)))) } catch (error) { sendError(res, error) } })
  app.get(`${BASE_PATH}/:grantId`, async (req, res) => { try { const status = await service.getStatus(req.params.grantId); if (status.subjectId !== subjectFromRequest(req)) throw new ScopedGrantError(403, 'Scoped grant does not belong to subject'); res.json(ok(status)) } catch (error) { sendError(res, error) } })
  app.post(`${BASE_PATH}/:grantId/token`, async (req, res) => { try { res.json(ok(await service.issue({ grantId: req.params.grantId, subjectId: subjectFromRequest(req), audience: req.body?.audience, capabilities: req.body?.capabilities, expiresInMs: req.body?.expiresInMs }))) } catch (error) { sendError(res, error) } })
  app.post(`${BASE_PATH}/:grantId/revoke`, async (req, res) => { try {
    const subjectId = subjectFromRequest(req); const payload = { grantId: req.params.grantId, reason: req.body?.reason }
    const result = await executeSignedAction({ raw: req.body || {}, action: 'ucan_grant_revoke', actor: subjectId, payload, execute: async () => ({ status: 200, body: ok(await service.revoke({ grantId: req.params.grantId, subjectId, reason: req.body?.reason })) }), onError: error => { const message = error instanceof Error ? error.message : 'Scoped grant request failed'; const status = getActionSignatureErrorStatus(message) ?? 500; return { status, body: fail(status, message) } } })
    res.status(result.status).json(result.body)
  } catch (error) { sendError(res, error) } })
  app.post(`${BASE_PATH}/:grantId/tokens/:tokenId/revoke`, async (req, res) => { try { res.json(ok(await service.revoke({ grantId: req.params.grantId, tokenId: req.params.tokenId, subjectId: subjectFromRequest(req), reason: req.body?.reason }))) } catch (error) { sendError(res, error) } })
  app.get(`/api/v1/internal/auth/grants/:grantId/status`, async (req, res) => { try { res.json(ok(await service.getStatus(req.params.grantId))) } catch (error) { sendError(res, error) } })
}
