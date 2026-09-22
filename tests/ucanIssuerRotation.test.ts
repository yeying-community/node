import { vi } from 'vitest'
import * as crypto from 'node:crypto'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { UcanAuditLogDO, UcanIssuedTokenDO, UcanTokenRevocationDO } from '../src/domain/mapper/entity'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

const secrets: Record<string, string> = {
  ISSUER_PRIVATE_KEY: '11'.repeat(32),
  ISSUER_PRIVATE_KEY_NEXT: '22'.repeat(32),
  ISSUER_PRIVATE_KEY_PREVIOUS: '33'.repeat(32),
}

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => ({
    'issuer.baseUrl': 'https://node.example',
    'issuer.ucan.enabled': true,
    'issuer.ucan.mode': 'issue',
    'issuer.ucan.sessionTtlMs': 5 * 60 * 1000,
    'issuer.ucan.tokenTtlMs': 10 * 60 * 1000,
    'issuer.ucan.defaultAudience': 'did:web:node.example',
    'issuer.ucan.defaultCapabilities': [{ with: 'app:all', can: 'invoke' }],
    'ucan.aud': 'did:web:node.example',
    'ucan.with': 'app:all',
    'ucan.can': 'invoke',
  } as Record<string, unknown>)[key],
}))

vi.mock('../src/security/secretVault', () => ({
  getRuntimeSecret: (key: string) => secrets[key] || '',
}))

SingletonDataSource.set(createInMemoryDataSource())

const {
  createCentralIssueSession,
  getCentralIssuerStatus,
  issueCentralUcan,
  issueCentralUcanBySession,
  revokeCentralIssueSession,
} = await import('../src/auth/ucanIssuer')
const { getNodeIssuerJwks, getNodeIssuerKeyRing, getNodeUcanIssuerKeys, verifyNodeJwt } = await import('../src/security/nodeIssuer')
const { verifyUcanInvocation, verifyUcanInvocationWithCap } = await import('../src/auth/ucan')

