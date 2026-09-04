import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { getIdentityTotpStatus, IdentityTotpError, IdentityTotpService } from '../auth/identityTotpAuth'

function handle(error: unknown, res: Response) {
  if (error instanceof IdentityTotpError) {
    res.status(error.status).json(fail(error.status, error.message))
    return
  }
  const message = error instanceof Error ? error.message : 'Identity TOTP request failed'
  const status = message.includes('INVALID') || message.includes('REQUIRED') || message.includes('UNAUTHORIZED') ? 400 : 503
  res.status(status).json(fail(status, message))
}

export function registerPublicIdentityTotpRoutes(app: Express) {
  const service = new IdentityTotpService()

  app.get('/api/v1/public/identity/totp/status', (_req: Request, res: Response) => {
    res.json(ok(getIdentityTotpStatus()))
  })

  app.post('/api/v1/public/identity/totp/get', async (req: Request, res: Response) => {
    try { res.json(ok(await service.get({ identity: req.body?.identity }))) } catch (error) { handle(error, res) }
  })

  app.post('/api/v1/public/identity/totp/setup', async (req: Request, res: Response) => {
    try { res.json(ok(await service.setup({ identity: req.body?.identity, identityDocument: req.body?.identityDocument, deviceName: req.body?.deviceName, audience: req.body?.audience, authorization: req.body?.authorization }))) } catch (error) { handle(error, res) }
  })

  app.post('/api/v1/public/identity/totp/confirm', async (req: Request, res: Response) => {
    try { res.json(ok(await service.confirm({ identity: req.body?.identity, code: req.body?.code }))) } catch (error) { handle(error, res) }
  })

  app.post('/api/v1/public/identity/totp/verify', async (req: Request, res: Response) => {
    try { res.json(ok(await service.verify({ identity: req.body?.identity, code: req.body?.code }))) } catch (error) { handle(error, res) }
  })

  app.post('/api/v1/public/identity/totp/revoke', async (req: Request, res: Response) => {
    try { res.json(ok(await service.revoke({ identity: req.body?.identity, identityDocument: req.body?.identityDocument, audience: req.body?.audience, authorization: req.body?.authorization }))) } catch (error) { handle(error, res) }
  })
}
