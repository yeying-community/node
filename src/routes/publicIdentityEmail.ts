import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { IdentityEmailService } from '../domain/service/identityEmail'

const CONFLICT_ERRORS = new Set([
  'IDENTITY_EMAIL_ALREADY_BOUND',
  'IDENTITY_EMAIL_CHANGE_REQUIRES_AUTHORIZATION',
  'IDENTITY_EMAIL_BINDING_CONFLICT',
])

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Email verification failed'
  const status = CONFLICT_ERRORS.has(message) ? 409 : 400
  return { status, message }
}

export function registerPublicIdentityEmailRoutes(app: Express, service: IdentityEmailService) {
  app.post('/api/v1/public/identity/verifications/request', async (req: Request, res: Response) => {
    try {
      res.json(ok(await service.request(req.body)))
    }
    catch (error) {
      const response = errorResponse(error)
      res.status(response.status).json(fail(response.status, response.message))
    }
  })
  app.post('/api/v1/public/identity/verifications/confirm', async (req: Request, res: Response) => {
    try {
      res.json(ok(await service.confirm(req.body)))
    }
    catch (error) {
      const response = errorResponse(error)
      res.status(response.status).json(fail(response.status, response.message))
    }
  })
}
