import crypto from 'crypto'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { PassportManager } from '../manager/passport'
import {
  PassportAuditLogDO,
  PassportAuthorizationCodeDO,
  PassportAuthorizationRequestDO,
  PassportPasskeyCredentialDO,
  PassportSubjectDO,
  PassportWebauthnChallengeDO,
  PassportWalletBindingDO,
} from '../mapper/entity'
import { ApplicationService } from './application'
import { getCurrentUtcString } from '../../common/date'
import { assertPasskeyAuthReady, getPasskeyAuthStatus } from '../../auth/passportPasskeyAuth'
import { getConfig } from '../../config/runtime'

export type PassportStatus = {
  enabled: true
  passkey: ReturnType<typeof getPasskeyAuthStatus>
  pkce: {
    required: true
    methods: ['S256']
  }
  subjectModel: 'passport_subject'
}

export type PassportAuthorizationRequestView = {
  requestId: string
  status: string
  appId: string
  appName: string
  redirectUri: string
  state: string
  codeChallengeMethod: string
  createdAt: string
  expiresAt: string
  verifyUrl: string
  subjectId?: string
  subjectHint?: string
}

export type PassportAuthorizationApproveResult = {
  requestId: string
  subjectId: string
  walletAddress: string
  authorizationCode: string
  authorizationCodeExpiresAt: string
  redirectTo: string
}

export type PassportAuthorizationExchangeResult = {
  requestId: string
  subjectId: string
  walletAddress: string
  appId: string
  redirectUri: string
  state: string
  issuedAt: string
}

export class PassportError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PassportError'
    this.status = status
    this.code = code
  }
}

const DEFAULT_REQUEST_TTL_MS = 2 * 60 * 1000
const MIN_REQUEST_TTL_MS = 30 * 1000
const MAX_REQUEST_TTL_MS = 30 * 60 * 1000
const DEFAULT_CODE_TTL_MS = 60 * 1000
const MIN_CODE_TTL_MS = 10 * 1000
const MAX_CODE_TTL_MS = 5 * 60 * 1000
const DEFAULT_VERIFY_PATH = '/passport-auth'
const PKCE_REGEX = /^[A-Za-z0-9._~-]{43,128}$/

function normalizeAddress(input: unknown): string {
  const value = String(input || '').trim()
  if (!value) return ''
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase()
  return value
}

function requireWalletAddress(input: unknown): string {
  const address = normalizeAddress(input)
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new PassportError(400, 'PASSPORT_WALLET_ADDRESS_INVALID', 'Invalid wallet address')
  }
  return address
}

function normalizeString(input: unknown): string {
  return String(input || '').trim()
}

