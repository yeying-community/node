import { createHash, randomInt, randomUUID } from 'node:crypto'
import { IdentityAuthorizationService } from './identityAuthorization'
import { SingletonDataSource } from '../facade/datasource'
import { CustodyKeyRecordDO, IdentityAccountLinkDO, IdentityAuditLogDO, IdentityCredentialDO, IdentityEmailAccountDO, IdentityEmailAuthChallengeDO, IdentityPasskeyCredentialDO, IdentityRegistrationDO, IdentityUsernameDO, UserDO } from '../mapper/entity'
import { issueIdentityCredential } from '../../auth/identityIssuer'
import { getConfig } from '../../config/runtime'

type Delivery = (input: { email: string; code: string; expiresAt: string; purpose: 'register' | 'login' }) => Promise<void>
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
const NAMESPACE = String(getConfig<string>('issuer.identity.usernameNamespace') || 'node.yeying.pub')

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

function normalizeUsername(value: unknown) {
  const username = String(value || '').trim().normalize('NFC').toLowerCase()
  if (!USERNAME_RE.test(username)) throw new Error('IDENTITY_USERNAME_INVALID')
  return username
}

function normalizeAvatar(value: unknown) {
  const avatar = String(value || '').trim()
  if (!avatar || avatar.length > 2048) throw new Error('IDENTITY_AVATAR_INVALID')
  if (avatar.startsWith('ipfs://')) return avatar
  let parsed: URL
  try { parsed = new URL(avatar) } catch { throw new Error('IDENTITY_AVATAR_INVALID') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('IDENTITY_AVATAR_INVALID')
  parsed.hash = ''
  return parsed.toString()
}

function credentialPayload(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
}

function issueProfileCredential(identity: string, type: 'UsernameCredential' | 'AvatarCredential', claim: Record<string, unknown>, challengeId: string, verifiedAt: string) {
  const credentialId = `urn:yeying:credential:${type === 'UsernameCredential' ? 'username' : 'avatar'}:${challengeId}`
  const credential = issueIdentityCredential({ credentialId, subject: identity, type, claim: { ...claim, credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' } } })
  const payload = credentialPayload(credential)
  const row = new IdentityCredentialDO()
  Object.assign(row, { credentialId, identityDid: identity, credentialType: type, token: credential, status: 'active', issuedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString(), revokedAt: '' })
  return { credentialId, credential, row, verifiedAt }
}

export class IdentityEmailAuthService {
  private readonly identityAuthorization = new IdentityAuthorizationService()

  constructor(private readonly delivery: Delivery) {}

  async requestRegister(input: { email: unknown; username: unknown; avatar: unknown; identityDocument: any; deviceName?: unknown }) {
    const email = normalizeIdentityEmail(input.email)
    const username = normalizeUsername(input.username)
    const avatarUri = normalizeAvatar(input.avatar)
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
      username,
      avatarUri,
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
    await ds.transaction(async manager => {
      const usernameRepo = manager.getRepository(IdentityUsernameDO)
      const existing = await usernameRepo.findOneBy({ namespace: NAMESPACE, normalizedUsername: username })
      const expired = existing?.status === 'expired' || (existing?.status === 'reserved' && Date.parse(existing.reservedUntil) <= Date.now())
      if (existing && existing.identityDid !== registration.identity && !expired) throw new Error('IDENTITY_USERNAME_TAKEN')
      if (existing) {
        await usernameRepo.update({ uid: existing.uid }, { identityDid: registration.identity, status: 'reserved', reservedUntil: expiresAt, updatedAt: createdAt })
      } else {
        const usernameRow = new IdentityUsernameDO()
        Object.assign(usernameRow, { namespace: NAMESPACE, normalizedUsername: username, identityDid: registration.identity, status: 'reserved', reservedUntil: expiresAt, createdAt, updatedAt: createdAt })
        await usernameRepo.save(usernameRow)
      }
      await manager.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
    })
    try {
      await this.delivery({ email, code, expiresAt, purpose: 'register' })
    } catch (error) {
      await ds.getRepository(IdentityEmailAuthChallengeDO).delete({ challengeId })
      await ds.getRepository(IdentityUsernameDO).update({ namespace: NAMESPACE, normalizedUsername: username, identityDid: registration.identity, status: 'reserved' }, { status: 'expired', reservedUntil: '', updatedAt: now() })
      throw error
    }
    return { verificationId: challengeId, email, username, avatarUri, identity: registration.identity, registrationId: registration.registrationId, expiresAt }
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

  async completeRegister(input: { verificationId: unknown; registrationId: unknown; accountLink?: any; custody?: any }) {
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
      const accountLink = input.accountLink || {}
      const accountInput = accountLink.account || {}
      const chainKey = String(accountInput.chainKey || '').trim()
      const address = String(accountInput.address || '').trim().toLowerCase()
      if (chainKey !== 'eip155:1' || !/^0x[0-9a-f]{40}$/.test(address)) throw new Error('IDENTITY_ACCOUNT_PROOF_REQUIRED')
      const link = await manager.getRepository(IdentityAccountLinkDO).findOneBy({ identityDid: challenge.identityDid, chainKey, accountId: address, status: 'active', revokedAt: '' })
      if (!link) throw new Error('IDENTITY_ACCOUNT_PROOF_REQUIRED')
      const passkeys = await manager.getRepository(IdentityPasskeyCredentialDO).findBy({ identityDid: challenge.identityDid })
      if (!passkeys.some(item => !String(item.revokedAt || '').trim())) throw new Error('IDENTITY_PASSKEY_REQUIRED')
      const custody = input.custody || {}
      const walletId = String(custody.walletId || '').trim()
      const accountId = String(custody.accountId || '').trim()
      const ciphertext = String(custody.ciphertext || '').trim()
      if (!walletId || !accountId) throw new Error('IDENTITY_CUSTODY_REQUIRED')
      if (walletId.length > 128 || accountId.length > 128 || ciphertext.length > 8 * 1024 * 1024) throw new Error('IDENTITY_CUSTODY_INVALID')
      const verifiedAt = now()
      const credentialId = `urn:yeying:credential:email:${challenge.challengeId}`
      const credential = issueIdentityCredential({ credentialId, subject: challenge.identityDid, type: 'EmailCredential', claim: { email: challenge.email, emailVerifiedAt: verifiedAt, emailVerificationMethod: 'email-code-v1', credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' } } })
      const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString())
      const emailAccount = new IdentityEmailAccountDO()
      Object.assign(emailAccount, { email: challenge.email, identityDid: challenge.identityDid, status: 'active', createdAt: verifiedAt, verifiedAt })
      const row = new IdentityCredentialDO()
      Object.assign(row, { credentialId, identityDid: challenge.identityDid, credentialType: 'EmailCredential', token: credential, status: 'active', issuedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString(), revokedAt: '' })
      challenge.status = 'completed'
      challenge.consumedAt = verifiedAt
      const audit = new IdentityAuditLogDO()
      Object.assign(audit, { identityDid: challenge.identityDid, action: 'identity_email_registered', outcome: 'success', metadataJson: JSON.stringify({ email: challenge.email, credentialId }), createdAt: verifiedAt })
      const usernameRow = await manager.getRepository(IdentityUsernameDO).findOneBy({ namespace: NAMESPACE, normalizedUsername: challenge.username, identityDid: challenge.identityDid, status: 'reserved' })
      if (!usernameRow) throw new Error('IDENTITY_USERNAME_RESERVATION_INVALID')
      await manager.getRepository(IdentityUsernameDO).update({ uid: usernameRow.uid }, { status: 'active', reservedUntil: '', updatedAt: verifiedAt })
      const usernameCredential = issueProfileCredential(challenge.identityDid, 'UsernameCredential', { username: challenge.username, usernameQualified: `${challenge.username}@${NAMESPACE}`, usernamePolicyVersion: 'v1' }, challenge.challengeId, verifiedAt)
      const avatarCredential = issueProfileCredential(challenge.identityDid, 'AvatarCredential', { avatarUri: challenge.avatarUri, avatarVerifiedAt: verifiedAt, avatarVerificationMethod: 'email-registration-v1' }, challenge.challengeId, verifiedAt)
      const user = await manager.getRepository(UserDO).findOneBy({ did: challenge.identityDid }) || new UserDO()
      Object.assign(user, { did: challenge.identityDid, name: challenge.username, avatar: challenge.avatarUri, createdAt: user.createdAt || verifiedAt, updatedAt: verifiedAt, signature: user.signature || '' })
      const custodyRow = new CustodyKeyRecordDO()
      Object.assign(custodyRow, { subjectType: 'wallet_address', subjectId: address, walletId, accountId, address, ciphertext, metadataJson: JSON.stringify(custody.metadata && typeof custody.metadata === 'object' ? custody.metadata : { version: 2, walletType: 'imported', accountCount: 1, identityCount: 1, hasWalletIdentity: true }), createdAt: verifiedAt, updatedAt: verifiedAt, lastVerifiedAt: verifiedAt })
      await manager.getRepository(IdentityEmailAccountDO).save(emailAccount)
      await manager.getRepository(IdentityCredentialDO).save(row)
      await manager.getRepository(IdentityCredentialDO).save(usernameCredential.row)
      await manager.getRepository(IdentityCredentialDO).save(avatarCredential.row)
      await manager.getRepository(UserDO).save(user)
      await manager.getRepository(CustodyKeyRecordDO).save(custodyRow)
      await manager.getRepository(IdentityEmailAuthChallengeDO).save(challenge)
      await manager.getRepository(IdentityAuditLogDO).save(audit)
      const credentials = await manager.getRepository(IdentityCredentialDO).findBy({ identityDid: challenge.identityDid, status: 'active', revokedAt: '' })
      return { identity: challenge.identityDid, email: challenge.email, username: challenge.username, avatarUri: challenge.avatarUri, verifiedAt, credentials }
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
