import { Express, Request, Response } from 'express'
import { fail, ok } from '../../auth/envelope'
import { getRequestUser } from '../../common/requestContext'
import { ensureUserActive, ensureUserCanWriteBusinessData } from '../../common/permission'
import { PaymentService } from '../../domain/service/payment'

function bodyObject(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {}
}
function signedInput(req: Request) {
  const source = bodyObject(req)
  const { merchantId, timestamp, nonce, signature, ...body } = source
  const header = (name: string): string => String(req.headers[name] || '').trim()
  return {
    merchantId: header('x-payment-merchant') || String(merchantId || '').trim(),
    timestamp: header('x-payment-timestamp') || String(timestamp || '').trim(),
    nonce: header('x-payment-nonce') || String(nonce || '').trim(),
    signature: header('x-payment-signature') || String(signature || '').trim(),
    body,
  }
}

function rawBody(req: Request): string {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody
  if (raw) return raw.toString('utf8')
  if (typeof req.body === 'string') return req.body
  return JSON.stringify(bodyObject(req))
}

function currentAddress(): string {
  return String(getRequestUser()?.address || '').trim()
}

function mapPaymentError(error: unknown): { status: number; message: string } {
  const rawMessage = error instanceof Error ? error.message : ''
  const message = /^PAYMENT_[A-Z0-9_]+$/.test(rawMessage) || rawMessage === 'Missing access token'
    ? rawMessage
    : 'PAYMENT_REQUEST_FAILED'
  if (message === 'Missing access token') return { status: 401, message }
  if (message.includes('SIGNATURE') || message.includes('REPLAYED')) return { status: 401, message }
  if (message.includes('NOT_FOUND')) return { status: 404, message }
  if (message.includes('IDEMPOTENCY_CONFLICT') || message.includes('EXCEEDED') || message.includes('NOT_REFUNDABLE')) return { status: 409, message }
  if (message.includes('PROVIDER') || message.includes('DISABLED')) return { status: 503, message }
  if (message.includes('URL') || message.includes('INVALID') || message.includes('UNSUPPORTED') || message.includes('REQUIRED')) return { status: 400, message }
  return { status: 500, message }
}

async function authenticateSigned(service: PaymentService, req: Request) {
  const input = signedInput(req)
  return { merchant: await service.authenticateMerchantRequest(input), body: input.body }
}

export function registerPublicPaymentGatewayRoutes(app: Express) {
  const service = new PaymentService()

  app.post('/api/v1/public/payment/gateway/merchants', async (req: Request, res: Response) => {
    try {
      const owner = currentAddress()
      if (!owner) return void res.status(401).json(fail(401, 'Missing access token'))
      await ensureUserActive(owner)
      await ensureUserCanWriteBusinessData(owner)
      res.json(ok(await service.createMerchant(owner, { name: req.body?.name, callbackUrl: req.body?.callbackUrl })))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.get('/api/v1/public/payment/gateway/merchants', async (_req: Request, res: Response) => {
    try {
      const owner = currentAddress()
      if (!owner) return void res.status(401).json(fail(401, 'Missing access token'))
      await ensureUserActive(owner)
      res.json(ok(await service.listMerchants(owner)))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.delete('/api/v1/public/payment/gateway/merchants/:merchantId', async (req: Request, res: Response) => {
    try {
      const owner = currentAddress()
      if (!owner) return void res.status(401).json(fail(401, 'Missing access token'))
      await ensureUserActive(owner)
      await ensureUserCanWriteBusinessData(owner)
      res.json(ok(await service.disableMerchant(owner, req.params.merchantId)))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/payment/gateway/transactions', async (req: Request, res: Response) => {
    try {
      const signed = await authenticateSigned(service, req)
      res.json(ok(await service.createTransaction(signed.merchant, {
        externalOrderId: signed.body.externalOrderId,
        amountMinor: signed.body.amountMinor,
        currency: signed.body.currency,
        description: signed.body.description,
        clientType: signed.body.clientType,
        returnUrl: signed.body.returnUrl,
        idempotencyKey: signed.body.idempotencyKey,
        clientIp: String(req.ip || req.socket.remoteAddress || '').trim(),
      })))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/payment/gateway/transactions/query', async (req: Request, res: Response) => {
    try {
      const signed = await authenticateSigned(service, req)
      res.json(ok(await service.queryProviderPayment(signed.merchant, String(signed.body.tradeNo || ''))))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/payment/gateway/transactions/cancel', async (req: Request, res: Response) => {
    try {
      const signed = await authenticateSigned(service, req)
      res.json(ok(await service.cancelTransaction(signed.merchant, String(signed.body.tradeNo || ''))))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/payment/gateway/refunds', async (req: Request, res: Response) => {
    try {
      const signed = await authenticateSigned(service, req)
      res.json(ok(await service.requestRefund(signed.merchant, {
        tradeNo: signed.body.tradeNo,
        amountMinor: signed.body.amountMinor,
        reason: signed.body.reason,
        idempotencyKey: signed.body.idempotencyKey,
      })))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  app.post('/api/v1/public/payment/gateway/refunds/query', async (req: Request, res: Response) => {
    try {
      const signed = await authenticateSigned(service, req)
      res.json(ok(await service.queryRefund(signed.merchant, String(signed.body.refundNo || ''))))
    } catch (error) {
      const mapped = mapPaymentError(error)
      res.status(mapped.status).json(fail(mapped.status, mapped.message))
    }
  })

  for (const provider of ['wechat', 'mock']) {
    app.post(`/api/v1/public/payment/gateway/webhooks/${provider}`, async (req: Request, res: Response) => {
      try {
        const result = await service.handleProviderWebhook(provider, { rawBody: rawBody(req), body: bodyObject(req) })
        if (provider === 'wechat') {
          res.type('application/xml').send('<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>')
          return
        }
        res.json(ok(result))
      } catch (error) {
        const mapped = mapPaymentError(error)
        if (provider === 'wechat') {
          res.type('application/xml').status(mapped.status >= 500 ? 500 : 400).send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[FAIL]]></return_msg></xml>')
          return
        }
        res.status(mapped.status).json(fail(mapped.status, mapped.message))
      }
    })
  }
}
