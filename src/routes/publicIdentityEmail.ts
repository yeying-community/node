import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { IdentityEmailService } from '../domain/service/identityEmail'

export function registerPublicIdentityEmailRoutes(app: Express, service: IdentityEmailService) {
  app.post('/api/v1/public/identity/verifications/request', async (req: Request, res: Response) => {
    try {
      res.json(ok(await service.request(req.body)))
    }
    catch (error) { res.status(400).json(fail(400, error instanceof Error ? error.message : 'Email verification request failed')) }
  })
  app.post('/api/v1/public/identity/verifications/confirm', async (req: Request, res: Response) => {
    try {
      res.json(ok(await service.confirm(req.body)))
    }
    catch (error) { res.status(400).json(fail(400, error instanceof Error ? error.message : 'Email verification failed')) }
  })
}
