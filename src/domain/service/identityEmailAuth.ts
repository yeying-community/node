import { createHash, randomInt, randomUUID } from 'node:crypto'
import { IdentityAuthorizationService } from './identityAuthorization'
import { SingletonDataSource } from '../facade/datasource'
import { IdentityAuditLogDO, IdentityCredentialDO, IdentityEmailAccountDO, IdentityEmailAuthChallengeDO, IdentityRegistrationDO } from '../mapper/entity'
import { issueIdentityCredential } from '../../auth/identityIssuer'

type Delivery = (input: { email: string; code: string; expiresAt: string; purpose: 'register' | 'login' }) => Promise<void>
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

export function normalizeIdentityEmail(value: unknown) {
  const email = String(value || '').trim().normalize('NFC').toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 320) throw new Error('IDENTITY_EMAIL_INVALID')
  return email
}

function storage() {
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE')
  return ds
}

function id(prefix: string) { return `${prefix}_${randomUUID()}` }
function hashCode(challengeId: string, code: string) { return createHash('sha256').update(`${challengeId}:${code}`).digest('hex') }
function now() { return new Date().toISOString() }

export class IdentityEmailAuthService {
  private readonly identityAuthorization = new IdentityAuthorizationService()

  constructor(private readonly delivery: Delivery) {}

  async requestRegister(input: { email: unknown; identityDocument: any; deviceName?: unknown }) {
    const email = normalizeIdentityEmail(input.email)
    const ds = storage()
    if (await ds.getRepository(IdentityEmailAccountDO).findOneBy({ email, status: 'active' })) throw new Error('IDENTITY_EMAIL_ALREADY_REGISTERED')
    const challengeId = id('iea')
    const registration = await this.identityAuthorization.createInitialIdentityRegistration({ identityDocument: input.identityDocument, deviceName: input.deviceName, emailChallengeId: challengeId })
    const code = String(randomInt(100000, 1000000))
    const createdAt = now()
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
    const challenge = new IdentityEmailAuthChallengeDO()
    Object.assign(challenge, {
      challengeId,
      email,
      identityDid: registration.identity,
      registrationId: registration.registrationId,
      purpose: 'register',
      codeHash: hashCode(challengeId, code),
      passkeyRequestJson: JSON.stringify(registration.passkeyRequest),
      attempts: 0,
      status: 'pending',
      createdAt,
      expiresAt,
      consumedAt: ''
    })
    await ds.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
    try {
      await this.delivery({ email, code, expiresAt, purpose: 'register' })
    } catch (error) {
      await ds.getRepository(IdentityEmailAuthChallengeDO).delete({ challengeId })
      throw error
    }
    return { verificationId: challengeId, email, identity: registration.identity, registrationId: registration.registrationId, expiresAt }
  }

