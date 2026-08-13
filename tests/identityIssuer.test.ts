import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { vi } from 'vitest'

const seed = '11'.repeat(32)
vi.mock('../src/security/secretVault', () => ({
  getRuntimeSecret: (name: string) => name === 'IDENTITY_ISSUER_PRIVATE_KEY' ? seed : name === 'IDENTITY_ISSUER_DID' ? 'did:web:node.example' : ''
}))
vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => ({ 'identityIssuer.baseUrl': 'https://node.example', 'identityIssuer.keyId': 'issuer-v1' } as Record<string, unknown>)[key]
}))

const { getIdentityIssuerJwks, getIdentityIssuerMetadata, issueIdentityCredential, getCredentialStatus, revokeCredential } =
  await import('../src/auth/identityIssuer')

describe('identity issuer foundation', () => {
  it('publishes Ed25519 JWKS metadata and signs JWT-VC', () => {
    const metadata = getIdentityIssuerMetadata()
    expect(metadata).toEqual({
      issuer: 'did:web:node.example',
      jwks_uri: 'https://node.example/.well-known/jwks.json',
      credential_status_uri: 'https://node.example/api/v1/public/identity/credentials/status'
    })
    const jwk = getIdentityIssuerJwks().keys[0]
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: 'issuer-v1', alg: 'EdDSA', use: 'sig' })

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
    expect(header).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'issuer-v1' })
    expect(payload.vc.type).toContain('EmailCredential')
    expect(payload.exp - payload.iat).toBe(7 * 86400)

    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' })
    expect(verify(null, Buffer.from(`${encodedHeader}.${encodedPayload}`), createPublicKey(privateKey), Buffer.from(encodedSignature, 'base64url'))).toBe(true)
  })

  it('fails closed when credential storage is unavailable', async () => {
    await expect(getCredentialStatus('cred_email_1')).rejects.toThrow('IDENTITY_STORAGE_UNAVAILABLE')
    await expect(revokeCredential('cred_email_1')).rejects.toThrow('IDENTITY_STORAGE_UNAVAILABLE')
  })
})
