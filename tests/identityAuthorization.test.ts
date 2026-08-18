import { generateKeyPairSync, sign } from 'node:crypto'
import { vi } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'
import { IdentityCredentialDO } from '../src/domain/mapper/entity'

vi.mock('../src/domain/service/application', () => ({
  ApplicationService: class {
    async queryByUid(uid: string) { return uid === 'project' ? { uid, name: 'Project', redirectUris: 'https://project.example/auth/callback' } : null }
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

const { IdentityAuthorizationService } = await import('../src/domain/service/identityAuthorization')

describe('identity authorization', () => {
  it('exchanges a DID presentation once and returns only requested credentials', async () => {
    const service = new IdentityAuthorizationService()
    const verifier = 'a'.repeat(43)
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
    const request = await service.create({ appId: 'project', redirectUri: 'https://project.example/auth/callback', codeChallenge: challenge, codeChallengeMethod: 'S256', scopes: ['identity.email'] })
    await SingletonDataSource.get()!.getRepository(IdentityCredentialDO).save(Object.assign(new IdentityCredentialDO(), { credentialId: 'email-1', identityDid: identity, credentialType: 'email', token: 'credential', status: 'active', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: '' }))
    const approved = await service.approve({ requestId: request.requestId, presentation: presentation(request) })
    const exchanged = await service.exchange({ code: approved.authorizationCode, appId: 'project', redirectUri: 'https://project.example/auth/callback', codeVerifier: verifier })
    expect(exchanged.did).toBe(identity)
    expect(exchanged.credentials).toEqual([{ type: 'email', credentialId: 'email-1', credential: 'credential' }])
    await expect(service.exchange({ code: approved.authorizationCode, appId: 'project', redirectUri: 'https://project.example/auth/callback', codeVerifier: verifier })).rejects.toThrow('IDENTITY_AUTHORIZATION_CODE_INVALID')
  })

  it('rejects a presentation bound to another audience', async () => {
    const service = new IdentityAuthorizationService()
    const request = await service.create({ appId: 'project', redirectUri: 'https://project.example/auth/callback', codeChallenge: 'b'.repeat(43), codeChallengeMethod: 'S256', scopes: ['identity.basic'] })
    await expect(service.approve({ requestId: request.requestId, presentation: presentation(request, { audience: 'https://other.example' }) })).rejects.toThrow('IDENTITY_PRESENTATION_CONTEXT_INVALID')
  })
})
