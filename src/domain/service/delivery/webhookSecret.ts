import crypto from 'crypto'
import { getDerivedRuntimeSecret } from '../../../security/secretVault'

/**
 * Encryption + HMAC signing for notification webhook secrets. Extracted from
 * the former notificationDelivery.ts so both the webhook-family delivery
 * providers and the webhook management service can share it without importing
 * the delivery engine (which would create a cycle).
 */

const WEBHOOK_SECRET_CIPHER_VERSION = 'v1'
const WEBHOOK_SECRET_CONTEXT = Buffer.from('notification-webhook-secret:v1', 'utf8')
const WEBHOOK_SIGNATURE_PREFIX = 'sha256='

function toBase64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): Buffer {
  const normalized = String(input || '').trim().replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4 || 4)) % 4
  return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64')
}

function resolveWebhookSecretMasterKey(): Buffer {
  const configured = getDerivedRuntimeSecret('notification-webhook')
  if (!configured) {
    throw new Error('NODE_KEY_DERIVATION_SECRET is required in secrets.enc.json when webhook secret is used')
  }
  return Buffer.from(configured, 'utf8')
}

function deriveWebhookSecretEncryptionKey(masterKey: Buffer): Buffer {
  return crypto.createHash('sha256').update(masterKey).update(WEBHOOK_SECRET_CONTEXT).digest()
}

export function encryptNotificationWebhookSecret(secret: string): string {
  const normalized = String(secret || '').trim()
  if (!normalized) {
    return ''
  }
  const key = deriveWebhookSecretEncryptionKey(resolveWebhookSecretMasterKey())
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(normalized, 'utf8')), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${WEBHOOK_SECRET_CIPHER_VERSION}.${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(ciphertext)}`
}

export function decryptNotificationWebhookSecret(ciphertextInput: string): string {
  const ciphertext = String(ciphertextInput || '').trim()
  if (!ciphertext) {
    return ''
  }
  const [version, ivEncoded, authTagEncoded, payloadEncoded] = ciphertext.split('.')
  if (version !== WEBHOOK_SECRET_CIPHER_VERSION || !ivEncoded || !authTagEncoded || !payloadEncoded) {
    throw new Error('Stored webhook secret is invalid')
  }
  try {
    const key = deriveWebhookSecretEncryptionKey(resolveWebhookSecretMasterKey())
    const iv = fromBase64Url(ivEncoded)
    const authTag = fromBase64Url(authTagEncoded)
    const payload = fromBase64Url(payloadEncoded)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Stored webhook secret is invalid')
  }
}

export function buildNotificationWebhookSignature(timestamp: string, body: string, secret: string): string {
  const payload = `${String(timestamp || '').trim()}.${String(body || '')}`
  return `${WEBHOOK_SIGNATURE_PREFIX}${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
}