function clampTtlMs(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

function generateId(prefix: string): string {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex')
  return `${prefix}_${id}${crypto.randomBytes(6).toString('hex')}`
}

function generateAuthorizationCode(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function parseTime(value: string): number {
  const parsed = Date.parse(String(value || '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

function normalizeRedirectUri(input: unknown): string {
  const raw = normalizeString(input)
  if (!raw) {
    throw new PassportError(400, 'PASSPORT_REDIRECT_URI_REQUIRED', 'Missing redirectUri')
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new PassportError(400, 'PASSPORT_REDIRECT_URI_INVALID', 'Invalid redirectUri')
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol === 'javascript:' || protocol === 'data:') {
    throw new PassportError(400, 'PASSPORT_REDIRECT_URI_INVALID', 'Invalid redirectUri')
  }
  parsed.hash = ''
  return parsed.toString()
}

function parseRedirectUris(raw: unknown): string[] {
  const values: string[] = []
  const push = (value: unknown) => {
    const text = String(value || '').trim()
    if (text) values.push(text)
  }
  if (Array.isArray(raw)) {
    raw.forEach(push)
  } else {
    const text = String(raw || '').trim()
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) parsed.forEach(push)
      } catch {
        // fall through to split mode
      }
    }
    if (values.length === 0 && text) {
      text.split(/[\n,]/).forEach(push)
    }
  }
  return Array.from(new Set(values.map((item) => normalizeRedirectUri(item))))
}

function validateCodeChallenge(input: unknown): string {
  const challenge = normalizeString(input)
  if (!PKCE_REGEX.test(challenge)) {
    throw new PassportError(400, 'PASSPORT_PKCE_CHALLENGE_INVALID', 'Invalid codeChallenge')
  }
  return challenge
}

function validateCodeChallengeMethod(input: unknown): 'S256' {
  const method = normalizeString(input || 'S256').toUpperCase()
  if (method !== 'S256') {
    throw new PassportError(400, 'PASSPORT_PKCE_METHOD_UNSUPPORTED', 'Only S256 PKCE is supported')
  }
  return 'S256'
}

function verifyPkce(verifierInput: unknown, challenge: string): void {
  const verifier = normalizeString(verifierInput)
  if (!PKCE_REGEX.test(verifier)) {
    throw new PassportError(400, 'PASSPORT_PKCE_VERIFIER_INVALID', 'Invalid codeVerifier')
  }
  const actual = crypto.createHash('sha256').update(verifier).digest('base64url')
  if (actual !== challenge) {
    throw new PassportError(403, 'PASSPORT_PKCE_VERIFIER_MISMATCH', 'Invalid codeVerifier')
  }
}

function appendQuery(baseUrl: string, query: Record<string, string>): string {
  const parsed = new URL(baseUrl)
  Object.entries(query).forEach(([key, value]) => {
    if (value) parsed.searchParams.set(key, value)
  })
  return parsed.toString()
}

function normalizeVerifyPath(input: unknown): string {
  const value = normalizeString(input || DEFAULT_VERIFY_PATH)
  if (!value) return DEFAULT_VERIFY_PATH
  return value.startsWith('/') ? value : `/${value}`
}

function getPortalBaseUrl(): string {
  return normalizeString(
    process.env.PASSPORT_AUTH_PORTAL_BASE_URL ||
      getConfig<string>('passportAuth.portalBaseUrl') ||
      getConfig<string>('totpAuth.portalBaseUrl') ||
      `http://127.0.0.1:${getConfig<number>('app.port') || 8100}`
  ).replace(/\/+$/, '')
}

function buildVerifyUrl(requestId: string): string {
  const verifyPath = normalizeVerifyPath(
    process.env.PASSPORT_AUTH_VERIFY_PATH || getConfig<string>('passportAuth.verifyPath')
  )
  const pathWithQuery = `${verifyPath}?requestId=${encodeURIComponent(requestId)}`
  const base = getPortalBaseUrl()
  return base ? `${base}${pathWithQuery}` : pathWithQuery
}

function maskAddress(address: string): string {
  if (!address) return ''
  return `${address.slice(0, 8)}...${address.slice(-6)}`
}

function parseTransports(raw: string): string[] {
  const value = String(raw || '').trim()
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'))
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function normalizeCredentialIdValue(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') return normalizeString(input)
  if (input instanceof Uint8Array) return Buffer.from(input).toString('base64url')
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input)).toString('base64url')
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('base64url')
  }
  return normalizeString(input)
}

function legacyDoubleEncodedCredentialId(credentialId: string): string {
  return credentialId ? Buffer.from(credentialId, 'utf8').toString('base64url') : ''
}

async function findPasskeyCredentialByCandidates(
  manager: PassportManager,
  candidates: unknown[]
): Promise<{ credential: PassportPasskeyCredentialDO | null; credentialId: string }> {
  const ids = new Set<string>()
  for (const candidate of candidates) {
    const id = normalizeCredentialIdValue(candidate)
    if (!id) continue
    ids.add(id)
    ids.add(legacyDoubleEncodedCredentialId(id))
  }
  const [credentialId] = Array.from(ids)
  for (const id of ids) {
    const credential = await manager.getPasskeyCredentialById(id)
    if (credential) return { credential, credentialId: credentialId || id }
  }
  return { credential: null, credentialId: credentialId || '' }
}

function toRequestView(
  record: PassportAuthorizationRequestDO,
  appName = ''
): PassportAuthorizationRequestView {
  return {
    requestId: record.requestId,
    status: record.status,
    appId: record.appId,
    appName: appName || record.appId,
    redirectUri: record.redirectUri,
    state: record.state || '',
    codeChallengeMethod: record.codeChallengeMethod || 'S256',
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    verifyUrl: buildVerifyUrl(record.requestId),
    subjectId: record.subjectId || undefined,
    subjectHint: record.walletAddress ? maskAddress(record.walletAddress) : undefined,
  }
}

