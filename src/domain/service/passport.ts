import crypto from 'crypto'
import * as jwt from 'jsonwebtoken'
import type { JwtPayload } from 'jsonwebtoken'
import { verifyMessage } from 'ethers'
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
  PassportEmailVerificationChallengeDO,
  PassportPasskeyCredentialDO,
  PassportSubjectDO,
  PassportWebauthnChallengeDO,
  PassportWalletBindingDO,
} from '../mapper/entity'
import { ApplicationService } from './application'
import { getCurrentUtcString } from '../../common/date'
import { assertPasskeyAuthReady, getPasskeyAuthStatus } from '../../auth/passportPasskeyAuth'
import { getConfig } from '../../config/runtime'
import {
  assertActionSignature,
  buildActionSignatureMessage,
  getActionSignatureErrorStatus,
} from '../../auth/actionSignature'
import { deliverPassportEmailVerification } from './passportEmailDelivery'
import { getRuntimeSecret } from '../../security/secretVault'

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
  scopes: string[]
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
  walletAddress?: string
  appId: string
  redirectUri: string
  state: string
  issuedAt: string
  scopes: string[]
  claims: {
    subjectId: string
    walletAddress?: string
    email?: string
    emailVerified?: boolean
    emailVerifiedAt?: string
  }
}

export type PassportEmailVerificationDelivery = (input: {
  email: string
  code: string
  verificationId: string
  expiresAt: string
}) => Promise<void>

export type PassportEmailVerificationRequestResult = {
  verificationId: string
  emailHint: string
  expiresAt: string
}

export type PassportWalletUnbindRequest = {
  requestId: string
  action: 'passport_wallet_unbind'
  subjectId: string
  walletAddress: string
  chain: string
  timestamp: string
  expiresAt: string
  payload: {
    subjectId: string
    walletAddress: string
    chain: string
  }
  message: string
}

export type PassportWalletUnbindResult = {
  success: true
  subjectId: string
  walletAddress: string
  revokedWalletBindings: number
  revokedPasskeyCredentials: number
  revokedAuthorizationRequests: number
  revokedAuthorizationCodes: number
  subjectStatus: string
}

export type PassportWalletAssertionClaims = {
  iss: string
  sub: string
  subjectId: string
  aud: string
  appId: string
  nonce: string
  authMethod: 'wallet'
  walletAddress: string
  scope: string[]
  email?: string
  emailVerified?: boolean
  emailVerifiedAt?: string
}

export type PassportWalletAssertionResult = {
  passportAssertion: string
  assertionType: 'jwt'
  expiresAt: string
  claims: PassportWalletAssertionClaims
}

export type PassportAssertionIntrospectionResult = {
  active: boolean
  claims?: PassportWalletAssertionClaims & {
    iat?: number
    exp?: number
  }
  error?: string
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
const DEFAULT_VERIFY_PATH = '/passport/authorize'
const PKCE_REGEX = /^[A-Za-z0-9._~-]{43,128}$/
const WALLET_UNBIND_ACTION = 'passport_wallet_unbind'
const DEFAULT_WALLET_UNBIND_TTL_MS = 5 * 60 * 1000
const DEFAULT_ASSERTION_TTL_MS = 5 * 60 * 1000
const MIN_ASSERTION_TTL_MS = 30 * 1000
const MAX_ASSERTION_TTL_MS = 30 * 60 * 1000
const DEFAULT_AUTHORIZATION_SCOPES = ['identity.basic', 'identity.wallet']
const ALLOWED_AUTHORIZATION_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.email'])
const EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000
const EMAIL_VERIFICATION_RESEND_INTERVAL_MS = 60 * 1000
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5
const INSECURE_JWT_SECRET = 'replace-this-in-production'
const MIN_JWT_SECRET_LENGTH = 32

function parseAuthorizationScopes(input: unknown): string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,]+/)
      : input == null
        ? DEFAULT_AUTHORIZATION_SCOPES
        : []
  const scopes = Array.from(new Set(values.map((value) => normalizeString(value)).filter(Boolean)))
  for (const scope of scopes) {
    if (!ALLOWED_AUTHORIZATION_SCOPES.has(scope)) {
      throw new PassportError(400, 'PASSPORT_SCOPE_UNSUPPORTED', `Unsupported scope: ${scope}`)
    }
  }
  return scopes
}

