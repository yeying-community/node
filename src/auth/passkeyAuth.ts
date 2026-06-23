import crypto from 'crypto'
import { Repository } from 'typeorm'
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { getConfig } from '../config/runtime'
import { SingletonDataSource } from '../domain/facade/datasource'
import { PasskeySubjectCredentialDO } from '../domain/mapper/entity'
import { getCurrentUtcString } from '../common/date'

export type PasskeyAuthStatus = {
  enabled: boolean
  ready: boolean
  rpId: string
  rpName: string
  origin: string
  timeoutMs: number
  challengeTtlMs: number
  error?: string
}

export type PasskeyRegisterRequestOptions = {
  subject: string
  deviceName?: string
}

export type PasskeyRegisterRequestResult = {
  requestId: string
  challenge: string
  rp: {
    id: string
    name: string
  }
  user: {
    id: string
    name: string
    displayName: string
  }
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
  timeout: number
  attestation: 'none'
  excludeCredentials: Array<{
    id: string
    type: 'public-key'
    transports?: string[]
  }>
  authenticatorSelection?: {
    residentKey?: 'discouraged' | 'preferred' | 'required'
    userVerification?: 'discouraged' | 'preferred' | 'required'
    authenticatorAttachment?: 'platform' | 'cross-platform'
  }
}

export type PasskeyRegisterConfirmInput = {
  subject: string
  requestId: string
  deviceName?: string
  credential: {
    id: string
    rawId: string
    type: 'public-key'
    response: {
      attestationObject: string
      clientDataJSON: string
      transports?: string[]
    }
    clientExtensionResults?: Record<string, unknown>
  }
}

export type PasskeyCredentialRecord = {
  credentialId: string
  subject: string
  deviceName?: string
  transports?: string[]
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
}

export type PasskeyAuthorizeRequestResult = {
  requestId: string
  challenge: string
  timeout: number
  rpId: string
  allowCredentials: Array<{
    id: string
    type: 'public-key'
    transports?: string[]
  }>
  userVerification?: 'discouraged' | 'preferred' | 'required'
}

export type PasskeyAuthorizeConfirmInput = {
  subject: string
  requestId: string
  credential: {
    id: string
    rawId: string
    type: 'public-key'
    response: {
      authenticatorData: string
      clientDataJSON: string
      signature: string
      userHandle?: string
    }
    clientExtensionResults?: Record<string, unknown>
  }
}

export class PasskeyAuthError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'PasskeyAuthError'
  }
}

type PasskeyRegisterChallengeRecord = {
  requestId: string
  challenge: string
  subject: string
  deviceName?: string
  expiresAt: number
}

type PasskeyAuthorizeChallengeRecord = {
  requestId: string
  challenge: string
  subject: string
  allowCredentialIds: string[]
  expiresAt: number
}

const DEFAULT_TIMEOUT_MS = 60 * 1000
const DEFAULT_CHALLENGE_TTL_MS = 2 * 60 * 1000
const REGISTER_CHALLENGES = new Map<string, PasskeyRegisterChallengeRecord>()
const AUTHORIZE_CHALLENGES = new Map<string, PasskeyAuthorizeChallengeRecord>()

function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeSubject(input: unknown): string {
  const value = String(input || '').trim()
  if (!value) return ''
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase()
  }
  return value
}

function normalizeRequestId(input: unknown): string {
  return String(input || '').trim()
}

function assertWalletAddress(input: unknown): string {
  const subject = normalizeSubject(input)
  if (!/^0x[0-9a-f]{40}$/.test(subject)) {
    throw new PasskeyAuthError(400, 'PASSKEY_SUBJECT_INVALID', 'Invalid wallet address')
  }
  return subject
}

function randomId(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex')
}

function gcChallenges(nowMs = Date.now()): void {
  for (const [key, record] of REGISTER_CHALLENGES.entries()) {
    if (record.expiresAt <= nowMs) {
      REGISTER_CHALLENGES.delete(key)
    }
  }
  for (const [key, record] of AUTHORIZE_CHALLENGES.entries()) {
    if (record.expiresAt <= nowMs) {
      AUTHORIZE_CHALLENGES.delete(key)
    }
  }
}

