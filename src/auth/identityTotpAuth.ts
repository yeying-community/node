import * as crypto from 'node:crypto'
import { Repository } from 'typeorm'
import { getConfig } from '../config/runtime'
import { SingletonDataSource } from '../domain/facade/datasource'
import { IdentityAuditLogDO, IdentityTotpAuthenticatorDO } from '../domain/mapper/entity'
import { verifyIdentityController } from './identityAccountLink'
import { getDerivedRuntimeSecret } from '../security/secretVault'
import { consumeIdentityActionAuthorization, type IdentityActionAuthorization } from './identityActionAuthorization'

const SECRET_BYTES = 20
const SECRET_CIPHER_VERSION = 'v1'
const SECRET_ENCRYPTION_CONTEXT = 'identity-totp-secret:v1'
const DEFAULT_ISSUER = 'YeYing Node'
const DIGITS = 6
const PERIOD_SECONDS = 30
const WINDOW = 1
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 10

const ATTEMPTS = new Map<string, { count: number; resetAt: number }>()

export class IdentityTotpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'IdentityTotpError'
  }
}

function string(value: unknown) { return String(value || '').trim() }

function now() { return new Date().toISOString() }

function assertIdentityDid(value: unknown) {
  const did = string(value)
  if (!/^did:yeying:wid_[A-Za-z0-9_-]{22,}$/.test(did)) throw new IdentityTotpError(400, 'IDENTITY_INVALID_DID', 'Invalid wallet identity DID')
  return did
}

function repository(): Repository<IdentityTotpAuthenticatorDO> {
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new IdentityTotpError(503, 'IDENTITY_TOTP_STORAGE_NOT_READY', 'Identity TOTP storage is not ready')
  return ds.getRepository(IdentityTotpAuthenticatorDO)
}

function dataSource() {
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new IdentityTotpError(503, 'IDENTITY_TOTP_STORAGE_NOT_READY', 'Identity TOTP storage is not ready')
  return ds
}

function masterKey(): Buffer {
  const raw = getDerivedRuntimeSecret('identity-totp-storage')
  if (!raw) throw new IdentityTotpError(503, 'IDENTITY_TOTP_NOT_READY', 'NODE_KEY_DERIVATION_SECRET is required for identity TOTP')
  return Buffer.from(raw, 'hex')
}

function encryptionKey() {
  return crypto.createHash('sha256').update(masterKey()).update(SECRET_ENCRYPTION_CONTEXT).digest()
}

function toBase64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): Buffer {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + pad, 'base64')
}

function encryptSecret(secret: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()])
  return `${SECRET_CIPHER_VERSION}.${toBase64Url(iv)}.${toBase64Url(cipher.getAuthTag())}.${toBase64Url(ciphertext)}`
}

function decryptSecret(ciphertextInput: string): Buffer {
  const [version, ivEncoded, tagEncoded, dataEncoded] = string(ciphertextInput).split('.')
  if (version !== SECRET_CIPHER_VERSION || !ivEncoded || !tagEncoded || !dataEncoded) {
    throw new IdentityTotpError(500, 'IDENTITY_TOTP_SECRET_CORRUPTED', 'Stored identity TOTP secret is invalid')
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), fromBase64Url(ivEncoded))
    decipher.setAuthTag(fromBase64Url(tagEncoded))
    return Buffer.concat([decipher.update(fromBase64Url(dataEncoded)), decipher.final()])
  } catch {
    throw new IdentityTotpError(500, 'IDENTITY_TOTP_SECRET_CORRUPTED', 'Stored identity TOTP secret is invalid')
  }
}

function base32Encode(input: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31]
  return output
}

function buildTotpUri(input: { issuer: string; accountName: string; secret: string }) {
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS)
  })
  return `otpauth://totp/${encodeURIComponent(`${input.issuer}:${input.accountName}`)}?${params.toString()}`
}

function generateCode(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000) >>> 0, 0)
  counterBuffer.writeUInt32BE((counter % 0x100000000) >>> 0, 4)
  const hmac = crypto.createHmac('sha1', secret).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return String(binary % (10 ** DIGITS)).padStart(DIGITS, '0')
}

function codeEquals(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
}

