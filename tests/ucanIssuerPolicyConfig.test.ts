import { vi } from 'vitest'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

const config = vi.hoisted(() => ({
  'app.port': 8100,
  'issuer.baseUrl': 'https://node.example',
  'issuer.ucan.enabled': true,
  'issuer.ucan.mode': 'issue',
  'issuer.ucan.sessionTtlMs': 5 * 60 * 1000,
  'issuer.ucan.tokenTtlMs': 10 * 60 * 1000,
  'issuer.ucan.defaultAudience': 'did:web:node.example',
  'issuer.ucan.defaultCapabilities': [{ with: 'app:all', can: 'invoke' }],
  'issuer.ucan.allowedAudiences': ['did:web:router.example'],
  'issuer.ucan.allowedCapabilitiesByAudience': {},
  'ucan.aud': 'did:web:node.example',
  'ucan.with': 'app:all',
  'ucan.can': 'invoke',
}))

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => config[key as keyof typeof config],
}))

vi.mock('../src/security/secretVault', () => ({
  getRuntimeSecret: (key: string) => ({
    ISSUER_PRIVATE_KEY: '11'.repeat(32),
  } as Record<string, string>)[key] || '',
}))

SingletonDataSource.set(createInMemoryDataSource())

const { createCentralIssueSession, getCentralIssuerStatus } = await import('../src/auth/ucanIssuer')

describe('central UCAN issuer policy configuration', () => {
  it('fails closed when an explicitly configured audience has no capabilities', async () => {
    const status = getCentralIssuerStatus()
    expect(status.ready).toBe(false)
    expect(status.error).toContain('missing capabilities for did:web:router.example')
    await expect(createCentralIssueSession({
      subject: '0x7777777777777777777777777777777777777777',
    })).rejects.toThrow('Invalid UCAN issuer policy')
  })
})
