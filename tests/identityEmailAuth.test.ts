import { vi, describe, it, expect, beforeEach } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { CustodyKeyRecordDO, IdentityAccountLinkDO, IdentityEmailAccountDO, IdentityEmailAuthChallengeDO, IdentityPasskeyCredentialDO, IdentityRegistrationDO, IdentityUsernameDO } from '../src/domain/mapper/entity'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

const identity = 'did:yeying:wid_email_auth_123456789012345678'
let registrationSequence = 0

vi.mock('../src/auth/identityIssuer', () => ({
  issueIdentityCredential: vi.fn(({ credentialId, subject, type, claim }: any) => {
    const now = Math.floor(Date.now() / 1000)
    return `header.${Buffer.from(JSON.stringify({ iat: now, exp: now + 3600, sub: subject, vc: { type: ['VerifiableCredential', type], credentialSubject: { id: subject, ...claim } } })).toString('base64url')}.signature`
  })
}))

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => key === 'issuer.identity.usernameNamespace' ? 'node.yeying.pub' : undefined
}))

vi.mock('../src/domain/service/identityAuthorization', () => ({
  IdentityAuthorizationService: class {
    async createInitialIdentityRegistration() {
      const registrationId = `idr_test_${++registrationSequence}`
      const registration = Object.assign(new IdentityRegistrationDO(), {
        registrationId, identityDid: identity, identityDocumentHash: 'hash', status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), activatedAt: ''
      })
      await SingletonDataSource.get().getRepository(IdentityRegistrationDO).save(registration)
      return { registrationId, identity, deviceName: 'Browser Passkey', passkeyRequest: { challenge: `challenge-${registrationId}` } }
    }
  }
}))

beforeEach(() => {
  registrationSequence = 0
  SingletonDataSource.set(createInMemoryDataSource())
})
const { IdentityEmailAuthService } = await import('../src/domain/service/identityEmailAuth')