function parseStoredAuthorizationScopes(input: unknown): string[] {
  const raw = normalizeString(input)
  if (!raw) return DEFAULT_AUTHORIZATION_SCOPES
  try {
    const parsed = JSON.parse(raw)
    return parseAuthorizationScopes(Array.isArray(parsed) ? parsed : [])
  } catch {
    // A malformed persisted value must not broaden the returned claims.
    return []
  }
}

function normalizeEmail(input: unknown): string {
  const email = normalizeString(input).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new PassportError(400, 'PASSPORT_EMAIL_INVALID', 'Invalid email address')
  }
  return email
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return ''
  return `${local.slice(0, 1)}***@${domain}`
}

function buildPasskeyAccountLabel(subject: PassportSubjectDO, walletAddress: string): string {
  if (subject.emailStatus === 'verified' && normalizeString(subject.email)) {
    return `YeYing · ${normalizeString(subject.email).toLowerCase()}`
  }
  return `YeYing · ${maskAddress(walletAddress)}`
}

function generateEmailVerificationCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashEmailVerificationCode(verificationId: string, code: string): string {
  return crypto.createHash('sha256').update(`${verificationId}:${code}`).digest('hex')
}

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

function getPassportAssertionIssuer(): string {
  return getPortalBaseUrl() || 'yeying-passport'
}