export class PassportService {
  private manager: PassportManager
  private applicationService: ApplicationService

  constructor(manager = new PassportManager(), applicationService = new ApplicationService()) {
    this.manager = manager
    this.applicationService = applicationService
  }

  getStatus(): PassportStatus {
    return {
      enabled: true,
      passkey: getPasskeyAuthStatus(),
      pkce: {
        required: true,
        methods: ['S256'],
      },
      subjectModel: 'passport_subject',
    }
  }

  private async writeAudit(input: {
    subjectId?: string
    walletAddress?: string
    requestId?: string
    appId?: string
    action: string
    level?: string
    metadata?: unknown
  }): Promise<void> {
    try {
      const entity = new PassportAuditLogDO()
      entity.subjectId = input.subjectId || ''
      entity.walletAddress = input.walletAddress || ''
      entity.requestId = input.requestId || ''
      entity.appId = input.appId || ''
      entity.action = input.action
      entity.level = input.level || 'info'
      entity.metadataJson = JSON.stringify(input.metadata || {})
      entity.createdAt = getCurrentUtcString()
      await this.manager.saveAuditLog(entity)
    } catch {
      // Audit must not block login, but callers still get deterministic main flow errors.
    }
  }

  private async getAuthorizedApp(appIdInput: unknown, redirectUriInput: unknown) {
    const appId = normalizeString(appIdInput)
    if (!appId) {
      throw new PassportError(400, 'PASSPORT_APP_ID_REQUIRED', 'Missing appId')
    }
    const app = await this.applicationService.queryByUid(appId)
    if (!app.uid || !app.isOnline) {
      throw new PassportError(403, 'PASSPORT_APP_DENIED', 'Unauthorized appId')
    }
    const redirectUri = normalizeRedirectUri(redirectUriInput)
    const allowed = parseRedirectUris(app.redirectUris)
    if (!allowed.includes(redirectUri)) {
      throw new PassportError(403, 'PASSPORT_REDIRECT_URI_DENIED', 'redirectUri is not allowed')
    }
    return { app, redirectUri }
  }

  private async requirePendingAuthorizationRequest(requestIdInput: unknown): Promise<PassportAuthorizationRequestDO> {
    const requestId = normalizeString(requestIdInput)
    if (!requestId) {
      throw new PassportError(400, 'PASSPORT_REQUEST_ID_REQUIRED', 'Missing requestId')
    }
    const request = await this.manager.getAuthorizationRequest(requestId)
    if (!request) {
      throw new PassportError(404, 'PASSPORT_REQUEST_NOT_FOUND', 'passport authorize request not found')
    }
    if (request.status !== 'pending') {
      throw new PassportError(409, 'PASSPORT_REQUEST_NOT_PENDING', 'passport authorize request is not pending')
    }
    if (Date.now() > parseTime(request.expiresAt)) {
      request.status = 'expired'
      request.updatedAt = getCurrentUtcString()
      await this.manager.saveAuthorizationRequest(request)
      throw new PassportError(410, 'PASSPORT_REQUEST_EXPIRED', 'passport authorize request expired')
    }
    await this.getAuthorizedApp(request.appId, request.redirectUri)
    return request
  }

  private async getPrimaryWalletAddress(subjectId: string): Promise<string> {
    const subject = await this.manager.getSubject(subjectId)
    if (subject?.primaryWalletAddress) {
      return normalizeAddress(subject.primaryWalletAddress)
    }
    const bindings = await this.manager.listWalletBindings(subjectId)
    const active = bindings.find((item) => item.status === 'active' && !String(item.revokedAt || '').trim())
    return active ? normalizeAddress(active.address) : ''
  }