function verifyCode(secret: Buffer, input: unknown, nowMs = Date.now()) {
  const code = string(input).replace(/[^0-9]/g, '')
  if (code.length !== DIGITS) return false
  const counter = Math.floor(nowMs / (PERIOD_SECONDS * 1000))
  for (let offset = -WINDOW; offset <= WINDOW; offset += 1) {
    if (codeEquals(generateCode(secret, counter + offset), code)) return true
  }
  return false
}

function consumeAttempt(key: string) {
  const nowMs = Date.now()
  const current = ATTEMPTS.get(key)
  if (!current || current.resetAt <= nowMs) {
    ATTEMPTS.set(key, { count: 1, resetAt: nowMs + ATTEMPT_WINDOW_MS })
    return
  }
  current.count += 1
  if (current.count > MAX_ATTEMPTS) {
    throw new IdentityTotpError(429, 'IDENTITY_TOTP_ATTEMPTS_EXCEEDED', 'Too many identity TOTP attempts')
  }
}

function clearAttempts(key: string) {
  ATTEMPTS.delete(key)
}

function issuerName() {
  return string(getConfig<string>('identity.totp.issuerName')) || string(getConfig<string>('identity.webauthn.rpName')) || DEFAULT_ISSUER
}

function publicRecord(row: IdentityTotpAuthenticatorDO | null) {
  return {
    enabled: Boolean(row && row.status === 'active' && !string(row.revokedAt)),
    status: row?.status || 'none',
    deviceName: row?.deviceName || '',
    createdAt: row?.createdAt || '',
    confirmedAt: row?.confirmedAt || '',
    lastUsedAt: row?.lastUsedAt || '',
    revokedAt: row?.revokedAt || ''
  }
}

async function auditIdentityTotp(input: {
  identityDid: string
  action: string
  outcome?: 'success' | 'failure'
  metadata?: Record<string, unknown>
  createdAt?: string
}) {
  const log = new IdentityAuditLogDO()
  Object.assign(log, {
    identityDid: input.identityDid,
    action: input.action,
    outcome: input.outcome || 'success',
    metadataJson: JSON.stringify(input.metadata || {}),
    createdAt: input.createdAt || now()
  })
  await dataSource().getRepository(IdentityAuditLogDO).save(log)
}

export function getIdentityTotpStatus() {
  try {
    masterKey()
    return { enabled: true, ready: true, issuerName: issuerName(), digits: DIGITS, period: PERIOD_SECONDS, algorithm: 'SHA1' as const }
  } catch (error) {
    return { enabled: true, ready: false, issuerName: issuerName(), digits: DIGITS, period: PERIOD_SECONDS, algorithm: 'SHA1' as const, error: error instanceof Error ? error.message : 'Identity TOTP is not ready' }
  }
}

function assertIdentityTotpReady() {
  const status = getIdentityTotpStatus()
  if (!status.ready) throw new IdentityTotpError(503, 'IDENTITY_TOTP_NOT_READY', status.error || 'Identity TOTP is not ready')
  return status
}

export class IdentityTotpService {
  async get(input: { identity: unknown }) {
    assertIdentityTotpReady()
    const identityDid = assertIdentityDid(input.identity)
    const row = await repository().findOneBy({ identityDid })
    return { identity: identityDid, totp: publicRecord(row) }
  }

  async setup(input: { identity: unknown; identityDocument: unknown; deviceName?: unknown; audience: unknown; authorization: IdentityActionAuthorization }) {
    assertIdentityTotpReady()
    const identityDid = assertIdentityDid(input.identity)
    const deviceName = string(input.deviceName) || 'Authenticator app'
    await consumeIdentityActionAuthorization({ identity: identityDid, identityDocument: input.identityDocument, action: 'identity.totp.setup', audience: input.audience, payload: { deviceName }, authorization: input.authorization })
    const repo = repository()
    const existing = await repo.findOneBy({ identityDid })
    const createdAt = now()
    const row = existing || new IdentityTotpAuthenticatorDO()
    Object.assign(row, {
      identityDid,
      secretCiphertext: encryptSecret(crypto.randomBytes(SECRET_BYTES)),
      status: 'pending',
      deviceName,
      createdAt: existing?.createdAt || createdAt,
      updatedAt: createdAt,
      confirmedAt: '',
      lastUsedAt: '',
      revokedAt: ''
    })
    await repo.save(row)
    await auditIdentityTotp({
      identityDid,
      action: 'identity_totp_setup_created',
      metadata: { deviceName: row.deviceName, replaced: Boolean(existing) },
      createdAt
    })
    const secret = base32Encode(decryptSecret(row.secretCiphertext))
    return {
      identity: identityDid,
      totp: {
        issuer: issuerName(),
        accountName: identityDid,
        secret,
        algorithm: 'SHA1' as const,
        digits: DIGITS,
        period: PERIOD_SECONDS,
        otpauthUri: buildTotpUri({ issuer: issuerName(), accountName: identityDid, secret })
      }
    }
  }

