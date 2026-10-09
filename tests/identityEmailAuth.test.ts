import { vi, describe, it, expect } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { CustodyKeyRecordDO, IdentityAccountLinkDO, IdentityEmailAccountDO, IdentityEmailAuthChallengeDO, IdentityPasskeyCredentialDO, IdentityRegistrationDO } from '../src/domain/mapper/entity'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

const identity = 'did:yeying:wid_email_auth_123456789012345678'

vi.mock('../src/auth/identityIssuer', () => ({
  issueIdentityCredential: vi.fn(({ credentialId, subject, type, claim }: any) => {
    const now = Math.floor(Date.now() / 1000)
    return `header.${Buffer.from(JSON.stringify({ iat: now, exp: now + 3600, sub: subject, vc: { type: ['VerifiableCredential', type], credentialSubject: { id: subject, ...claim } } })).toString('base64url')}.signature`
  })
}))

vi.mock('../src/domain/service/identityAuthorization', () => ({
  IdentityAuthorizationService: class {
    async createInitialIdentityRegistration() {
      const registration = Object.assign(new IdentityRegistrationDO(), {
        registrationId: 'idr_test', identityDid: identity, identityDocumentHash: 'hash', status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), activatedAt: ''
      })
      await SingletonDataSource.get().getRepository(IdentityRegistrationDO).save(registration)
      return { registrationId: 'idr_test', identity, deviceName: 'Browser Passkey', passkeyRequest: { challenge: 'challenge' } }
    }
  }
}))

SingletonDataSource.set(createInMemoryDataSource())
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
    let code = ''
    const service = new IdentityEmailAuthService(async input => { code = input.code })
    const requested = await service.requestLogin({ email: 'alice@example.com' })
    await expect(service.confirmLogin({ verificationId: requested.verificationId, code: '000000' })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_INVALID')
    const result = await service.confirmLogin({ verificationId: requested.verificationId, code })
    expect(result.identity).toBe(identity)
    await expect(service.confirmLogin({ verificationId: requested.verificationId, code })).rejects.toThrow('IDENTITY_EMAIL_VERIFICATION_EXPIRED')
    expect(await SingletonDataSource.get().getRepository(IdentityEmailAuthChallengeDO).findOneBy({ challengeId: requested.verificationId })).toMatchObject({ status: 'completed' })
  })
})