  async confirmRegister(input: { verificationId: unknown; code: unknown }) {
    const ds = storage()
    const challengeId = String(input.verificationId || '').trim()
    const challenge = await ds.getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId, purpose: 'register' })
    if (!challenge) throw new Error('IDENTITY_EMAIL_VERIFICATION_NOT_FOUND')
    if (challenge.status !== 'pending' || Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('IDENTITY_EMAIL_VERIFICATION_EXPIRED')
    challenge.attempts += 1
    if (challenge.attempts > MAX_ATTEMPTS || hashCode(challengeId, String(input.code || '').trim()) !== challenge.codeHash) {
      if (challenge.attempts >= MAX_ATTEMPTS) challenge.status = 'expired'
      await ds.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
      throw new Error('IDENTITY_EMAIL_VERIFICATION_INVALID')
    }
    challenge.status = 'verified'
    await ds.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
    let passkeyRequest: unknown = {}
    try { passkeyRequest = JSON.parse(challenge.passkeyRequestJson || '{}') } catch { throw new Error('IDENTITY_PASSKEY_REQUEST_INVALID') }
    return { verificationId: challenge.challengeId, registrationId: challenge.registrationId, identity: challenge.identityDid, passkeyRequest, email: challenge.email, verifiedAt: now() }
  }

  async completeRegister(input: { verificationId: unknown; registrationId: unknown }) {
    const ds = storage()
    const challengeId = String(input.verificationId || '').trim()
    const registrationId = String(input.registrationId || '').trim()
    const result = await ds.transaction(async manager => {
      const challenge = await manager.getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId, purpose: 'register' })
      if (!challenge || challenge.status !== 'verified' || challenge.registrationId !== registrationId) throw new Error('IDENTITY_EMAIL_REGISTRATION_INVALID')
      const registration = await manager.getRepository(IdentityRegistrationDO).findOneBy({ registrationId, status: 'active' })
      if (!registration || registration.identityDid !== challenge.identityDid) throw new Error('IDENTITY_REGISTRATION_NOT_ACTIVE')
      const existing = await manager.getRepository(IdentityEmailAccountDO).findOneBy({ email: challenge.email })
      if (existing) throw new Error('IDENTITY_EMAIL_ALREADY_REGISTERED')
      const verifiedAt = now()
      const credentialId = `urn:yeying:credential:email:${challenge.challengeId}`
      const credential = issueIdentityCredential({ credentialId, subject: challenge.identityDid, type: 'EmailCredential', claim: { email: challenge.email, emailVerifiedAt: verifiedAt, emailVerificationMethod: 'email-code-v1', credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' } } })
      const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString())
      const account = new IdentityEmailAccountDO()
      Object.assign(account, { email: challenge.email, identityDid: challenge.identityDid, status: 'active', createdAt: verifiedAt, verifiedAt })
      const row = new IdentityCredentialDO()
      Object.assign(row, { credentialId, identityDid: challenge.identityDid, credentialType: 'EmailCredential', token: credential, status: 'active', issuedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString(), revokedAt: '' })
      challenge.status = 'completed'
      challenge.consumedAt = verifiedAt
      const audit = new IdentityAuditLogDO()
      Object.assign(audit, { identityDid: challenge.identityDid, action: 'identity_email_registered', outcome: 'success', metadataJson: JSON.stringify({ email: challenge.email, credentialId }), createdAt: verifiedAt })
      await manager.getRepository(IdentityEmailAccountDO).save(account)
      await manager.getRepository(IdentityCredentialDO).save(row)
      await manager.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
      await manager.getRepository(IdentityAuditLogDO).save(audit)
      return { identity: challenge.identityDid, email: challenge.email, verifiedAt }
    })
    return result
  }

  async requestLogin(input: { email: unknown }) {
    const email = normalizeIdentityEmail(input.email)
    const ds = storage()
    const account = await ds.getRepository(IdentityEmailAccountDO).findOneBy({ email, status: 'active' })
    if (!account) throw new Error('IDENTITY_EMAIL_ACCOUNT_NOT_FOUND')
    const challengeId = id('iea')
    const code = String(randomInt(100000, 1000000))
    const createdAt = now()
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
    const challenge = new IdentityEmailAuthChallengeDO()
    Object.assign(challenge, { challengeId, email, identityDid: account.identityDid, registrationId: '', purpose: 'login', codeHash: hashCode(challengeId, code), passkeyRequestJson: '{}', attempts: 0, status: 'pending', createdAt, expiresAt, consumedAt: '' })
    await ds.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
    try { await this.delivery({ email, code, expiresAt, purpose: 'login' }) } catch (error) { await ds.getRepository(IdentityEmailAuthChallengeDO).delete({ challengeId }); throw error }
    return { verificationId: challengeId, email, expiresAt }
  }

  async confirmLogin(input: { verificationId: unknown; code: unknown }) {
    const ds = storage()
    const challengeId = String(input.verificationId || '').trim()
    const challenge = await ds.getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId, purpose: 'login' })
    if (!challenge) throw new Error('IDENTITY_EMAIL_VERIFICATION_NOT_FOUND')
    if (challenge.status !== 'pending' || Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('IDENTITY_EMAIL_VERIFICATION_EXPIRED')
    challenge.attempts += 1
    if (challenge.attempts > MAX_ATTEMPTS || hashCode(challengeId, String(input.code || '').trim()) !== challenge.codeHash) {
      if (challenge.attempts >= MAX_ATTEMPTS) challenge.status = 'expired'
      await ds.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
      throw new Error('IDENTITY_EMAIL_VERIFICATION_INVALID')
    }
    challenge.status = 'completed'
    challenge.consumedAt = now()
    await ds.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
    return { identity: challenge.identityDid, email: challenge.email, verifiedAt: challenge.consumedAt }
  }
}
