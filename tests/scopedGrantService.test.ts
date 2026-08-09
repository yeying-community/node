import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/auth/ucanIssuer', () => ({
  issueCentralUcan: vi.fn(() => ({
    ucan: 'signed-ucan',
    audience: 'did:web:router.example',
    capabilities: [{ with: 'store:project-a', can: 'read' }],
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  })),
}))

const { ScopedGrantService } = await import('../src/domain/service/scopedGrant')

function createHarness() {
  const grants = new Map<string, any>()
  const tokens = new Map<string, any>()
  const manager = {
    saveGrant: async (value: any) => (grants.set(value.grantId, value), value),
    getGrant: async (id: string) => grants.get(id) || null,
    listGrants: async (subjectId: string) => Array.from(grants.values()).filter(item => item.subjectId === subjectId),
    saveToken: async (value: any) => (tokens.set(value.tokenId, value), value),
    getToken: async (id: string) => tokens.get(id) || null,
    saveRevocation: async (value: any) => value,
    saveAuditLog: async (value: any) => value,
  }
  return { service: new ScopedGrantService(manager as any), grants, tokens }
}

describe('ScopedGrantService', () => {
  it('limits issued tokens to the grant audience and capabilities and supports revocation', async () => {
    const { service, grants, tokens } = createHarness()
    const grant = await service.create({
      subjectId: '0xabc', appId: 'project', audience: 'did:web:router.example',
      capabilities: [{ with: 'store:project-a', can: 'read' }], expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const issued = await service.issue({ grantId: grant.grantId, subjectId: '0xabc', audience: 'did:web:router.example', capabilities: [{ with: 'store:project-a', can: 'read' }] })
    expect(issued.ucan).toBe('signed-ucan')
    await expect(service.issue({ grantId: grant.grantId, subjectId: '0xabc', audience: 'did:web:warehouse.example', capabilities: [{ with: 'store:project-a', can: 'read' }] })).rejects.toThrow('Audience is not allowed')
    await expect(service.issue({ grantId: grant.grantId, subjectId: '0xabc', audience: 'did:web:router.example', capabilities: [{ with: 'store:project-a', can: 'write' }] })).rejects.toThrow('Capability is not allowed')
    await service.revoke({ grantId: grant.grantId, tokenId: issued.tokenId, subjectId: '0xabc' })
    expect(tokens.get(issued.tokenId).status).toBe('revoked')
    await service.revoke({ grantId: grant.grantId, subjectId: '0xabc' })
    expect(grants.get(grant.grantId).status).toBe('revoked')
  })
})
