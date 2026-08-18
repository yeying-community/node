import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { getRequestUser } from '../../common/requestContext'
import { ensureUserActive, ensureUserCanWriteBusinessData } from '../../common/permission'
import { CustodyService } from '../../domain/service/custody'
import { consumeCustodyRecoveryToken, verifyCustodyRecoveryToken } from '../../auth/custodyRecoveryToken'

function recoveryToken(req: Request): string {
  const [scheme, value] = String(req.headers.authorization || '').trim().split(' ')
  return scheme?.toLowerCase() === 'bearer' ? String(value || '') : ''
}

function mapCustodyError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : 'Custody request failed'
  switch (message) {
    case 'INVALID_SUBJECT':
      return { status: 400, message: 'Invalid subject' }
    case 'MISSING_WALLET_ID':
      return { status: 400, message: 'Missing walletId' }
    case 'MISSING_CIPHERTEXT':
      return { status: 400, message: 'Missing ciphertext' }
    case 'PASSKEY_REQUIRED':
      return { status: 403, message: 'Passkey binding required before enabling custody' }
    case 'CUSTODY_RECORD_NOT_FOUND':
      return { status: 404, message: 'Custody record not found' }
    case 'Missing access token':
      return { status: 401, message: 'Missing access token' }
    case 'USER_BLOCKED':
      return { status: 403, message: 'User blocked' }
    case 'USER_ROLE_DENIED':
      return { status: 403, message: 'User role denied' }
    default:
      return { status: 500, message }
  }
}

function requireUserAddress(): string {
  const user = getRequestUser()
  if (!user?.address) {
    throw new Error('Missing access token')
  }
  return user.address
}

export function registerPublicCustodyRoutes(app: Express) {
  const service = new CustodyService()

  app.get('/api/v1/public/custody/recovery/secrets', async (req: Request, res: Response) => {
    const claims = verifyCustodyRecoveryToken(recoveryToken(req))
    if (!claims) return void res.status(401).json(fail(401, 'Invalid or expired recovery token'))
    try {
      res.json(ok({ records: await service.listRecords(claims.address) }))
    } catch (error) {
      const mapped = mapCustodyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/custody/recovery/secrets/:walletId', async (req: Request, res: Response) => {
    const claims = consumeCustodyRecoveryToken(recoveryToken(req))
    if (!claims) return void res.status(401).json(fail(401, 'Invalid, expired, or used recovery token'))
    try {
      res.json(ok(await service.getRecord(claims.address, req.params.walletId)))
    } catch (error) {
      const mapped = mapCustodyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/custody/status', async (_req: Request, res: Response) => {
    try {
      const address = requireUserAddress()
      await ensureUserActive(address)
      const status = await service.getStatus(address)
      res.json(ok(status))
    } catch (error) {
      const mapped = mapCustodyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/custody/secrets', async (_req: Request, res: Response) => {
    try {
      const address = requireUserAddress()
      await ensureUserActive(address)
      const records = await service.listRecords(address)
      res.json(ok({ records }))
    } catch (error) {
      const mapped = mapCustodyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/custody/secrets/:walletId', async (req: Request, res: Response) => {
    try {
      const address = requireUserAddress()
      await ensureUserActive(address)
      const record = await service.getRecord(address, req.params.walletId)
      res.json(ok(record))
    } catch (error) {
      const mapped = mapCustodyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/custody/secrets', async (req: Request, res: Response) => {
    try {
      const address = requireUserAddress()
      await ensureUserActive(address)
      await ensureUserCanWriteBusinessData(address)
      const record = await service.upsertRecord(address, {
        walletId: req.body?.walletId,
        accountId: req.body?.accountId,
        address: req.body?.address,
        ciphertext: req.body?.ciphertext,
        metadata: req.body?.metadata,
      })
      const status = await service.getStatus(address)
      res.json(ok({ record, status }))
    } catch (error) {
      const mapped = mapCustodyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.delete('/api/v1/public/custody/secrets/:walletId', async (req: Request, res: Response) => {
    try {
      const address = requireUserAddress()
      await ensureUserActive(address)
      await ensureUserCanWriteBusinessData(address)
      const result = await service.deleteRecord(address, req.params.walletId)
      res.json(ok(result))
    } catch (error) {
      const mapped = mapCustodyError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })
}