function resignUcanToken(token: string, mutate: (payload: Record<string, unknown>) => void): string {
  const [headerSegment, payloadSegment] = token.split('.')
  const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<string, unknown>
  mutate(payload)
  const nextPayloadSegment = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${headerSegment}.${nextPayloadSegment}`
  const active = getNodeIssuerKeyRing().find(key => key.role === 'active')
  if (!active) throw new Error('active issuer key missing')
  const signature = crypto.sign(null, Buffer.from(signingInput), active.privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

describe('central UCAN issuer key rotation', () => {
  it('publishes active, next, and previous keys and trusts their UCAN DIDs', () => {
    const jwks = getNodeIssuerJwks()
    const keys = getNodeUcanIssuerKeys()
    expect(jwks.keys).toHaveLength(3)
    expect(new Set(jwks.keys.map(key => key.kid)).size).toBe(3)
    expect(keys.map(key => key.role)).toEqual(['active', 'next', 'previous'])
    expect(getCentralIssuerStatus().issuerKeys).toEqual(keys)
  })

  it('accepts issuer JWTs signed by a previous rotation key', () => {
    const previous = getNodeIssuerKeyRing().find(key => key.role === 'previous')
    expect(previous).toBeTruthy()
    const header = { alg: 'EdDSA', typ: 'JWT', kid: previous!.keyId }
    const payload = { sub: '0x1111111111111111111111111111111111111111', exp: Math.floor(Date.now() / 1000) + 60 }
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signingInput = `${encodedHeader}.${encodedPayload}`
    const signature = crypto.sign(null, Buffer.from(signingInput), previous!.privateKey).toString('base64url')
    expect(verifyNodeJwt(`${signingInput}.${signature}`)).toMatchObject(payload)
  })

  it('persists central issue sessions and rejects them after revocation', async () => {
    const session = await createCentralIssueSession({ subject: '0x1111111111111111111111111111111111111111' })
    const loaded = await import('../src/auth/ucanIssuer').then(module => module.getCentralIssueSession(session.sessionToken))
    expect(loaded).toMatchObject({
      subject: '0x1111111111111111111111111111111111111111',
      issuer: session.issuer,
      allowedAudiences: ['did:web:node.example'],
      allowedCapabilitiesByAudience: {
        'did:web:node.example': [{ with: 'app:all', can: 'invoke' }],
      },
    })

    const issued = await issueCentralUcanBySession({
      sessionToken: session.sessionToken,
      audience: 'did:web:node.example',
      capabilities: [{ with: 'app:all', can: 'invoke' }],
    })
    expect(issued.tokenId).toBeTruthy()
    expect(await SingletonDataSource.get().getRepository(UcanIssuedTokenDO).findOneBy({ tokenId: issued.tokenId })).toMatchObject({
      sessionHash: expect.any(String),
      tokenHash: expect.any(String),
      subject: '0x1111111111111111111111111111111111111111',
    })
    expect(await SingletonDataSource.get().getRepository(UcanAuditLogDO).findBy({ action: 'token_issued' })).toHaveLength(1)
    await expect(verifyUcanInvocation(issued.ucan)).resolves.toMatchObject({
      address: '0x1111111111111111111111111111111111111111',
      source: 'central',
    })

    await expect(revokeCentralIssueSession(session.sessionToken)).resolves.toBe(true)
    expect(await SingletonDataSource.get().getRepository(UcanTokenRevocationDO).findOneBy({ tokenId: issued.tokenId })).toMatchObject({
      reason: 'session_revoked',
    })
    expect(await SingletonDataSource.get().getRepository(UcanAuditLogDO).findBy({ action: 'token_revoked' })).toHaveLength(1)
    expect(await SingletonDataSource.get().getRepository(UcanAuditLogDO).findBy({ action: 'session_revoked' })).toHaveLength(1)
    await expect(verifyUcanInvocation(issued.ucan)).rejects.toThrow('UCAN token revoked')
    await expect(issueCentralUcanBySession({ sessionToken: session.sessionToken })).rejects.toThrow(
      'Invalid or expired session token',
    )
    await expect(revokeCentralIssueSession(session.sessionToken)).resolves.toBe(false)
  })

  it('bounds central issuance by the session audience, capabilities, and remaining TTL', async () => {
    const session = await createCentralIssueSession({
      subject: '0x3333333333333333333333333333333333333333',
    })
    const defaultCapability = { with: 'app:all', can: 'invoke' }

    await expect(issueCentralUcanBySession({
      sessionToken: session.sessionToken,
      audience: 'did:web:other.example',
      capabilities: [defaultCapability],
    })).rejects.toThrow('UCAN audience is not allowed by session')

    await expect(issueCentralUcanBySession({
      sessionToken: session.sessionToken,
      audience: 'did:web:node.example',
      capabilities: [{ with: 'app:all:localhost-*', can: 'admin' }],
    })).rejects.toThrow('UCAN capabilities are not allowed by session')

    await expect(issueCentralUcanBySession({
      sessionToken: session.sessionToken,
      audience: 'did:web:node.example',
      capabilities: [defaultCapability],
      expiresInMs: 10 * 60 * 1000,
    })).rejects.toThrow('UCAN TTL exceeds session expiry')
  })

  it('allows a minimum token TTL when the session has one minute remaining', async () => {
    const currentTime = Date.parse('2026-09-21T12:00:00.123Z')
    vi.useFakeTimers({ now: currentTime })
    try {
      const session = await createCentralIssueSession({
        subject: '0x5555555555555555555555555555555555555555',
        expiresInMs: 60 * 1000,
      })
      const issued = await issueCentralUcanBySession({
        sessionToken: session.sessionToken,
      })
      expect(issued.expiresAt).toBe(Math.floor((currentTime + 60 * 1000) / 1000))
    } finally {
      vi.useRealTimers()
    }
  })

  it('requires expiry and a revocation id on trusted central UCANs', async () => {
    const issued = await issueCentralUcan({
      subject: '0x6666666666666666666666666666666666666666',
      audience: 'did:web:node.example',
      capabilities: [{ with: 'app:all', can: 'invoke' }],
    })
    const missingExpiry = resignUcanToken(issued.ucan, payload => {
      delete payload.exp
    })
    await expect(verifyUcanInvocation(missingExpiry)).rejects.toThrow('UCAN expiry required')

    const missingTokenId = resignUcanToken(issued.ucan, payload => {
      delete payload.jti
    })
    await expect(verifyUcanInvocation(missingTokenId)).rejects.toThrow('UCAN token id required')
  })

  it('persists and enforces an application-scoped downstream policy', async () => {
    const session = await createCentralIssueSession({
      subject: '0x4444444444444444444444444444444444444444',
      allowedAudiences: ['did:web:router.example'],
      allowedCapabilitiesByAudience: {
        'did:web:router.example': [
          { with: 'app:all:router-*', can: 'invoke' },
        ],
      },
    })
    expect(session.allowedAudiences).toEqual(['did:web:router.example'])
    await expect(issueCentralUcanBySession({
      sessionToken: session.sessionToken,
      audience: 'did:web:router.example',
      capabilities: [{ with: 'app:all:*', can: 'invoke' }],
    })).rejects.toThrow('UCAN capabilities are not allowed by session')
    await expect(issueCentralUcanBySession({
      sessionToken: session.sessionToken,
      audience: 'did:web:router.example',
      capabilities: [{ with: 'app:all:router-*', can: 'invoke' }],
    })).resolves.toMatchObject({
      subject: '0x4444444444444444444444444444444444444444',
      audience: 'did:web:router.example',
    })
  })

  it('enforces one-way resource coverage during invocation verification', async () => {
    const concrete = await issueCentralUcan({
      subject: '0x2222222222222222222222222222222222222222',
      audience: 'did:web:node.example',
      capabilities: [{ with: 'node:application:own', can: 'read' }],
    })
    await expect(
      verifyUcanInvocationWithCap(concrete.ucan, [
        { with: 'node:application:*', can: 'read' },
      ]),
    ).rejects.toThrow('UCAN capability denied')

    const wildcard = await issueCentralUcan({
      subject: '0x2222222222222222222222222222222222222222',
      audience: 'did:web:node.example',
      capabilities: [{ with: 'node:application:*', can: 'read' }],
    })
    await expect(
      verifyUcanInvocationWithCap(wildcard.ucan, [
        { with: 'node:application:own', can: 'read' },
      ]),
    ).resolves.toMatchObject({
      address: '0x2222222222222222222222222222222222222222',
      source: 'central',
    })
  })
})
