import { Express, Request, Response } from 'express'
import { confirmCredentialReissue, createCredentialReissueChallenge, getIdentityIssuerDid, getIdentityIssuerJwks, getIdentityIssuerMetadata, getCredentialStatus } from '../auth/identityIssuer'
import { fail, ok } from '../auth/envelope'

export function registerPublicIdentityRoutes(app: Express) {
  app.get('/.well-known/jwks.json', (_req: Request, res: Response) => res.json(getIdentityIssuerJwks()))
  app.get('/.well-known/openid-credential-issuer', (_req: Request, res: Response) => res.json(getIdentityIssuerMetadata()))
  app.post('/api/v1/public/identity/credentials/status', async (req: Request, res: Response) => {
    const issuer = String(req.body?.issuer || '').trim()
    const ids = Array.isArray(req.body?.credentials) ? req.body.credentials : []
    if (ids.length === 0) {
      res.status(400).json(fail(400, 'credentials is required'))
      return
    }
    if (issuer && issuer !== getIdentityIssuerDid()) {
      res.status(400).json(fail(400, 'IDENTITY_ISSUER_UNTRUSTED'))
      return
    }
    try {
      const statuses = Object.fromEntries(await Promise.all(ids.map(async (id: unknown) => {
        const status = await getCredentialStatus(String(id))
        return [String(id), status.status]
      })))
      const checkedAt = new Date().toISOString()
      res.json(ok({ issuer: getIdentityIssuerDid(), checkedAt, nextUpdateAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), statuses }))
    } catch (error) {
      res.status(503).json(fail(503, error instanceof Error ? error.message : 'Credential status unavailable'))
    }
  })
  app.post('/api/v1/public/identity/credentials/reissue/challenge', async (req: Request, res: Response) => {
    try {
      res.json(ok(await createCredentialReissueChallenge({ identity: req.body?.identity, credentialTypes: req.body?.credentialTypes })))
    } catch (error) {
      res.status(400).json(fail(400, error instanceof Error ? error.message : 'Credential reissue challenge failed'))
    }
  })
  app.post('/api/v1/public/identity/credentials/reissue/confirm', async (req: Request, res: Response) => {
    try {
      res.json(ok(await confirmCredentialReissue({ identity: req.body?.identity, challengeId: req.body?.challengeId, identityDocument: req.body?.identityDocument, proof: req.body?.proof })))
    } catch (error) {
      res.status(400).json(fail(400, error instanceof Error ? error.message : 'Credential reissue failed'))
    }
  })
}