  private async issueAuthorizationCodeForSubject(input: {
    request: PassportAuthorizationRequestDO
    subjectId: string
    walletAddress: string
    codeTtlMs?: unknown
    action?: string
  }): Promise<PassportAuthorizationApproveResult> {
    const nowMs = Date.now()
    const now = toIso(nowMs)
    input.request.status = 'approved'
    input.request.subjectId = input.subjectId
    input.request.walletAddress = input.walletAddress
    input.request.updatedAt = now
    input.request.approvedAt = now
    await this.manager.saveAuthorizationRequest(input.request)

    const code = new PassportAuthorizationCodeDO()
    code.code = generateAuthorizationCode()
    code.requestId = input.request.requestId
    code.subjectId = input.subjectId
    code.walletAddress = input.walletAddress
    code.appId = input.request.appId
    code.redirectUri = input.request.redirectUri
    code.state = input.request.state
    code.codeChallenge = input.request.codeChallenge
    code.codeChallengeMethod = input.request.codeChallengeMethod || 'S256'
    code.createdAt = now
    code.expiresAt = toIso(nowMs + clampTtlMs(input.codeTtlMs, DEFAULT_CODE_TTL_MS, MIN_CODE_TTL_MS, MAX_CODE_TTL_MS))
    code.used = false
    code.usedAt = ''
    await this.manager.saveAuthorizationCode(code)
    await this.writeAudit({
      subjectId: input.subjectId,
      walletAddress: input.walletAddress,
      requestId: input.request.requestId,
      appId: input.request.appId,
      action: input.action || 'authorize_approved',
    })
    return {
      requestId: input.request.requestId,
      subjectId: input.subjectId,
      walletAddress: input.walletAddress,
      authorizationCode: code.code,
      authorizationCodeExpiresAt: code.expiresAt,
      redirectTo: appendQuery(input.request.redirectUri, {
        code: code.code,
        state: input.request.state || '',
      }),
    }
  }

  async ensureWalletSubject(addressInput: unknown, proof?: unknown) {
    const address = requireWalletAddress(addressInput)
    const chain = 'eip155:1'
    const now = getCurrentUtcString()
    const existing = await this.manager.getWalletBinding(chain, address)
    if (existing && existing.status === 'active' && !existing.revokedAt) {
      const subject = await this.manager.getSubject(existing.subjectId)
      if (subject && subject.status === 'active') {
        return {
          subjectId: subject.subjectId,
          walletAddress: address,
          binding: existing,
        }
      }
    }

    const subject = new PassportSubjectDO()
    subject.subjectId = generateId('sub')
    subject.status = 'active'
    subject.createdFrom = 'wallet'
    subject.primaryWalletAddress = address
    subject.createdAt = now
    subject.updatedAt = now
    await this.manager.saveSubject(subject)

    const binding = existing || new PassportWalletBindingDO()
    binding.subjectId = subject.subjectId
    binding.chain = chain
    binding.address = address
    binding.proofJson = JSON.stringify(proof || {})
    binding.status = 'active'
    binding.createdAt = existing?.createdAt || now
    binding.updatedAt = now
    binding.revokedAt = ''
    await this.manager.saveWalletBinding(binding)
    await this.writeAudit({
      subjectId: subject.subjectId,
      walletAddress: address,
      action: 'wallet_bound',
    })
    return {
      subjectId: subject.subjectId,
      walletAddress: address,
      binding,
    }
  }

  async listBindingsByWallet(addressInput: unknown) {
    const address = requireWalletAddress(addressInput)
    const binding = await this.manager.getWalletBinding('eip155:1', address)
    if (!binding || binding.status !== 'active' || binding.revokedAt) {
      return {
        subjectId: '',
        walletBindings: [],
      }
    }
    const bindings = await this.manager.listWalletBindings(binding.subjectId)
    return {
      subjectId: binding.subjectId,
      walletBindings: bindings.map((item) => ({
        chain: item.chain,
        address: item.address,
        status: item.status,
        createdAt: item.createdAt,
        revokedAt: item.revokedAt || '',
      })),
    }
  }

  async listPasskeyCredentialsByWallet(addressInput: unknown) {
    const address = requireWalletAddress(addressInput)
    const subject = await this.ensureWalletSubject(address)
    const credentials = await this.manager.listPasskeyCredentials(subject.subjectId)
    return {
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      credentials: credentials.map((item) => ({
        credentialId: item.credentialId,
        subjectId: item.subjectId,
        walletAddress: subject.walletAddress,
        deviceName: item.deviceName || '',
        transports: parseTransports(item.transports),
        createdAt: item.createdAt,
        lastUsedAt: item.lastUsedAt || '',
        revokedAt: item.revokedAt || '',
      })),
    }
  }

