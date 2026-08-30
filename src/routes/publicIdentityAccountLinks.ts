import { Express, Request, Response } from 'express'
import { fail, ok } from '../auth/envelope'
import { issueAccountLinkChallenge, verifyAccountLink } from '../auth/identityAccountLink'
import { issueWalletAccountCredential } from '../auth/identityIssuer'

export function registerPublicIdentityAccountLinkRoutes(app: Express) {
  app.post('/api/v1/public/identity/account-links/challenge', async (req: Request, res: Response) => {
    try { res.json(ok(await issueAccountLinkChallenge({ identity: req.body?.identity, account: req.body?.account }))) }
    catch (error) { res.status(400).json(fail(400, error instanceof Error ? error.message : 'Challenge failed')) }
  })
  app.post('/api/v1/public/identity/account-links/verify', async (req: Request, res: Response) => {
    try {
      const result = await verifyAccountLink(req.body)
      const credential = await issueWalletAccountCredential(result)
      res.json(ok({ ...result, credential }))
    }
    catch (error) { res.status(400).json(fail(400, error instanceof Error ? error.message : 'Verification failed')) }
  })
}