  async confirm(input: { identity: unknown; code: unknown }) {
    assertIdentityTotpReady()
    const identityDid = assertIdentityDid(input.identity)
    const repo = repository()
    const row = await repo.findOneBy({ identityDid })
    if (!row || row.status !== 'pending' || string(row.revokedAt)) throw new IdentityTotpError(404, 'IDENTITY_TOTP_SETUP_NOT_FOUND', 'Identity TOTP setup is not pending')
    consumeAttempt(`confirm:${identityDid}`)
    if (!verifyCode(decryptSecret(row.secretCiphertext), input.code)) {
      await auditIdentityTotp({
        identityDid,
        action: 'identity_totp_confirm_failed',
        outcome: 'failure',
        metadata: { reason: 'code_invalid' }
      })
      throw new IdentityTotpError(401, 'IDENTITY_TOTP_CODE_INVALID', 'Invalid identity TOTP code')
    }
    clearAttempts(`confirm:${identityDid}`)
    const confirmedAt = now()
    row.status = 'active'
    row.updatedAt = confirmedAt
    row.confirmedAt = confirmedAt
    await repo.save(row)
    await auditIdentityTotp({
      identityDid,
      action: 'identity_totp_confirmed',
      metadata: { deviceName: row.deviceName },
      createdAt: confirmedAt
    })
    return { identity: identityDid, totp: publicRecord(row) }
  }

  async verify(input: { identity: unknown; code: unknown }) {
    assertIdentityTotpReady()
    const identityDid = assertIdentityDid(input.identity)
    const repo = repository()
    const row = await repo.findOneBy({ identityDid })
    if (!row || row.status !== 'active' || string(row.revokedAt)) throw new IdentityTotpError(404, 'IDENTITY_TOTP_NOT_ENABLED', 'Identity TOTP authenticator is not enabled')
    consumeAttempt(`verify:${identityDid}`)
    if (!verifyCode(decryptSecret(row.secretCiphertext), input.code)) {
      await auditIdentityTotp({
        identityDid,
        action: 'identity_totp_verify_failed',
        outcome: 'failure',
        metadata: { reason: 'code_invalid' }
      })
      throw new IdentityTotpError(401, 'IDENTITY_TOTP_CODE_INVALID', 'Invalid identity TOTP code')
    }
    clearAttempts(`verify:${identityDid}`)
    row.lastUsedAt = now()
    row.updatedAt = row.lastUsedAt
    await repo.save(row)
    await auditIdentityTotp({
      identityDid,
      action: 'identity_totp_verified',
      metadata: { deviceName: row.deviceName },
      createdAt: row.lastUsedAt
    })
    return { identity: identityDid, verified: true, verifiedAt: row.lastUsedAt }
  }

  async revoke(input: { identity: unknown; identityDocument: unknown; audience: unknown; authorization: IdentityActionAuthorization }) {
    assertIdentityTotpReady()
    const identityDid = assertIdentityDid(input.identity)
    await consumeIdentityActionAuthorization({ identity: identityDid, identityDocument: input.identityDocument, action: 'identity.totp.revoke', audience: input.audience, payload: {}, authorization: input.authorization })
    const repo = repository()
    const row = await repo.findOneBy({ identityDid })
    if (!row) {
      await auditIdentityTotp({
        identityDid,
        action: 'identity_totp_revoked',
        metadata: { existed: false }
      })
      return { identity: identityDid, totp: publicRecord(null) }
    }
    const revokedAt = now()
    const previousStatus = row.status
    row.status = 'revoked'
    row.updatedAt = revokedAt
    row.revokedAt = revokedAt
    await repo.save(row)
    await auditIdentityTotp({
      identityDid,
      action: 'identity_totp_revoked',
      metadata: { existed: true, previousStatus, deviceName: row.deviceName },
      createdAt: revokedAt
    })
    return { identity: identityDid, totp: publicRecord(row) }
  }
}
