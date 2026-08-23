import { createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { vi } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'
import { IdentityAuditLogDO, IdentityCredentialDO, IdentityPasskeyCredentialDO, IdentityTotpAuthenticatorDO, IdentityWebauthnChallengeDO } from '../src/domain/mapper/entity'

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => ({
    'identity.publicBaseUrl': 'http://localhost:8100',
    'identity.totp.issuerName': 'YeYing Node',
    'identity.webauthn.enabled': true,
    'identity.webauthn.rpId': 'localhost',
    'identity.webauthn.rpName': 'YeYing Node',
    'identity.webauthn.origin': 'http://localhost:8100',
    'identity.webauthn.timeoutMs': 60_000,
    'identity.webauthn.challengeTtlMs': 120_000
  } as Record<string, unknown>)[key]
}))

vi.mock('../src/security/secretVault', () => ({
  getDerivedRuntimeSecret: () => '11'.repeat(32)
}))

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: { id: 'credential-extension-1', publicKey: Buffer.from('public-key'), counter: 0 },
      aaguid: ''
    }
  }))
}))

vi.mock('../src/domain/service/application', () => ({
  ApplicationService: class {
    async queryByUid(uid: string) { return uid === 'project' ? { uid, name: 'Project', redirectUris: 'https://project.example/auth/callback' } : null }
    async search() {
      return {
        data: [
          { uid: 'wallet', name: 'Wallet', redirectUris: 'chrome-extension://lklhmjkaigpbnfchejbkmkfpkibmnjgf' },
          { uid: 'project', name: 'Project', redirectUris: 'https://project.example/auth/callback' }
        ],
        page: { page: 1, pageSize: 1000, total: 2 }
      }
    }
  }
}))

SingletonDataSource.set(createInMemoryDataSource())