function getPassportAssertionSecret(): string {
  const raw = normalizeString(
    getRuntimeSecret('PASSPORT_ASSERTION_SECRET') ||
      getRuntimeSecret('JWT_SECRET') ||
      process.env.PASSPORT_ASSERTION_SECRET ||
      process.env.JWT_SECRET ||
      getConfig<string>('passportAuth.assertionSecret') ||
      getConfig<string>('auth.jwtSecret') ||
      INSECURE_JWT_SECRET
  )
  if (!raw || raw === INSECURE_JWT_SECRET) {
    throw new PassportError(
      500,
      'PASSPORT_ASSERTION_SECRET_MISSING',
      'Passport assertion secret is not configured',
    )
  }
  if (raw.length < MIN_JWT_SECRET_LENGTH) {
    throw new PassportError(
      500,
      'PASSPORT_ASSERTION_SECRET_TOO_SHORT',
      `Passport assertion secret must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
    )
  }
  return raw
}

function getPassportAssertionTtlMs(ttlMsInput?: unknown): number {
  return clampTtlMs(
    ttlMsInput ?? process.env.PASSPORT_ASSERTION_TTL_MS ?? getConfig<number>('passportAuth.assertionTtlMs'),
    DEFAULT_ASSERTION_TTL_MS,
    MIN_ASSERTION_TTL_MS,
    MAX_ASSERTION_TTL_MS,
  )
}

function normalizeAudience(input: unknown): string {
  const raw = normalizeString(input)
  if (!raw) {
    throw new PassportError(400, 'PASSPORT_ASSERTION_AUDIENCE_REQUIRED', 'Missing audience')
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new PassportError(400, 'PASSPORT_ASSERTION_AUDIENCE_INVALID', 'Invalid audience')
  }
  if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
    throw new PassportError(400, 'PASSPORT_ASSERTION_AUDIENCE_INVALID', 'Invalid audience')
  }
  parsed.hash = ''
  return parsed.toString()
}

function isAudienceAllowed(audience: string, redirectUris: string[]): boolean {
  let audienceUrl: URL
  try {
    audienceUrl = new URL(audience)
  } catch {
    return false
  }
  return redirectUris.some((redirectUri) => {
    if (redirectUri === audience) return true
    try {
      const allowedUrl = new URL(redirectUri)
      return allowedUrl.origin === audienceUrl.origin
    } catch {
      return false
    }
  })
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
    scopes: parseStoredAuthorizationScopes(record.scopesJson),
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
  private emailVerificationDelivery: PassportEmailVerificationDelivery | null

  constructor(
    manager = new PassportManager(),
    applicationService = new ApplicationService(),
    emailVerificationDelivery: PassportEmailVerificationDelivery | null = deliverPassportEmailVerification,
  ) {
    this.manager = manager
    this.applicationService = applicationService
    this.emailVerificationDelivery = emailVerificationDelivery
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

  async requestEmailVerification(input: {
    subjectId: unknown
    email: unknown
  }): Promise<PassportEmailVerificationRequestResult> {
    const subjectId = normalizeString(input.subjectId)
    const email = normalizeEmail(input.email)
    const subject = await this.manager.getSubject(subjectId)
    if (!subject || subject.status !== 'active') {
      throw new PassportError(404, 'PASSPORT_SUBJECT_NOT_FOUND', 'Passport subject not found')
    }
    if (!this.emailVerificationDelivery) {
      throw new PassportError(503, 'PASSPORT_EMAIL_DELIVERY_UNAVAILABLE', 'Email verification delivery is not configured')
    }
    const latest = (await this.manager.listEmailVerificationChallenges(subjectId))[0]
    if (latest && latest.status === 'pending' && Date.now() - parseTime(latest.createdAt) < EMAIL_VERIFICATION_RESEND_INTERVAL_MS) {
      throw new PassportError(429, 'PASSPORT_EMAIL_VERIFICATION_TOO_FREQUENT', 'Please wait before requesting another code')
    }
    const nowMs = Date.now()
    const now = toIso(nowMs)
    const verificationId = generateId('pev')
    const code = generateEmailVerificationCode()
    const challenge = new PassportEmailVerificationChallengeDO()
    challenge.verificationId = verificationId
    challenge.subjectId = subjectId
    challenge.email = email
    challenge.codeHash = hashEmailVerificationCode(verificationId, code)
    challenge.attempts = 0
    challenge.status = 'pending'
    challenge.createdAt = now
    challenge.expiresAt = toIso(nowMs + EMAIL_VERIFICATION_TTL_MS)
    challenge.verifiedAt = ''
    await this.manager.saveEmailVerificationChallenge(challenge)
    try {
      await this.emailVerificationDelivery({ email, code, verificationId, expiresAt: challenge.expiresAt })
    } catch {
      challenge.status = 'delivery_failed'
      await this.manager.saveEmailVerificationChallenge(challenge)
      throw new PassportError(503, 'PASSPORT_EMAIL_DELIVERY_FAILED', 'Unable to deliver verification email')
    }
    await this.writeAudit({ subjectId, action: 'email_verification_requested' })
    return { verificationId, emailHint: maskEmail(email), expiresAt: challenge.expiresAt }
  }

  async confirmEmailVerification(input: {
    subjectId: unknown
    verificationId: unknown
    code: unknown
  }): Promise<{ subjectId: string; email: string; emailVerifiedAt: string }> {
    const subjectId = normalizeString(input.subjectId)
    const verificationId = normalizeString(input.verificationId)
    const code = normalizeString(input.code)
    if (!verificationId || !/^\d{6}$/.test(code)) {
      throw new PassportError(400, 'PASSPORT_EMAIL_VERIFICATION_INVALID', 'Invalid verification code')
    }
    const challenge = await this.manager.getEmailVerificationChallenge(verificationId)
    if (!challenge || challenge.subjectId !== subjectId || challenge.status !== 'pending') {
      throw new PassportError(400, 'PASSPORT_EMAIL_VERIFICATION_INVALID', 'Invalid verification code')
    }
    if (Date.now() > parseTime(challenge.expiresAt)) {
      challenge.status = 'expired'
      await this.manager.saveEmailVerificationChallenge(challenge)
      throw new PassportError(410, 'PASSPORT_EMAIL_VERIFICATION_EXPIRED', 'Verification code expired')
    }
    const actual = hashEmailVerificationCode(verificationId, code)
    if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(challenge.codeHash))) {
      challenge.attempts += 1
      if (challenge.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) challenge.status = 'failed'
      await this.manager.saveEmailVerificationChallenge(challenge)
      throw new PassportError(400, 'PASSPORT_EMAIL_VERIFICATION_INVALID', 'Invalid verification code')
    }
    const subject = await this.manager.getSubject(subjectId)
    if (!subject || subject.status !== 'active') {
      throw new PassportError(404, 'PASSPORT_SUBJECT_NOT_FOUND', 'Passport subject not found')
    }
    const now = getCurrentUtcString()
    challenge.status = 'verified'
    challenge.verifiedAt = now
    await this.manager.saveEmailVerificationChallenge(challenge)
    subject.email = challenge.email
    subject.emailStatus = 'verified'
    subject.emailVerifiedAt = now
    subject.updatedAt = now
    await this.manager.saveSubject(subject)
    await this.writeAudit({ subjectId, action: 'email_verified' })
    return { subjectId, email: subject.email, emailVerifiedAt: now }
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

  private async getAssertionApp(appIdInput: unknown, audienceInput: unknown) {
    const appId = normalizeString(appIdInput)
    if (!appId) {
      throw new PassportError(400, 'PASSPORT_APP_ID_REQUIRED', 'Missing appId')
    }
    const app = await this.applicationService.queryByUid(appId)
    if (!app.uid || !app.isOnline) {
      throw new PassportError(403, 'PASSPORT_APP_DENIED', 'Unauthorized appId')
    }
    const audience = normalizeAudience(audienceInput)
    const allowed = parseRedirectUris(app.redirectUris)
    if (!isAudienceAllowed(audience, allowed)) {
      throw new PassportError(403, 'PASSPORT_ASSERTION_AUDIENCE_DENIED', 'audience is not allowed')
    }
    return { app, appId, audience }
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

  private async requireActiveWalletSubject(addressInput: unknown) {
    const address = requireWalletAddress(addressInput)
    const chain = 'eip155:1'
    const binding = await this.manager.getWalletBinding(chain, address)
    if (!binding || binding.status !== 'active' || String(binding.revokedAt || '').trim()) {
      throw new PassportError(404, 'PASSPORT_WALLET_BINDING_NOT_FOUND', 'Passport wallet binding not found')
    }
    const subject = await this.manager.getSubject(binding.subjectId)
    if (!subject || subject.status !== 'active') {
      throw new PassportError(404, 'PASSPORT_SUBJECT_NOT_FOUND', 'Passport subject not found')
    }
    return {
      subjectId: subject.subjectId,
      walletAddress: address,
      chain,
      subject,
      binding,
    }
  }

  private buildWalletUnbindPayload(input: { subjectId: string; walletAddress: string; chain: string }) {
    return {
      subjectId: input.subjectId,
      walletAddress: input.walletAddress,
      chain: input.chain,
    }
  }

  private async revokeSubjectArtifacts(input: {
    subjectId: string
    now: string
  }) {
    let revokedPasskeyCredentials = 0
    let revokedAuthorizationRequests = 0
    let revokedAuthorizationCodes = 0

    const credentials = await this.manager.listPasskeyCredentials(input.subjectId)
    for (const credential of credentials) {
      if (!String(credential.revokedAt || '').trim()) {
        credential.revokedAt = input.now
        await this.manager.savePasskeyCredential(credential)
        revokedPasskeyCredentials += 1
      }
    }

    const requests = await this.manager.listAuthorizationRequestsBySubject(input.subjectId)
    for (const request of requests) {
      if (request.status === 'pending' || request.status === 'approved') {
        request.status = 'revoked'
        request.updatedAt = input.now
        await this.manager.saveAuthorizationRequest(request)
        revokedAuthorizationRequests += 1
      }
    }

    const codes = await this.manager.listAuthorizationCodesBySubject(input.subjectId)
    for (const code of codes) {
      if (!code.used) {
        code.used = true
        code.usedAt = input.now
        await this.manager.saveAuthorizationCode(code)
        revokedAuthorizationCodes += 1
      }
    }

    return {
      revokedPasskeyCredentials,
      revokedAuthorizationRequests,
      revokedAuthorizationCodes,
    }
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
    code.scopesJson = input.request.scopesJson
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

  async createWalletAssertion(input: {
    address: unknown
    message: unknown
    signature: unknown
    appId: unknown
    audience: unknown
    nonce: unknown
    scopes?: unknown
    scope?: unknown
    origin?: unknown
    requestId?: unknown
    ttlMs?: unknown
  }): Promise<PassportWalletAssertionResult> {
    const address = requireWalletAddress(input.address)
    const message = normalizeString(input.message)
    const signature = normalizeString(input.signature)
    const nonce = normalizeString(input.nonce)
    if (!message) {
      throw new PassportError(400, 'PASSPORT_ASSERTION_MESSAGE_REQUIRED', 'Missing message')
    }
    if (!signature) {
      throw new PassportError(400, 'PASSPORT_ASSERTION_SIGNATURE_REQUIRED', 'Missing signature')
    }
    if (!nonce) {
      throw new PassportError(400, 'PASSPORT_ASSERTION_NONCE_REQUIRED', 'Missing nonce')
    }

    let recovered = ''
    try {
      recovered = normalizeAddress(verifyMessage(message, signature))
    } catch {
      throw new PassportError(401, 'PASSPORT_ASSERTION_SIGNATURE_INVALID', 'Invalid signature')
    }
    if (recovered !== address) {
      throw new PassportError(401, 'PASSPORT_ASSERTION_SIGNATURE_INVALID', 'Invalid signature')
    }

    const { appId, audience } = await this.getAssertionApp(input.appId, input.audience)
    const scope = parseAuthorizationScopes(input.scopes ?? input.scope)
    const subject = await this.requireActiveWalletSubject(address)
    const ttlMs = getPassportAssertionTtlMs(input.ttlMs)
    const nowSec = Math.floor(Date.now() / 1000)
    const exp = nowSec + Math.floor(ttlMs / 1000)
    const claims: PassportWalletAssertionClaims = {
      iss: getPassportAssertionIssuer(),
      sub: subject.subjectId,
      subjectId: subject.subjectId,
      aud: audience,
      appId,
      nonce,
      authMethod: 'wallet',
      walletAddress: address,
      scope,
    }
    if (scope.includes('identity.email')) {
      claims.email = subject.subject.emailStatus === 'verified' ? normalizeString(subject.subject.email).toLowerCase() : ''
      claims.emailVerified = subject.subject.emailStatus === 'verified' && !!claims.email
      claims.emailVerifiedAt = claims.emailVerified ? normalizeString(subject.subject.emailVerifiedAt) : ''
    }
    const payload = {
      ...claims,
      iat: nowSec,
      exp,
    }
    const passportAssertion = jwt.sign(payload, getPassportAssertionSecret(), {
      algorithm: 'HS256',
      noTimestamp: true,
    })
    await this.writeAudit({
      subjectId: subject.subjectId,
      walletAddress: address,
      requestId: normalizeString(input.requestId),
      appId,
      action: 'wallet_assertion_issued',
      metadata: {
        audience,
        scope,
        origin: normalizeString(input.origin),
        expiresAt: toIso(exp * 1000),
      },
    })
    return {
      passportAssertion,
      assertionType: 'jwt',
      expiresAt: toIso(exp * 1000),
      claims,
    }
  }

  introspectWalletAssertion(assertionInput: unknown): PassportAssertionIntrospectionResult {
    const assertion = normalizeString(assertionInput)
    if (!assertion) {
      return { active: false, error: 'PASSPORT_ASSERTION_MISSING' }
    }
    try {
      const decoded = jwt.verify(assertion, getPassportAssertionSecret(), {
        algorithms: ['HS256'],
      }) as JwtPayload
      if (!decoded || decoded.authMethod !== 'wallet' || !decoded.sub) {
        return { active: false, error: 'PASSPORT_ASSERTION_INVALID' }
      }
      const scope = parseAuthorizationScopes(decoded.scope)
      const claims: PassportAssertionIntrospectionResult['claims'] = {
        iss: normalizeString(decoded.iss),
        sub: normalizeString(decoded.sub),
        subjectId: normalizeString(decoded.subjectId || decoded.sub),
        aud: normalizeString(decoded.aud),
        appId: normalizeString(decoded.appId),
        nonce: normalizeString(decoded.nonce),
        authMethod: 'wallet',
        walletAddress: normalizeAddress(decoded.walletAddress),
        scope,
        iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
        exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
      }
      if (scope.includes('identity.email')) {
        claims.email = normalizeString(decoded.email).toLowerCase()
        claims.emailVerified = decoded.emailVerified === true
        claims.emailVerifiedAt = normalizeString(decoded.emailVerifiedAt)
      }
      return { active: true, claims }
    } catch (error) {
      return {
        active: false,
        error: error instanceof Error ? error.message : 'PASSPORT_ASSERTION_INVALID',
      }
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

  async createWalletUnbindRequest(addressInput: unknown): Promise<PassportWalletUnbindRequest> {
    const subject = await this.requireActiveWalletSubject(addressInput)
    const requestId = generateId('pun')
    const nowMs = Date.now()
    const timestamp = toIso(nowMs)
    const payload = this.buildWalletUnbindPayload(subject)
    const message = buildActionSignatureMessage({
      action: WALLET_UNBIND_ACTION,
      actor: subject.walletAddress,
      timestamp,
      requestId,
      payload,
    })
    await this.writeAudit({
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      requestId,
      action: 'wallet_unbind_requested',
      metadata: payload,
    })
    return {
      requestId,
      action: WALLET_UNBIND_ACTION,
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      chain: subject.chain,
      timestamp,
      expiresAt: toIso(nowMs + DEFAULT_WALLET_UNBIND_TTL_MS),
      payload,
      message,
    }
  }

  async confirmWalletUnbind(input: {
    walletAddress: unknown
    requestId: unknown
    timestamp: unknown
    signature: unknown
  }): Promise<PassportWalletUnbindResult> {
    const subject = await this.requireActiveWalletSubject(input.walletAddress)
    const payload = this.buildWalletUnbindPayload(subject)
    const raw = {
      requestId: normalizeString(input.requestId),
      timestamp: normalizeString(input.timestamp),
      signature: normalizeString(input.signature),
    }
    try {
      await assertActionSignature({
        raw,
        action: WALLET_UNBIND_ACTION,
        actor: subject.walletAddress,
        payload,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid signature'
      throw new PassportError(
        getActionSignatureErrorStatus(message) || 401,
        'PASSPORT_WALLET_UNBIND_SIGNATURE_INVALID',
        message,
      )
    }

    const now = getCurrentUtcString()
    let revokedWalletBindings = 0
    if (!String(subject.binding.revokedAt || '').trim()) {
      subject.binding.status = 'revoked'
      subject.binding.updatedAt = now
      subject.binding.revokedAt = now
      await this.manager.saveWalletBinding(subject.binding)
      revokedWalletBindings = 1
    }

    const bindings = await this.manager.listWalletBindings(subject.subjectId)
    const activeBindings = bindings.filter(
      (item) =>
        item.status === 'active' &&
        !String(item.revokedAt || '').trim() &&
        !(item.chain === subject.chain && normalizeAddress(item.address) === subject.walletAddress),
    )
    subject.subject.status = activeBindings.length > 0 ? 'active' : 'revoked'
    subject.subject.primaryWalletAddress = activeBindings.length > 0 ? normalizeAddress(activeBindings[0].address) : ''
    subject.subject.updatedAt = now
    await this.manager.saveSubject(subject.subject)

    const artifactResult = await this.revokeSubjectArtifacts({
      subjectId: subject.subjectId,
      now,
    })

    await this.writeAudit({
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      requestId: raw.requestId,
      action: 'wallet_unbound',
      metadata: {
        chain: subject.chain,
        revokedWalletBindings,
        ...artifactResult,
      },
    })

    return {
      success: true,
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      revokedWalletBindings,
      ...artifactResult,
      subjectStatus: subject.subject.status,
    }
  }

  async listPasskeyCredentialsByWallet(addressInput: unknown) {
    const subject = await this.requireActiveWalletSubject(addressInput)
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

  async renamePasskeyCredentialByWallet(addressInput: unknown, credentialIdInput: unknown, deviceNameInput: unknown) {
    const credentialId = normalizeString(credentialIdInput)
    const deviceName = normalizeString(deviceNameInput)
    if (!credentialId) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_CREDENTIAL_ID_REQUIRED', 'Missing credentialId')
    }
    if (!deviceName) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_DEVICE_NAME_REQUIRED', 'Missing deviceName')
    }
    const subject = await this.requireActiveWalletSubject(addressInput)
    const credential = await this.manager.getPasskeyCredentialById(credentialId)
    if (!credential || credential.subjectId !== subject.subjectId) {
      throw new PassportError(404, 'PASSPORT_PASSKEY_CREDENTIAL_NOT_FOUND', 'Passkey credential not found')
    }
    credential.deviceName = deviceName
    await this.manager.savePasskeyCredential(credential)
    await this.writeAudit({
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      action: 'passkey_credential_renamed',
      metadata: { credentialId },
    })
    return {
      subjectId: subject.subjectId,
      walletAddress: subject.walletAddress,
      credentialId,
      deviceName: credential.deviceName,
    }
  }

  async revokePasskeyCredentialByWallet(addressInput: unknown, credentialIdInput: unknown) {
    const credentialId = normalizeString(credentialIdInput)
    if (!credentialId) {
      throw new PassportError(400, 'PASSPORT_PASSKEY_CREDENTIAL_ID_REQUIRED', 'Missing credentialId')
    }
    const subject = await this.requireActiveWalletSubject(addressInput)
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
    const binding = await this.ensureWalletSubject(input.walletAddress)
    const subject = await this.manager.getSubject(binding.subjectId)
    if (!subject || subject.status !== 'active') {
      throw new PassportError(404, 'PASSPORT_SUBJECT_NOT_FOUND', 'Passport subject not found')
    }
    const credentials = await this.manager.listPasskeyCredentials(subject.subjectId)
    const accountLabel = buildPasskeyAccountLabel(subject, binding.walletAddress)
    const generated = await generateRegistrationOptions({
      rpID: status.rpId,
      rpName: status.rpName,
      userID: Buffer.from(subject.subjectId, 'utf8'),
      userName: accountLabel,
      userDisplayName: accountLabel,
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
      walletAddress: binding.walletAddress,
      action: 'passkey_register_requested',
    })
    return {
      subjectId: subject.subjectId,
      walletAddress: binding.walletAddress,
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
    entity.deviceName = normalizeString(input.deviceName) || '未命名登录设备'
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
    scopes?: unknown
    requestTtlMs?: unknown
  }): Promise<PassportAuthorizationRequestView> {
    const { app, redirectUri } = await this.getAuthorizedApp(input.appId, input.redirectUri)
    const codeChallenge = validateCodeChallenge(input.codeChallenge)
    const codeChallengeMethod = validateCodeChallengeMethod(input.codeChallengeMethod)
    const scopes = parseAuthorizationScopes(input.scopes)
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
    entity.scopesJson = JSON.stringify(scopes)
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
    const scopes = parseStoredAuthorizationScopes(record.scopesJson)
    const subject = await this.manager.getSubject(record.subjectId)
    const claims: PassportAuthorizationExchangeResult['claims'] = {
      subjectId: record.subjectId,
    }
    if (scopes.includes('identity.wallet') && record.walletAddress) {
      claims.walletAddress = record.walletAddress
    }
    if (scopes.includes('identity.email')) {
      const emailVerified = subject?.emailStatus === 'verified' && Boolean(subject.email)
      claims.email = emailVerified ? subject!.email : ''
      claims.emailVerified = emailVerified
      claims.emailVerifiedAt = emailVerified ? subject!.emailVerifiedAt || '' : ''
    }
    return {
      requestId: record.requestId,
      subjectId: record.subjectId,
      ...(scopes.includes('identity.wallet') && record.walletAddress ? { walletAddress: record.walletAddress } : {}),
      appId: record.appId,
      redirectUri: record.redirectUri,
      state: record.state || '',
      issuedAt: now,
      scopes,
      claims,
    }
  }
}
