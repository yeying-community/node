import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { IdentityAuthorizationService } from '../domain/service/identityAuthorization'

function handle(error: unknown, res: Response) {
  const message = error instanceof Error ? error.message : 'Identity authorization failed'
  const status = message.includes('NOT_FOUND') ? 404 : message.includes('EXPIRED') ? 410 : message.includes('UNAUTHORIZED') || message.includes('MISMATCH') || message.includes('INVALID') || message.includes('CONTEXT') ? 400 : 503
  res.status(status).json(fail(status, message))
}

export function registerPublicIdentityAuthorizationRoutes(app: Express) {
  const service = new IdentityAuthorizationService()
  app.post('/api/v1/public/identity/authorize/request', async (req: Request, res: Response) => {
    try { res.json(ok(await service.create({ appId: req.body?.appId, redirectUri: req.body?.redirectUri, state: req.body?.state, codeChallenge: req.body?.codeChallenge ?? req.body?.code_challenge, codeChallengeMethod: req.body?.codeChallengeMethod ?? req.body?.code_challenge_method, scopes: req.body?.scopes ?? req.body?.scope }))) } catch (error) { handle(error, res) }
  })
  app.get('/api/v1/public/identity/authorize/request/:requestId', async (req: Request, res: Response) => {
    try { res.json(ok(await service.get(req.params.requestId))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/authorize/approve', async (req: Request, res: Response) => {
    try { res.json(ok(await service.approve({ requestId: req.body?.requestId, presentation: req.body?.presentation }))) } catch (error) { handle(error, res) }
  })
  app.post('/api/v1/public/identity/authorize/exchange', async (req: Request, res: Response) => {
    try { res.json(ok(await service.exchange({ code: req.body?.code, appId: req.body?.appId, redirectUri: req.body?.redirectUri, codeVerifier: req.body?.codeVerifier ?? req.body?.code_verifier }))) } catch (error) { handle(error, res) }
  })
}