  async revokePasskeyCredentialByWallet(addressInput: unknown, credentialIdInput: unknown) {
    const address = requireWalletAddress(addressInput)
    const credentialId = normalizeString(credentialIdInput)
    if (!credentialId) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_CREDENTIAL_ID_REQUIRED', 'Missing credentialId')
    }
    const subject = await this.ensureWalletSubject(address)
    const credential = await this.manager.getPasskeyCredentialById(credentialId)
    if (!credential || credential.subjectId !== subject.subjectId) {
      throw new PassportError(404, 'PASSPORT_PASSKEY_CREDENTIAL_NOT_FOUND', 'Passkey credential not found')
    }
    if (!String(credential.revokedAt || '').trim()) {
      credential.revokedAt = getCurrentUtcString()
      await this.manager.savePasskeyCredential(credential)
      await this.writeAudit({
        subjectId: subject.subjectId,
        walletAddress: subject.walletAddress,
        action: 'passkey_revoked',
        metadata: { credentialId },
      })
    }
    return { success: true, subjectId: subject.subjectId, walletAddress: subject.walletAddress }
  }

  async createPasskeyRegisterRequest(input: { walletAddress: unknown; deviceName?: unknown }) {
    const status = assertPasskeyAuthReady()
    const subject = await this.ensureWalletSubject(input.walletAddress)
    const credentials = await this.manager.listPasskeyCredentials(subject.subjectId)
    const generated = await generateRegistrationOptions({
      rpID: status.rpId,
      rpName: status.rpName,
      userID: Buffer.from(subject.subjectId, 'utf8'),
      userName: subject.subjectId,
      userDisplayName: subject.walletAddress,
      timeout: status.timeoutMs,
      attestationType: 'none',
      excludeCredentials: credentials
        .filter((item) => !String(item.revokedAt || '').trim())
        .map((item) => ({
          id: item.credentialId,
          transports: parseTransports(item.transports),
        })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    } as any)
    const nowMs = Date.now()
    const challenge = new PassportWebauthnChallengeDO()
    challenge.challengeId = generateId('pwc')
    challenge.challengeType = 'register'
    challenge.subjectId = subject.subjectId
    challenge.requestId = ''
    challenge.challenge = String((generated as { challenge?: string }).challenge || '')
    challenge.allowedCredentialIds = JSON.stringify([])
    challenge.createdAt = toIso(nowMs)
    challenge.expiresAt = toIso(nowMs + status.challengeTtlMs)
    challenge.used = false
    await this.manager.saveWebauthnChallenge(challenge)
    await this.writeAudit({
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      action: 'passkey_register_requested',
    })
    return {
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      passkeyRequest: {
        ...(generated as unknown as Record<string, unknown>),
        requestId: challenge.challengeId,
      },
    }
  }

  async confirmPasskeyRegistration(input: {
    walletAddress: unknown
    requestId: unknown
    deviceName?: unknown
    credential: any
  }) {
    const status = assertPasskeyAuthReady()
    const subject = await this.ensureWalletSubject(input.walletAddress)
    const challengeId = normalizeString(input.requestId)
    const challenge = await this.manager.getWebauthnChallenge(challengeId)
    if (!challenge || challenge.challengeType !== 'register' || challenge.subjectId !== subject.subjectId) {
      throw new PassportError(404, 'PASSPORT_PASSKEY_CHALLENGE_NOT_FOUND', 'Passkey challenge not found')
    }
    if (challenge.used) {
      throw new PassportError(409, 'PASSPORT_PASSKEY_CHALLENGE_USED', 'Passkey challenge already used')
    }
    if (Date.now() > parseTime(challenge.expiresAt)) {
      throw new PassportError(410, 'PASSPORT_PASSKEY_CHALLENGE_EXPIRED', 'Passkey challenge expired')
    }
    const verification = await verifyRegistrationResponse({
      response: input.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: status.origin,
      expectedRPID: status.rpId,
    } as any)
    const verificationAny = verification as {
      verified?: boolean
      registrationInfo?: {
        credential?: { id?: string | Uint8Array; publicKey?: Uint8Array; counter?: number; transports?: string[] }
        credentialID?: string | Uint8Array
        credentialPublicKey?: Uint8Array
        counter?: number
        aaguid?: string
      }
    }
    if (!verificationAny.verified || !verificationAny.registrationInfo) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_REGISTER_VERIFY_FAILED', 'Passkey register verify failed')
    }
    const info = verificationAny.registrationInfo
    const rawCredentialId = info.credential?.id || info.credentialID
    const rawPublicKey = info.credential?.publicKey || info.credentialPublicKey
    if (!rawCredentialId || !rawPublicKey) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_REGISTER_RESULT_INVALID', 'Passkey register result is invalid')
    }
    const credentialId = normalizeCredentialIdValue(rawCredentialId)
    const { credential: existed } = await findPasskeyCredentialByCandidates(this.manager, [
      rawCredentialId,
      input.credential?.id,
      input.credential?.rawId,
    ])
    if (existed && !String(existed.revokedAt || '').trim()) {
      throw new PassportError(409, 'PASSPORT_PASSKEY_DUPLICATE_CREDENTIAL', 'Passkey credential already exists')
    }
    const now = getCurrentUtcString()
    const entity = existed || new PassportPasskeyCredentialDO()
    entity.subjectId = subject.subjectId
    entity.credentialId = credentialId
    entity.publicKey = Buffer.from(rawPublicKey).toString('base64url')
    entity.signCount = String(info.credential?.counter || info.counter || 0)
    entity.aaguid = String(info.aaguid || '')
    entity.transports = JSON.stringify(info.credential?.transports || [])
    entity.deviceName = normalizeString(input.deviceName) || 'passkey-device'
    entity.rpId = status.rpId
    entity.userHandle = subject.subjectId
    entity.createdAt = existed?.createdAt || now
    entity.lastUsedAt = ''
    entity.revokedAt = ''
    await this.manager.savePasskeyCredential(entity)
    challenge.used = true
    await this.manager.saveWebauthnChallenge(challenge)
    await this.writeAudit({
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      action: 'passkey_registered',
      metadata: { credentialId },
    })
    return {
      subjectId: subject.subjectId,
      credentialId,
      deviceName: entity.deviceName,
      createdAt: entity.createdAt,
    }
  }

  async createPasskeyAuthorizationChallenge(input: { requestId: unknown }) {
    const status = assertPasskeyAuthReady()
    const request = await this.requirePendingAuthorizationRequest(input.requestId)
    const credentials = request.subjectId
      ? await this.manager.listPasskeyCredentials(request.subjectId)
      : []
    const activeCredentials = credentials.filter((item) => !String(item.revokedAt || '').trim())
    const generated = await generateAuthenticationOptions({
      rpID: status.rpId,
      timeout: status.timeoutMs,
      allowCredentials: activeCredentials.length > 0
        ? activeCredentials.map((item) => ({
            id: item.credentialId,
            transports: parseTransports(item.transports),
          }))
        : undefined,
      userVerification: 'required',
    } as any)
    const nowMs = Date.now()
    const challenge = new PassportWebauthnChallengeDO()
    challenge.challengeId = generateId('pwc')
    challenge.challengeType = 'authorize'
    challenge.subjectId = request.subjectId || ''
    challenge.requestId = request.requestId
    challenge.challenge = String((generated as { challenge?: string }).challenge || '')
    challenge.allowedCredentialIds = JSON.stringify(activeCredentials.map((item) => item.credentialId))
    challenge.createdAt = toIso(nowMs)
    challenge.expiresAt = toIso(nowMs + status.challengeTtlMs)
    challenge.used = false
    await this.manager.saveWebauthnChallenge(challenge)
    return {
      authorizeRequest: toRequestView(request),
      passkeyRequest: {
        ...(generated as unknown as Record<string, unknown>),
        requestId: challenge.challengeId,
      },
    }
  }

  async confirmPasskeyAuthorization(input: {
    requestId: unknown
    passkeyRequestId: unknown
    credential: any
    codeTtlMs?: unknown
  }): Promise<PassportAuthorizationApproveResult> {
    const status = assertPasskeyAuthReady()
    const request = await this.requirePendingAuthorizationRequest(input.requestId)
    const passkeyRequestId = normalizeString(input.passkeyRequestId)
    if (!passkeyRequestId) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_REQUEST_ID_REQUIRED', 'Missing passkeyRequestId')
    }
    const challenge = await this.manager.getWebauthnChallenge(passkeyRequestId)
    if (!challenge || challenge.challengeType !== 'authorize' || challenge.requestId !== request.requestId) {
      throw new PassportError(404, 'PASSPORT_PASSKEY_CHALLENGE_NOT_FOUND', 'Passkey challenge not found')
    }
    if (challenge.used) {
      throw new PassportError(409, 'PASSPORT_PASSKEY_CHALLENGE_USED', 'Passkey challenge already used')
    }
    if (Date.now() > parseTime(challenge.expiresAt)) {
      throw new PassportError(410, 'PASSPORT_PASSKEY_CHALLENGE_EXPIRED', 'Passkey challenge expired')
    }

    const { credential, credentialId } = await findPasskeyCredentialByCandidates(this.manager, [
      input.credential?.id,
      input.credential?.rawId,
    ])
    if (!credentialId) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_CREDENTIAL_ID_REQUIRED', 'Missing credentialId')
    }
    if (!credential || String(credential.revokedAt || '').trim()) {
      throw new PassportError(404, 'PASSPORT_PASSKEY_CREDENTIAL_NOT_FOUND', 'Passkey credential not found')
    }
    if (challenge.subjectId && challenge.subjectId !== credential.subjectId) {
      throw new PassportError(403, 'PASSPORT_PASSKEY_SUBJECT_MISMATCH', 'Passkey subject mismatch')
    }
    const allowedCredentialIds = parseJsonArray(challenge.allowedCredentialIds)
    if (
      allowedCredentialIds.length > 0 &&
      !allowedCredentialIds.includes(credential.credentialId) &&
      !allowedCredentialIds.includes(credentialId)
    ) {
      throw new PassportError(403, 'PASSPORT_PASSKEY_CREDENTIAL_NOT_ALLOWED', 'Passkey credential is not allowed')
    }

    const verification = await verifyAuthenticationResponse({
      response: input.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: status.origin,
      expectedRPID: status.rpId,
      credential: {
        id: credentialId,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: Number(credential.signCount || 0),
        transports: parseTransports(credential.transports),
      },
    } as any)
    const verificationAny = verification as {
      verified?: boolean
      authenticationInfo?: {
        newCounter?: number
      }
    }
    if (!verificationAny.verified) {
      throw new PassportError(401, 'PASSPORT_PASSKEY_AUTHORIZE_VERIFY_FAILED', 'Passkey authorize verify failed')
    }

    credential.credentialId = credentialId
    credential.signCount = String(verificationAny.authenticationInfo?.newCounter || credential.signCount || 0)
    credential.lastUsedAt = getCurrentUtcString()
    await this.manager.savePasskeyCredential(credential)
    challenge.used = true
    await this.manager.saveWebauthnChallenge(challenge)

    const walletAddress = await this.getPrimaryWalletAddress(credential.subjectId)
    if (!walletAddress) {
      throw new PassportError(409, 'PASSPORT_WALLET_BINDING_REQUIRED', 'Subject has no active wallet binding')
    }
    return await this.issueAuthorizationCodeForSubject({
      request,
      subjectId: credential.subjectId,
      walletAddress,
      codeTtlMs: input.codeTtlMs,
      action: 'authorize_passkey_approved',
    })
  }

  async createAuthorizationRequest(input: {
    appId: unknown
    redirectUri: unknown
    state?: unknown
    codeChallenge: unknown
    codeChallengeMethod?: unknown
    requestTtlMs?: unknown
  }): Promise<PassportAuthorizationRequestView> {
    const { app, redirectUri } = await this.getAuthorizedApp(input.appId, input.redirectUri)
    const codeChallenge = validateCodeChallenge(input.codeChallenge)
    const codeChallengeMethod = validateCodeChallengeMethod(input.codeChallengeMethod)
    const ttlMs = clampTtlMs(input.requestTtlMs, DEFAULT_REQUEST_TTL_MS, MIN_REQUEST_TTL_MS, MAX_REQUEST_TTL_MS)
    const nowMs = Date.now()
    const now = toIso(nowMs)
    const entity = new PassportAuthorizationRequestDO()
    entity.requestId = generateId('par')
    entity.appId = app.uid
    entity.redirectUri = redirectUri
    entity.state = normalizeString(input.state)
    entity.codeChallenge = codeChallenge
    entity.codeChallengeMethod = codeChallengeMethod
    entity.subjectId = ''
    entity.walletAddress = ''
    entity.status = 'pending'
    entity.createdAt = now
    entity.updatedAt = now
    entity.expiresAt = toIso(nowMs + ttlMs)
    entity.approvedAt = ''
    await this.manager.saveAuthorizationRequest(entity)
    await this.writeAudit({
      requestId: entity.requestId,
      appId: entity.appId,
      action: 'authorize_requested',
    })
    return toRequestView(entity, app.name)
  }

  async getAuthorizationRequest(requestIdInput: unknown): Promise<PassportAuthorizationRequestView> {
    const requestId = normalizeString(requestIdInput)
    if (!requestId) {
      throw new PassportError(400, 'PASSPORT_REQUEST_ID_REQUIRED', 'Missing requestId')
    }
    const request = await this.manager.getAuthorizationRequest(requestId)
    if (!request) {
      throw new PassportError(404, 'PASSPORT_REQUEST_NOT_FOUND', 'passport authorize request not found')
    }
    const app = await this.applicationService.queryByUid(request.appId)
    return toRequestView(request, app.name || request.appId)
  }

  async approveAuthorizationRequest(input: {
    requestId: unknown
    walletAddress: unknown
    codeTtlMs?: unknown
  }): Promise<PassportAuthorizationApproveResult> {
    const request = await this.requirePendingAuthorizationRequest(input.requestId)
    const subject = await this.ensureWalletSubject(input.walletAddress)
    return await this.issueAuthorizationCodeForSubject({
      request,
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      codeTtlMs: input.codeTtlMs,
    })
  }

  async exchangeAuthorizationCode(input: {
    code: unknown
    appId: unknown
    redirectUri: unknown
    codeVerifier: unknown
  }): Promise<PassportAuthorizationExchangeResult> {
    const codeValue = normalizeString(input.code)
    if (!codeValue) {
      throw new PassportError(400, 'PASSPORT_CODE_REQUIRED', 'Missing authorization code')
    }
    const { redirectUri } = await this.getAuthorizedApp(input.appId, input.redirectUri)
    const record = await this.manager.getAuthorizationCode(codeValue)
    if (!record) {
      throw new PassportError(404, 'PASSPORT_CODE_NOT_FOUND', 'Authorization code not found')
    }
    if (record.used) {
      throw new PassportError(409, 'PASSPORT_CODE_USED', 'Authorization code already used')
    }
    if (Date.now() > parseTime(record.expiresAt)) {
      throw new PassportError(410, 'PASSPORT_CODE_EXPIRED', 'Authorization code expired')
    }
    if (record.appId !== normalizeString(input.appId) || record.redirectUri !== redirectUri) {
      throw new PassportError(403, 'PASSPORT_CODE_APP_MISMATCH', 'Authorization code does not match app binding')
    }
    verifyPkce(input.codeVerifier, record.codeChallenge)
    const now = getCurrentUtcString()
    record.used = true
    record.usedAt = now
    await this.manager.saveAuthorizationCode(record)
    await this.writeAudit({
      subjectId: record.subjectId,
      walletAddress: record.walletAddress,
      requestId: record.requestId,
      appId: record.appId,
      action: 'authorize_exchanged',
    })
    return {
      requestId: record.requestId,
      subjectId: record.subjectId,
      walletAddress: record.walletAddress,
      appId: record.appId,
      redirectUri: record.redirectUri,
      state: record.state || '',
      issuedAt: now,
    }
  }
}
