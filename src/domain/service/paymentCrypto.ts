import crypto from 'node:crypto'
import { getDerivedRuntimeSecret } from '../../security/secretVault'

function toBase64Url(value: Buffer): string {
    return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function fromBase64Url(value: string): Buffer {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
    const padding = (4 - (normalized.length % 4 || 4)) % 4
    return Buffer.from(`${normalized}${'='.repeat(padding)}`, 'base64')
}

function paymentSecretKey(): Buffer {
    const derived = getDerivedRuntimeSecret('payment-merchant-secret')
    if (!derived) throw new Error('NODE_KEY_DERIVATION_SECRET is required when payment merchants are used')
    return Buffer.from(derived, 'utf8')
}

export function canonicalPaymentJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalPaymentJson).join(',')}]`
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalPaymentJson(record[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

export function buildMerchantPaymentSignature(input: {
    merchantId: string
    timestamp: string
    nonce: string
    body: Record<string, unknown>
    secret: string
}): string {
    const message = `${input.merchantId}.${input.timestamp}.${input.nonce}.${canonicalPaymentJson(input.body)}`
    return `sha256=${crypto.createHmac('sha256', input.secret).update(message).digest('hex')}`
}

export function encryptPaymentMerchantSecret(secretInput: string): string {
    const secret = String(secretInput || '').trim()
    if (!secret) throw new Error('PAYMENT_MERCHANT_SECRET_REQUIRED')
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', paymentSecretKey(), iv)
    cipher.setAAD(Buffer.from('yeying-node-payment-merchant:v1', 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    return `v1.${toBase64Url(iv)}.${toBase64Url(cipher.getAuthTag())}.${toBase64Url(ciphertext)}`
}

export function decryptPaymentMerchantSecret(valueInput: string): string {
    const value = String(valueInput || '').trim()
    const [version, iv, tag, ciphertext] = value.split('.')
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('PAYMENT_MERCHANT_SECRET_INVALID')
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', paymentSecretKey(), fromBase64Url(iv))
        decipher.setAAD(Buffer.from('yeying-node-payment-merchant:v1', 'utf8'))
        decipher.setAuthTag(fromBase64Url(tag))
        return Buffer.concat([decipher.update(fromBase64Url(ciphertext)), decipher.final()]).toString('utf8')
    } catch {
        throw new Error('PAYMENT_MERCHANT_SECRET_INVALID')
    }
}

export function verifyMerchantPaymentSignature(input: {
    merchantId: string
    timestamp: string
    nonce: string
    body: Record<string, unknown>
    secret: string
    signature: string
}): boolean {
    const provided = String(input.signature || '').trim().replace(/^sha256=/, '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(provided)) return false
    const expected = buildMerchantPaymentSignature(input).slice('sha256='.length)
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
}