describe('identity email authentication', () => {
  it('normalizes email and completes a registration with a DID-bound account', async () => {
    let code = ''
    const service = new IdentityEmailAuthService(async input => { code = input.code })
    const requested = await service.requestRegister({ email: ' Alice@Example.com ', username: 'Alice', avatar: 'https://example.com/alice.png', identityDocument: { id: identity } })
    expect(requested.email).toBe('alice@example.com')
    const verified = await service.confirmRegister({ verificationId: requested.verificationId, code })
    expect(verified.identity).toBe(identity)
    await SingletonDataSource.get().getRepository(IdentityRegistrationDO).update({ registrationId: requested.registrationId }, { status: 'active' })
    await SingletonDataSource.get().getRepository(IdentityPasskeyCredentialDO).save(Object.assign(new IdentityPasskeyCredentialDO(), { identityDid: identity, credentialId: 'passkey_test', revokedAt: '' }))
    const account = '0x1111111111111111111111111111111111111111'
    await SingletonDataSource.get().getRepository(IdentityAccountLinkDO).save(Object.assign(new IdentityAccountLinkDO(), { identityDid: identity, chainKey: 'eip155:1', accountId: account, status: 'active', revokedAt: '', verifiedAt: new Date().toISOString() }))
    const completeInput = { verificationId: requested.verificationId, registrationId: requested.registrationId, accountLink: { account: { chainKey: 'eip155:1', address: account } }, custody: { walletId: 'wallet_test', accountId: 'wallet_test_0', ciphertext: 'encrypted-wallet-material' } }
    await expect(service.completeRegister({ ...completeInput, custody: { ...completeInput.custody, ciphertext: '' } })).rejects.toThrow('IDENTITY_CUSTODY_REQUIRED')
    const completed = await service.completeRegister(completeInput)
    expect(completed).toMatchObject({ identity })
    expect(completed.credentials.map((credential: any) => credential.credentialType).sort()).toEqual(['AvatarCredential', 'EmailCredential', 'UsernameCredential'])
    await expect(service.completeRegister(completeInput)).rejects.toThrow('IDENTITY_EMAIL_REGISTRATION_INVALID')
    expect(await SingletonDataSource.get().getRepository(IdentityEmailAccountDO).findOneBy({ email: 'alice@example.com' })).toMatchObject({ identityDid: identity, status: 'active' })
  })

  it('issues a one-time login code and rejects invalid or replayed codes', async () => {
    await SingletonDataSource.get().getRepository(IdentityEmailAccountDO).save(Object.assign(new IdentityEmailAccountDO(), {
      email: 'alice@example.com', identityDid: identity, status: 'active', createdAt: new Date().toISOString(), verifiedAt: new Date().toISOString()
    }))
    let code = ''
    const service = new IdentityEmailAuthService(async input => { code = input.code })
    const requested = await service.requestLogin({ email: 'alice@example.com' })
    await expect(service.confirmLogin({ verificationId: requested.verificationId, code: '000000' })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_INVALID')
    const result = await service.confirmLogin({ verificationId: requested.verificationId, code })
    expect(result.identity).toBe(identity)
    await expect(service.confirmLogin({ verificationId: requested.verificationId, code })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_EXPIRED')
    expect(await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })).toMatchObject({ status: 'completed' })
  })

  it('resends a registration code on the same challenge and invalidates the previous code', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z'))
    try {
      const deliveredCodes: string[] = []
      const service = new IdentityEmailAuthService(async input => { deliveredCodes.push(input.code) })
      const requested = await service.requestRegister({ email: 'resend@example.com', username: 'resend_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })
      const initialChallenge = await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })

      await expect(service.resendRegister({ verificationId: requested.verificationId })).rejects.toThrow('IDENTITY_EMAIL_RESEND_RATE_LIMITED')
      vi.setSystemTime(new Date(Date.now() + 60_000))
      const resent = await service.resendRegister({ verificationId: requested.verificationId })
      const rotatedChallenge = await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })

      expect(resent).toMatchObject({ verificationId: requested.verificationId, email: requested.email, resendsRemaining: 4 })
      expect(rotatedChallenge).toMatchObject({ registrationId: initialChallenge?.registrationId, identityDid: initialChallenge?.identityDid, attempts: 0, resendCount: 1 })
      expect(rotatedChallenge?.codeHash).not.toBe(initialChallenge?.codeHash)
      await expect(service.confirmRegister({ verificationId: requested.verificationId, code: deliveredCodes[0] })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_INVALID')
      await expect(service.confirmRegister({ verificationId: requested.verificationId, code: deliveredCodes[1] })).resolves.toMatchObject({
        registrationId: requested.registrationId,
        identity: requested.identity,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops resending after five rotations', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z'))
    try {
      const service = new IdentityEmailAuthService(async () => undefined)
      const requested = await service.requestRegister({ email: 'limit@example.com', username: 'limit_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })
      for (let resend = 0; resend < 5; resend += 1) {
        vi.setSystemTime(new Date(Date.now() + 60_000))
        await service.resendRegister({ verificationId: requested.verificationId })
      }
      vi.setSystemTime(new Date(Date.now() + 60_000))

      await expect(service.resendRegister({ verificationId: requested.verificationId })).rejects.toThrow('IDENTITY_EMAIL_RESEND_LIMIT_REACHED')
      expect(await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })).toMatchObject({ resendCount: 5, status: 'pending' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires the registration after five incorrect codes', async () => {
    const service = new IdentityEmailAuthService(async () => undefined)
    const requested = await service.requestRegister({ email: 'attempts@example.com', username: 'attempts_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(service.confirmRegister({ verificationId: requested.verificationId, code: '000000' })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_INVALID')
    }
    await expect(service.confirmRegister({ verificationId: requested.verificationId, code: '000000' })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_EXPIRED')
    expect(await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })).toMatchObject({ status: 'expired', attempts: 5 })
    expect(await SingletonDataSource.get().getRepository(IdentityRegistrationDO).findOneBy({ registrationId: requested.registrationId })).toMatchObject({ status: 'expired' })
    expect(await SingletonDataSource.get().getRepository(IdentityUsernameDO).findOneBy({ normalizedUsername: 'attempts_user' })).toMatchObject({ status: 'expired' })
  })

  it('expires the registration and releases only its own username when resend delivery fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z'))
    try {
      let failDelivery = false
      const service = new IdentityEmailAuthService(async () => {
        if (failDelivery) throw new Error('mail unavailable')
      })
      const requested = await service.requestRegister({ email: 'failure@example.com', username: 'failure_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })
      const other = await service.requestRegister({ email: 'other@example.com', username: 'other_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })
      vi.setSystemTime(new Date(Date.now() + 60_000))
      failDelivery = true

      await expect(service.resendRegister({ verificationId: requested.verificationId })).rejects.toThrow('IDENTITY_EMAIL_DELIVERY_FAILED')
      expect(await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })).toMatchObject({ status: 'expired' })
      expect(await SingletonDataSource.get().getRepository(IdentityRegistrationDO).findOneBy({ registrationId: requested.registrationId })).toMatchObject({ status: 'expired' })
      expect(await SingletonDataSource.get().getRepository(IdentityUsernameDO).findOneBy({ normalizedUsername: 'failure_user' })).toMatchObject({ status: 'expired' })
      expect(await SingletonDataSource.get().getRepository(IdentityUsernameDO).findOneBy({ normalizedUsername: 'other_user' })).toMatchObject({ identityDid: other.identity, status: 'reserved' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels an unfinished registration and preserves other username reservations', async () => {
    const service = new IdentityEmailAuthService(async () => undefined)
    const first = await service.requestRegister({ email: 'first@example.com', username: 'first_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })
    const second = await service.requestRegister({ email: 'second@example.com', username: 'second_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })

    await expect(service.cancelRegister({ verificationId: first.verificationId })).resolves.toEqual({ cancelled: true })
    expect(await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: first.verificationId })).toMatchObject({ status: 'cancelled' })
    expect(await SingletonDataSource.get().getRepository(IdentityRegistrationDO).findOneBy({ registrationId: first.registrationId })).toMatchObject({ status: 'expired' })
    expect(await SingletonDataSource.get().getRepository(IdentityUsernameDO).findOneBy({ normalizedUsername: 'first_user' })).toMatchObject({ status: 'expired' })
    expect(await SingletonDataSource.get().getRepository(IdentityUsernameDO).findOneBy({ normalizedUsername: 'second_user' })).toMatchObject({ identityDid: second.identity, status: 'reserved' })
  })

  it('cleans up an expired challenge and releases its username reservation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z'))
    try {
      const service = new IdentityEmailAuthService(async () => undefined)
      const requested = await service.requestRegister({ email: 'expired@example.com', username: 'expired_user', avatar: 'https://example.com/avatar.png', identityDocument: { id: identity } })
      vi.setSystemTime(new Date(Date.now() + 10 * 60_000))

      await expect(service.resendRegister({ verificationId: requested.verificationId })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_EXPIRED')
      expect(await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })).toMatchObject({ status: 'expired' })
      expect(await SingletonDataSource.get().getRepository(IdentityRegistrationDO).findOneBy({ registrationId: requested.registrationId })).toMatchObject({ status: 'expired' })
      expect(await SingletonDataSource.get().getRepository(IdentityUsernameDO).findOneBy({ normalizedUsername: 'expired_user' })).toMatchObject({ status: 'expired', reservedUntil: '' })
    } finally {
      vi.useRealTimers()
    }
  })
})