const identity = 'did:yeying:wid_1234567890123456789012'
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const document = {
  version: 1, id: identity, walletIdentityId: identity.slice('did:yeying:'.length), createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', revision: 1,
  controllers: [{ controllerId: 'controller-1', kind: 'wallet_key', publicKey: (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64url'), algorithm: 'Ed25519', purposes: ['authentication', 'assertion', 'manage'], status: 'active' }], accounts: [], issuers: [], recovery: { version: 1, manageThreshold: 1, controllerChangeDelaySeconds: 86400 }
}
function canonicalize(value: any): string { if (value === null) return 'null'; if (typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`; return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}` }
function presentation(request: any, overrides: Record<string, unknown> = {}) {
  const unsigned: any = { version: 1, holder: identity, audience: request.audience, nonce: request.nonce, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), scopes: request.scopes, identityDocument: document }
  Object.assign(unsigned, overrides)
  return { ...unsigned, proof: { type: 'YeyingIdentityPresentationProofV1', verificationMethod: `${identity}#controller-1`, purpose: 'authentication', proofValue: sign(null, Buffer.from(canonicalize(unsigned)), privateKey).toString('base64url') } }
}
function signedIdentityDocument() {
  return { ...document, proof: { type: 'YeyingIdentityDocumentProofV1', verificationMethod: `${identity}#controller-1`, purpose: 'manage', proofValue: sign(null, Buffer.from(canonicalize(document)), privateKey).toString('base64url') } }
}

const { IdentityAuthorizationService } = await import('../src/domain/service/identityAuthorization')
const { IdentityTotpService, getIdentityTotpStatus } = await import('../src/auth/identityTotpAuth')
const { verifyRegistrationResponse } = await import('@simplewebauthn/server')

function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let current = 0
  const output: number[] = []
  for (const char of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(char)
    if (index < 0) continue
    current = (current << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

function totpCode(secretBase32: string, nowMs = Date.now()) {
  const secret = base32Decode(secretBase32)
  const counter = Math.floor(nowMs / 30_000)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000) >>> 0, 0)
  counterBuffer.writeUInt32BE((counter % 0x100000000) >>> 0, 4)
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

describe('identity authorization', () => {
  it('exchanges a DID presentation once and returns only requested credentials', async () => {
    const service = new IdentityAuthorizationService()
    const verifier = 'a'.repeat(43)
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    const request = await service.create({ appId: 'project', redirectUri: 'https://project.example/auth/callback', codeChallenge: challenge, codeChallengeMethod: 'S256', scopes: ['identity.email'] })
    await SingletonDataSource.get()!.getRepository(IdentityCredentialDO).save(Object.assign(new IdentityCredentialDO(), { credentialId: 'email-1', identityDid: identity, credentialType: 'EmailCredential', token: 'credential', status: 'active', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: '' }))
    const approved = await service.approve({ requestId: request.requestId, presentation: presentation(request) })
    const exchanged = await service.exchange({ code: approved.authorizationCode, appId: 'project', redirectUri: 'https://project.example/auth/callback', codeVerifier: verifier })
    expect(exchanged.did).toBe(identity)
    expect(exchanged.credentials).toEqual([{ type: 'EmailCredential', credentialId: 'email-1', credential: 'credential' }])
    await expect(service.exchange({ code: approved.authorizationCode, appId: 'project', redirectUri: 'https://project.example/auth/callback', codeVerifier: verifier })).rejects.toThrow('IDENTITY_AUTHORIZATION_CODE_INVALID')
  })

  it('rejects a presentation bound to another audience', async () => {
    const service = new IdentityAuthorizationService()
    const request = await service.create({ appId: 'project', redirectUri: 'https://project.example/auth/callback', codeChallenge: 'b'.repeat(43), codeChallengeMethod: 'S256', scopes: ['identity.basic'] })
    await expect(service.approve({ requestId: request.requestId, presentation: presentation(request, { audience: 'https://other.example' }) })).rejects.toThrow('IDENTITY_PRESENTATION_CONTEXT_INVALID')
  })

  it('lists and revokes wallet identity passkey credentials', async () => {
    const service = new IdentityAuthorizationService()
    await SingletonDataSource.get()!.getRepository(IdentityPasskeyCredentialDO).save(Object.assign(new IdentityPasskeyCredentialDO(), {
      identityDid: identity,
      credentialId: 'credential-1',
      publicKey: 'public-key',
      signCount: '0',
      aaguid: '',
      transports: JSON.stringify(['internal']),
      deviceName: 'Mac Touch ID',
      rpId: 'localhost',
      userHandle: identity,
      createdAt: '2026-08-22T00:00:00.000Z',
      lastUsedAt: '',
      revokedAt: ''
    }))
    const listed = await service.listPasskeyCredentials({ identity })
    expect(listed.credentials).toMatchObject([{ credentialId: 'credential-1', deviceName: 'Mac Touch ID', transports: ['internal'], revokedAt: '' }])
    const revoked = await service.revokePasskeyCredential({ identity, identityDocument: signedIdentityDocument(), credentialId: 'credential-1' })
    expect(revoked.credentialId).toBe('credential-1')
    expect(revoked.revokedAt).toBeTruthy()
    const after = await service.listPasskeyCredentials({ identity })
    expect(after.credentials[0].revokedAt).toBeTruthy()
  })

  it('sets up, confirms, verifies, and revokes wallet identity TOTP', async () => {
    const service = new IdentityTotpService()
    const setup = await service.setup({ identity, identityDocument: signedIdentityDocument(), deviceName: '1Password' })
    expect(setup.totp.secret).toBeTruthy()
    expect(setup.totp.otpauthUri).toContain('otpauth://totp/')

    const code = totpCode(setup.totp.secret)
    const confirmed = await service.confirm({ identity, code })
    expect(confirmed.totp.enabled).toBe(true)
    expect(confirmed.totp.deviceName).toBe('1Password')

    const verified = await service.verify({ identity, code })
    expect(verified.verified).toBe(true)

    const row = await SingletonDataSource.get()!.getRepository(IdentityTotpAuthenticatorDO).findOneBy({ identityDid: identity })
    expect(row?.secretCiphertext).not.toContain(setup.totp.secret)

    const revoked = await service.revoke({ identity, identityDocument: signedIdentityDocument() })
    expect(revoked.totp.status).toBe('revoked')
    await expect(service.verify({ identity, code })).rejects.toMatchObject({ code: 'IDENTITY_TOTP_NOT_ENABLED' })

    const auditLogs = await SingletonDataSource.get()!.getRepository(IdentityAuditLogDO).findBy({ identityDid: identity })
    expect(auditLogs.map(item => item.action)).toEqual(expect.arrayContaining([
      'identity_totp_setup_created',
      'identity_totp_confirmed',
      'identity_totp_verified',
      'identity_totp_revoked'
    ]))
    expect(auditLogs.map(item => item.metadataJson).join('\n')).not.toContain(setup.totp.secret)
  })

  it('keeps wallet identity TOTP enabled by default when the derived secret is ready', () => {
    expect(getIdentityTotpStatus()).toMatchObject({
      enabled: true,
      ready: true,
      issuerName: 'YeYing Node',
      digits: 6,
      period: 30,
      algorithm: 'SHA1'
    })
  })

  it('accepts a published wallet extension origin for passkey registration', async () => {
    const service = new IdentityAuthorizationService()
    await SingletonDataSource.get()!.getRepository(IdentityWebauthnChallengeDO).save(Object.assign(new IdentityWebauthnChallengeDO(), {
      challengeId: 'iwc-extension',
      challengeType: 'identity-register',
      identityDid: identity,
      requestId: '',
      challenge: 'challenge-extension',
      allowedCredentialIds: '[]',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      used: false
    }))
    const clientDataJSON = Buffer.from(JSON.stringify({
      type: 'webauthn.create',
      challenge: 'challenge-extension',
      origin: 'chrome-extension://lklhmjkaigpbnfchejbkmkfpkibmnjgf'
    })).toString('base64url')

    const result = await service.confirmPasskeyRegistration({
      identity,
      requestId: 'iwc-extension',
      deviceName: 'Wallet extension',
      credential: {
        id: 'credential-extension-1',
        rawId: 'credential-extension-1',
        type: 'public-key',
        response: { clientDataJSON, transports: ['internal'] }
      }
    })

    expect(result.credentialId).toBe('credential-extension-1')
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedOrigin: 'chrome-extension://lklhmjkaigpbnfchejbkmkfpkibmnjgf',
      expectedRPID: 'localhost'
    }))
  })
})
