import { apiUrl } from '@/plugins/api'
import { getAuthToken } from '@/plugins/auth'

export type PaymentMerchant = {
  merchantId: string
  name: string
  callbackUrl: string
  secretMasked: string
  status: 'active' | 'disabled' | string
  createdAt: string
  updatedAt: string
  secret?: string
}

export type PaymentTransaction = {
  tradeNo: string
  merchantId: string
  externalOrderId: string
  amountMinor: string
  currency: string
  status: string
  provider: string
  paymentUrl: string
  expiresAt: string
  paidAt: string
}

export type PaymentRefund = {
  refundNo: string
  tradeNo: string
  amountMinor: string
  status: string
  providerRefundId: string
  createdAt: string
  updatedAt: string
}

type Envelope<T> = {
  code?: number
  message?: string
  data?: T
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function randomNonce(): string {
  const bytes = new Uint8Array(18)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function parseEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text()
  let payload: Envelope<T> | null = null
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>
    } catch {
      throw new Error(`${fallbackMessage}: ${text}`)
    }
  }
  if (!response.ok || payload?.code !== 0) {
    throw new Error(payload?.message || `${fallbackMessage}: ${response.status}`)
  }
  return payload?.data as T
}

async function bearerHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAuthToken()}` }
}

export async function listPaymentMerchants(): Promise<PaymentMerchant[]> {
  const response = await fetch(apiUrl('/api/v1/public/payment/gateway/merchants'), {
    headers: await bearerHeaders(),
  })
  return await parseEnvelope<PaymentMerchant[]>(response, '加载支付商户失败')
}

export async function createPaymentMerchant(input: { name: string; callbackUrl: string }): Promise<PaymentMerchant> {
  const response = await fetch(apiUrl('/api/v1/public/payment/gateway/merchants'), {
    method: 'POST',
    headers: { ...(await bearerHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return await parseEnvelope<PaymentMerchant>(response, '创建支付商户失败')
}

export async function disablePaymentMerchant(merchantId: string): Promise<PaymentMerchant> {
  const response = await fetch(apiUrl(`/api/v1/public/payment/gateway/merchants/${encodeURIComponent(merchantId)}`), {
    method: 'DELETE',
    headers: await bearerHeaders(),
  })
  return await parseEnvelope<PaymentMerchant>(response, '停用支付商户失败')
}

async function signedRequest<T>(input: {
  merchantId: string
  secret: string
  path: string
  body: Record<string, unknown>
}): Promise<T> {
  const timestamp = String(Date.now())
  const nonce = randomNonce()
  const message = `${input.merchantId}.${timestamp}.${nonce}.${canonicalJson(input.body)}`
  const signature = await hmacSha256(input.secret, message)
  const response = await fetch(apiUrl(input.path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Payment-Merchant': input.merchantId,
      'X-Payment-Timestamp': timestamp,
      'X-Payment-Nonce': nonce,
      'X-Payment-Signature': `sha256=${signature}`,
    },
    body: JSON.stringify(input.body),
  })
  return await parseEnvelope<T>(response, '支付请求失败')
}

export async function createPaymentTransaction(input: {
  merchantId: string
  secret: string
  externalOrderId: string
  amountMinor: string
  description: string
  clientType: 'native' | 'h5'
  returnUrl?: string
  idempotencyKey: string
}): Promise<PaymentTransaction> {
  return await signedRequest<PaymentTransaction>({
    merchantId: input.merchantId,
    secret: input.secret,
    path: '/api/v1/public/payment/gateway/transactions',
    body: {
      externalOrderId: input.externalOrderId,
      amountMinor: input.amountMinor,
      currency: 'CNY',
      description: input.description,
      clientType: input.clientType,
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      idempotencyKey: input.idempotencyKey,
    },
  })
}

export async function queryPaymentTransaction(input: {
  merchantId: string
  secret: string
  tradeNo: string
}): Promise<PaymentTransaction> {
  return await signedRequest<PaymentTransaction>({
    merchantId: input.merchantId,
    secret: input.secret,
    path: '/api/v1/public/payment/gateway/transactions/query',
    body: { tradeNo: input.tradeNo },
  })
}

export async function cancelPaymentTransaction(input: {
  merchantId: string
  secret: string
  tradeNo: string
}): Promise<PaymentTransaction> {
  return await signedRequest<PaymentTransaction>({
    merchantId: input.merchantId,
    secret: input.secret,
    path: '/api/v1/public/payment/gateway/transactions/cancel',
    body: { tradeNo: input.tradeNo },
  })
}

export async function createPaymentRefund(input: {
  merchantId: string
  secret: string
  tradeNo: string
  amountMinor: string
  reason: string
  idempotencyKey: string
}): Promise<PaymentRefund> {
  return await signedRequest<PaymentRefund>({
    merchantId: input.merchantId,
    secret: input.secret,
    path: '/api/v1/public/payment/gateway/refunds',
    body: {
      tradeNo: input.tradeNo,
      amountMinor: input.amountMinor,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    },
  })
}

export async function queryPaymentRefund(input: {
  merchantId: string
  secret: string
  refundNo: string
}): Promise<PaymentRefund> {
  return await signedRequest<PaymentRefund>({
    merchantId: input.merchantId,
    secret: input.secret,
    path: '/api/v1/public/payment/gateway/refunds/query',
    body: { refundNo: input.refundNo },
  })
}
