import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { vi } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'
import { IdentityCredentialDO } from '../src/domain/mapper/entity'

const seed = '11'.repeat(32)
vi.mock('../src/security/secretVault', () => ({
  getRuntimeSecret: (name: string) => name === 'ISSUER_PRIVATE_KEY' ? seed : ''
}))
vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => ({ 'issuer.baseUrl': 'https://node.example' } as Record<string, unknown>)[key]
}))

const { getIdentityIssuerJwks, getIdentityIssuerMetadata, issueIdentityCredential, getCredentialStatus, revokeCredential, createCredentialReissueChallenge, confirmCredentialReissue } =
  await import('../src/auth/identityIssuer')

function canonicalize(value: any): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
}

describe('identity issuer foundation', () => {
  it('publishes Ed25519 JWKS metadata and signs JWT-VC', () => {
    const metadata = getIdentityIssuerMetadata()
    expect(metadata).toEqual({
      issuer: 'did:web:node.example',
      jwks_uri: 'https://node.example/.well-known/jwks.json',
      credential_status_uri: 'https://node.example/api/v1/public/identity/credentials/status',
      credential_reissue_challenge_uri: 'https://node.example/api/v1/public/identity/credentials/reissue/challenge',
      credential_reissue_confirm_uri: 'https://node.example/api/v1/public/identity/credentials/reissue/confirm'
    })
    const jwk = getIdentityIssuerJwks().keys[0]
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' })
    expect(jwk.kid).toMatch(/^ed25519-[A-Za-z0-9_-]{43}$/)

    const token = issueIdentityCredential({
      credentialId: 'cred_email_1',
      subject: 'did:yeying:wid_test',
      type: 'EmailCredential',
      claim: { email: 'alice@example.com', email_verified: true },
      expiresInSeconds: 999999
    })
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString())
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString())
    expect(header).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: jwk.kid })
    expect(payload.vc.type).toContain('EmailCredential')
    expect(payload.exp - payload.iat).toBe(7 * 86400)

    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' })
    expect(verify(null, Buffer.from(`${encodedHeader}.${encodedPayload}`), createPublicKey(privateKey), Buffer.from(encodedSignature, 'base64url'))).toBe(true)
  })

  it('fails closed when credential storage is unavailable', async () => {
    await expect(getCredentialStatus('cred_email_1')).rejects.toThrow('IDENTITY_STORAGE_UNAVAILABLE')
    await expect(revokeCredential('cred_email_1')).rejects.toThrow('IDENTITY_STORAGE_UNAVAILABLE')
  })

  it('reissues credentials from an existing verified fact with controller proof', async () => {
    SingletonDataSource.set(createInMemoryDataSource())
    const identity = 'did:yeying:wid_1234567890123456789012'
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const publicKeyBytes = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64url')
    const document = {
      version: 1,
      id: identity,
      walletIdentityId: identity.slice('did:yeying:'.length),
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      revision: 1,
      controllers: [{ controllerId: 'controller-1', kind: 'wallet_key', publicKey: publicKeyBytes, algorithm: 'Ed25519', purposes: ['authentication', 'assertion', 'manage'], status: 'active' }],
      accounts: [],
      issuers: [],
      recovery: { version: 1, manageThreshold: 1, controllerChangeDelaySeconds: 86400 }
    }
    const identityDocument = {
      ...document,
      proof: { type: 'YeyingIdentityDocumentProofV1', verificationMethod: `${identity}#controller-1`, purpose: 'manage', proofValue: sign(null, Buffer.from(canonicalize(document)), privateKey).toString('base64url') }
    }
    const expiredCredential = issueIdentityCredential({
      credentialId: 'email-expired-1',
      subject: identity,
      type: 'EmailCredential',
      claim: { email: 'alice@example.com', emailVerifiedAt: '2026-08-20T00:00:00.000Z', credentialStatus: { id: 'email-expired-1', type: 'YeyingCredentialStatusV1' } },
      expiresInSeconds: 60
    })
    await SingletonDataSource.get()!.getRepository(IdentityCredentialDO).save(Object.assign(new IdentityCredentialDO(), {
      credentialId: 'email-expired-1',
      identityDid: identity,
      credentialType: 'EmailCredential',
      token: expiredCredential,
      status: 'active',
      issuedAt: '2026-08-20T00:00:00.000Z',
      expiresAt: '2026-08-20T00:01:00.000Z',
      revokedAt: ''
    }))

    const challenge = await createCredentialReissueChallenge({ identity, credentialTypes: ['EmailCredential'] })
    const proof = { type: 'YeyingCredentialReissueProofV1', verificationMethod: `${identity}#controller-1`, purpose: 'authentication', proofValue: sign(null, Buffer.from(challenge.signingInput), privateKey).toString('base64url') }
    const result = await confirmCredentialReissue({ identity, challengeId: challenge.challengeId, identityDocument, proof })

    expect(result.credentials).toHaveLength(1)
    expect(result.credentials[0].credentialId).toContain('urn:yeying:credential:reissue:email:')
    const payload = JSON.parse(Buffer.from(result.credentials[0].credential.split('.')[1], 'base64url').toString())
    expect(payload.vc.credentialSubject.email).toBe('alice@example.com')
    expect(payload.vc.credentialSubject.credentialStatus.id).toBe(result.credentials[0].credentialId)
    await expect(confirmCredentialReissue({ identity, challengeId: challenge.challengeId, identityDocument, proof })).rejects.toThrow('IDENTITY_CREDENTIAL_REISSUE_CHALLENGE_NOT_FOUND')
  })
})