function parseTransports(raw: string): string[] {
  const value = String(raw || '').trim()
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function getCredentialRepo(): Repository<PasskeySubjectCredentialDO> {
  return SingletonDataSource.get().getRepository(PasskeySubjectCredentialDO)
}

export function getPasskeyAuthStatus(): PasskeyAuthStatus {
  const enabled = parseBoolean(getConfig<boolean>('passkeyAuth.enabled'), false)
  const rpId = String(getConfig<string>('passkeyAuth.rpId') || '').trim()
  const rpName = String(getConfig<string>('passkeyAuth.rpName') || 'YeYing Node').trim()
  const origin = String(getConfig<string>('passkeyAuth.origin') || '').trim()
  const timeoutMs = parsePositiveNumber(getConfig<number>('passkeyAuth.timeoutMs'), DEFAULT_TIMEOUT_MS)
  const challengeTtlMs = parsePositiveNumber(
    getConfig<number>('passkeyAuth.challengeTtlMs'),
    DEFAULT_CHALLENGE_TTL_MS
  )

  const ready = !enabled || Boolean(rpId && rpName && origin)

  return {
    enabled,
    ready,
    rpId,
    rpName,
    origin,
    timeoutMs,
    challengeTtlMs,
    error: ready ? '' : 'PASSKEY_AUTH_RUNTIME_NOT_READY',
  }
}

export function assertPasskeyAuthReady(): PasskeyAuthStatus {
  const status = getPasskeyAuthStatus()
  if (!status.enabled) {
    throw new PasskeyAuthError(403, 'PASSKEY_AUTH_DISABLED', 'Passkey auth is disabled')
  }
  if (!status.ready) {
    throw new PasskeyAuthError(
      503,
      'PASSKEY_AUTH_RUNTIME_NOT_READY',
      status.error || 'Passkey auth runtime not ready'
    )
  }
  return status
}

export async function createPasskeyRegisterRequest(
  input: PasskeyRegisterRequestOptions
): Promise<PasskeyRegisterRequestResult> {
  const status = assertPasskeyAuthReady()
  const subject = assertWalletAddress(input.subject)
  gcChallenges()

  const repo = getCredentialRepo()
  const existing = await repo.find({
    where: {
      subjectType: 'wallet_address',
      subjectId: subject,
    },
  })

  const generated = await generateRegistrationOptions({
    rpID: status.rpId,
    rpName: status.rpName,
    userName: subject,
    userDisplayName: subject,
    userID: Buffer.from(subject, 'utf8'),
    timeout: status.timeoutMs,
    attestationType: 'none',
    excludeCredentials: existing
      .filter((item) => !String(item.revokedAt || '').trim())
      .map((item) => ({
        id: item.credentialId,
        transports: parseTransports(item.transports),
      })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  } as any)

  const requestId = randomId(16)
  REGISTER_CHALLENGES.set(requestId, {
    requestId,
    challenge: String((generated as { challenge: string }).challenge || ''),
    subject,
    deviceName: String(input.deviceName || '').trim() || '',
    expiresAt: Date.now() + status.challengeTtlMs,
  })

  const generatedAny = generated as {
    challenge: string
    rp: { id: string; name: string }
    user: { name: string; displayName: string }
    pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
    timeout?: number
    excludeCredentials?: Array<{ id: string; type: 'public-key'; transports?: string[] }>
    authenticatorSelection?: PasskeyRegisterRequestResult['authenticatorSelection']
  }

  return {
    requestId,
    challenge: generatedAny.challenge,
    rp: generatedAny.rp,
    user: {
      id: Buffer.from(subject, 'utf8').toString('base64url'),
      name: generatedAny.user.name,
      displayName: generatedAny.user.displayName,
    },
    pubKeyCredParams: generatedAny.pubKeyCredParams || [],
    timeout: generatedAny.timeout || status.timeoutMs,
    attestation: 'none',
    excludeCredentials: (generatedAny.excludeCredentials || []).map((item) => ({
      id: String(item.id),
      type: 'public-key',
      transports: item.transports,
    })),
    authenticatorSelection: generatedAny.authenticatorSelection,
  }
}

export async function confirmPasskeyRegistration(
  input: PasskeyRegisterConfirmInput
): Promise<PasskeyCredentialRecord> {
  const status = assertPasskeyAuthReady()
  const subject = assertWalletAddress(input.subject)
  const requestId = normalizeRequestId(input.requestId)
  if (!requestId) {
    throw new PasskeyAuthError(400, 'PASSKEY_REGISTER_REQUEST_ID_REQUIRED', 'Missing requestId')
  }

  gcChallenges()
  const request = REGISTER_CHALLENGES.get(requestId)
  if (!request) {
    throw new PasskeyAuthError(
      410,
      'PASSKEY_REGISTER_CHALLENGE_EXPIRED',
      'Passkey register challenge expired'
    )
  }
  if (request.subject !== subject) {
    throw new PasskeyAuthError(
      403,
      'PASSKEY_REGISTER_SUBJECT_MISMATCH',
      'Passkey register subject mismatch'
    )
  }

  const verification = await verifyRegistrationResponse({
    response: input.credential as any,
    expectedChallenge: request.challenge,
    expectedOrigin: status.origin,
    expectedRPID: status.rpId,
  })

  const verificationAny = verification as {
    verified?: boolean
    registrationInfo?: {
      credential?: {
        id?: Uint8Array
        publicKey?: Uint8Array
        counter?: number
        transports?: string[]
      }
      credentialID?: Uint8Array
      credentialPublicKey?: Uint8Array
      counter?: number
      aaguid?: string
    }
  }

  if (!verificationAny.verified || !verificationAny.registrationInfo) {
    throw new PasskeyAuthError(400, 'PASSKEY_REGISTER_VERIFY_FAILED', 'Passkey register verify failed')
  }

  const info = verificationAny.registrationInfo
  const rawCredentialId =
    info.credential?.id ||
    info.credentialID
  const rawPublicKey =
    info.credential?.publicKey ||
    info.credentialPublicKey

  if (!rawCredentialId || !rawPublicKey) {
    throw new PasskeyAuthError(
      400,
      'PASSKEY_REGISTER_RESULT_INVALID',
      'Passkey register result is invalid'
    )
  }

  const credentialId = Buffer.from(rawCredentialId).toString('base64url')
  const publicKey = Buffer.from(rawPublicKey).toString('base64url')

  const repo = getCredentialRepo()
  const existed = await repo.findOne({ where: { credentialId } })
  if (existed && !String(existed.revokedAt || '').trim()) {
    throw new PasskeyAuthError(409, 'PASSKEY_DUPLICATE_CREDENTIAL', 'Passkey credential already exists')
  }

  const createdAt = getCurrentUtcString()
  const deviceName =
    String(input.deviceName || '').trim() ||
    String(request.deviceName || '').trim() ||
    'passkey-device'

  const entity = repo.create({
    subjectType: 'wallet_address',
    subjectId: subject,
    credentialId,
    publicKey,
    signCount: String(info.credential?.counter || info.counter || 0),
    aaguid: String(info.aaguid || ''),
    transports: JSON.stringify(info.credential?.transports || []),
    deviceName,
    rpId: status.rpId,
    userHandle: '',
    createdAt,
    lastUsedAt: '',
    revokedAt: '',
  })

  await repo.save(entity)
  REGISTER_CHALLENGES.delete(requestId)

  return {
    credentialId: entity.credentialId,
    subject,
    deviceName: entity.deviceName || '',
    transports: parseTransports(entity.transports),
    createdAt: entity.createdAt,
    lastUsedAt: entity.lastUsedAt || '',
    revokedAt: entity.revokedAt || '',
  }
}

export async function createPasskeyAuthorizeRequest(
  subjectInput: string
): Promise<PasskeyAuthorizeRequestResult> {
  const status = assertPasskeyAuthReady()
  const subject = assertWalletAddress(subjectInput)
  gcChallenges()

  const repo = getCredentialRepo()
  const credentials = await repo.find({
    where: {
      subjectType: 'wallet_address',
      subjectId: subject,
    },
    order: {
      createdAt: 'DESC',
    },
  })
  const activeCredentials = credentials.filter((item) => !String(item.revokedAt || '').trim())
  if (activeCredentials.length === 0) {
    throw new PasskeyAuthError(
      403,
      'PASSKEY_AUTH_NOT_ENROLLED',
      'Passkey is not configured for this address'
    )
  }

  const generated = await generateAuthenticationOptions({
    rpID: status.rpId,
    timeout: status.timeoutMs,
    allowCredentials: activeCredentials.map((item) => ({
      id: item.credentialId,
      transports: parseTransports(item.transports),
    })),
    userVerification: 'preferred',
  } as any)

  const requestId = randomId(16)
  AUTHORIZE_CHALLENGES.set(requestId, {
    requestId,
    challenge: String((generated as { challenge?: string }).challenge || ''),
    subject,
    allowCredentialIds: activeCredentials.map((item) => item.credentialId),
    expiresAt: Date.now() + status.challengeTtlMs,
  })

  const generatedAny = generated as {
    challenge: string
    timeout?: number
    rpId?: string
    allowCredentials?: Array<{ id: string; type?: 'public-key'; transports?: string[] }>
    userVerification?: 'discouraged' | 'preferred' | 'required'
  }

  return {
    requestId,
    challenge: generatedAny.challenge,
    timeout: generatedAny.timeout || status.timeoutMs,
    rpId: generatedAny.rpId || status.rpId,
    allowCredentials: (generatedAny.allowCredentials || []).map((item) => ({
      id: String(item.id || ''),
      type: 'public-key',
      transports: item.transports,
    })),
    userVerification: generatedAny.userVerification || 'preferred',
  }
}

export async function confirmPasskeyAuthorize(
  input: PasskeyAuthorizeConfirmInput
): Promise<{ subject: string; credentialId: string }> {
  const status = assertPasskeyAuthReady()
  const subject = assertWalletAddress(input.subject)
  const requestId = normalizeRequestId(input.requestId)
  if (!requestId) {
    throw new PasskeyAuthError(400, 'PASSKEY_AUTHORIZE_REQUEST_ID_REQUIRED', 'Missing requestId')
  }

  gcChallenges()
  const request = AUTHORIZE_CHALLENGES.get(requestId)
  if (!request) {
    throw new PasskeyAuthError(
      410,
      'PASSKEY_AUTHORIZE_CHALLENGE_EXPIRED',
      'Passkey authorize challenge expired'
    )
  }
  if (request.subject !== subject) {
    throw new PasskeyAuthError(
      403,
      'PASSKEY_AUTHORIZE_SUBJECT_MISMATCH',
      'Passkey authorize subject mismatch'
    )
  }

  const credentialId = String(input.credential?.id || '').trim()
  if (!credentialId) {
    throw new PasskeyAuthError(400, 'PASSKEY_CREDENTIAL_ID_REQUIRED', 'Missing credentialId')
  }

  const repo = getCredentialRepo()
  const record = await repo.findOne({
    where: {
      subjectType: 'wallet_address',
      subjectId: subject,
      credentialId,
    },
  })
  if (!record || String(record.revokedAt || '').trim()) {
    throw new PasskeyAuthError(404, 'PASSKEY_CREDENTIAL_NOT_FOUND', 'Passkey credential not found')
  }
  if (!request.allowCredentialIds.includes(record.credentialId)) {
    throw new PasskeyAuthError(
      403,
      'PASSKEY_CREDENTIAL_NOT_ALLOWED',
      'Passkey credential is not allowed for this request'
    )
  }

  const verification = await verifyAuthenticationResponse({
    response: input.credential as any,
    expectedChallenge: request.challenge,
    expectedOrigin: status.origin,
    expectedRPID: status.rpId,
    credential: {
      id: record.credentialId,
      publicKey: Buffer.from(record.publicKey, 'base64url'),
      counter: Number(record.signCount || 0),
      transports: parseTransports(record.transports),
    } as any,
  } as any)

  const verificationAny = verification as {
    verified?: boolean
    authenticationInfo?: {
      newCounter?: number
    }
  }
  if (!verificationAny.verified) {
    throw new PasskeyAuthError(
      401,
      'PASSKEY_AUTHORIZE_VERIFY_FAILED',
      'Passkey authorize verify failed'
    )
  }

  record.signCount = String(verificationAny.authenticationInfo?.newCounter || record.signCount || 0)
  record.lastUsedAt = getCurrentUtcString()
  await repo.save(record)
  AUTHORIZE_CHALLENGES.delete(requestId)

  return {
    subject,
    credentialId: record.credentialId,
  }
}

export async function listPasskeyCredentials(subjectInput: string): Promise<PasskeyCredentialRecord[]> {
  const subject = assertWalletAddress(subjectInput)
  const repo = getCredentialRepo()
  const items = await repo.find({
    where: {
      subjectType: 'wallet_address',
      subjectId: subject,
    },
    order: {
      createdAt: 'DESC',
    },
  })

  return items.map((item) => ({
    credentialId: item.credentialId,
    subject,
    deviceName: item.deviceName || '',
    transports: parseTransports(item.transports),
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt || '',
    revokedAt: item.revokedAt || '',
  }))
}

export async function revokePasskeyCredential(subjectInput: string, credentialIdInput: string): Promise<void> {
  const subject = assertWalletAddress(subjectInput)
  const credentialId = String(credentialIdInput || '').trim()
  if (!credentialId) {
    throw new PasskeyAuthError(400, 'PASSKEY_CREDENTIAL_ID_REQUIRED', 'Missing credentialId')
  }

  const repo = getCredentialRepo()
  const record = await repo.findOne({
    where: {
      subjectType: 'wallet_address',
      subjectId: subject,
      credentialId,
    },
  })

  if (!record) {
    throw new PasskeyAuthError(404, 'PASSKEY_CREDENTIAL_NOT_FOUND', 'Passkey credential not found')
  }
  if (String(record.revokedAt || '').trim()) {
    return
  }

  record.revokedAt = getCurrentUtcString()
  await repo.save(record)
}
