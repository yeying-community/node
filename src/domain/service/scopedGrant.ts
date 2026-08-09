import crypto from 'crypto'
import { issueCentralUcan, type UcanCapability } from '../../auth/ucanIssuer'
import { getCurrentUtcString } from '../../common/date'
import { ScopedGrantAuditLogDO, ScopedGrantDO, ScopedGrantRevocationDO, ScopedGrantTokenDO } from '../mapper/entity'
import { ScopedGrantManager } from '../manager/scopedGrant'

export class ScopedGrantError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
const normalizeCapabilities = (value: unknown): UcanCapability[] => Array.isArray(value) ? value.map(item => ({ with: String((item as any)?.with || '').trim(), can: String((item as any)?.can || '').trim() })).filter(item => item.with && item.can) : []
const includesCapability = (approved: UcanCapability[], requested: UcanCapability) => approved.some(item => item.with === requested.with && item.can === requested.can)
const toTime = (value: string) => Date.parse(value || '')

export class ScopedGrantService {
  constructor(private readonly manager = new ScopedGrantManager()) {}

  private async audit(input: { grantId?: string; tokenId?: string; subjectId?: string; appId?: string; action: string; metadata?: unknown }) {
    const log = new ScopedGrantAuditLogDO()
    log.grantId = input.grantId || ''; log.tokenId = input.tokenId || ''; log.subjectId = input.subjectId || ''; log.appId = input.appId || ''
    log.action = input.action; log.metadataJson = JSON.stringify(input.metadata || {}); log.createdAt = getCurrentUtcString()
    await this.manager.saveAuditLog(log)
  }

  async create(input: { subjectId: string; appId: string; audience: string; capabilities: unknown; expiresAt: string }) {
    const subjectId = String(input.subjectId || '').trim(); const appId = String(input.appId || '').trim(); const audience = String(input.audience || '').trim()
    const capabilities = normalizeCapabilities(input.capabilities); const expiresAt = String(input.expiresAt || '').trim()
    if (!subjectId || !appId || !audience || !capabilities.length || !Number.isFinite(toTime(expiresAt)) || toTime(expiresAt) <= Date.now()) throw new ScopedGrantError(400, 'Invalid scoped grant input')
    const now = getCurrentUtcString(); const grant = new ScopedGrantDO()
    grant.grantId = id('grt'); grant.subjectId = subjectId; grant.appId = appId; grant.audience = audience; grant.capabilitiesJson = JSON.stringify(capabilities); grant.status = 'active'; grant.createdAt = now; grant.updatedAt = now; grant.expiresAt = expiresAt; grant.revokedAt = ''
    await this.manager.saveGrant(grant); await this.audit({ grantId: grant.grantId, subjectId, appId, action: 'grant_created', metadata: { audience, capabilities } }); return grant
  }

  async list(subjectId: string) { return await this.manager.listGrants(subjectId) }
  async getStatus(grantId: string) { const grant = await this.manager.getGrant(grantId); if (!grant) throw new ScopedGrantError(404, 'Scoped grant not found'); return { grantId: grant.grantId, subjectId: grant.subjectId, appId: grant.appId, audience: grant.audience, status: grant.status, expiresAt: grant.expiresAt, active: grant.status === 'active' && toTime(grant.expiresAt) > Date.now() } }

  async issue(input: { grantId: string; subjectId: string; audience: string; capabilities: unknown; expiresInMs?: number }) {
    const grant = await this.manager.getGrant(String(input.grantId || '').trim()); if (!grant) throw new ScopedGrantError(404, 'Scoped grant not found')
    if (grant.subjectId !== input.subjectId) throw new ScopedGrantError(403, 'Scoped grant does not belong to subject')
    if (grant.status !== 'active' || toTime(grant.expiresAt) <= Date.now()) throw new ScopedGrantError(403, 'Scoped grant is inactive')
    if (grant.audience !== String(input.audience || '').trim()) throw new ScopedGrantError(403, 'Audience is not allowed by scoped grant')
    const capabilities = normalizeCapabilities(input.capabilities); const approved = normalizeCapabilities(JSON.parse(grant.capabilitiesJson || '[]'))
    if (!capabilities.length || capabilities.some(item => !includesCapability(approved, item))) throw new ScopedGrantError(403, 'Capability is not allowed by scoped grant')
    const issued = issueCentralUcan({ subject: grant.subjectId, audience: grant.audience, capabilities, expiresInMs: input.expiresInMs })
    const token = new ScopedGrantTokenDO(); token.tokenId = id('gtk'); token.grantId = grant.grantId; token.tokenHash = crypto.createHash('sha256').update(issued.ucan).digest('hex'); token.audience = issued.audience; token.capabilitiesJson = JSON.stringify(issued.capabilities); token.status = 'active'; token.createdAt = getCurrentUtcString(); token.expiresAt = new Date(issued.expiresAt * 1000).toISOString(); token.revokedAt = ''
    await this.manager.saveToken(token); await this.audit({ grantId: grant.grantId, tokenId: token.tokenId, subjectId: grant.subjectId, appId: grant.appId, action: 'token_issued', metadata: { audience: issued.audience, capabilities } }); return { tokenId: token.tokenId, ucan: issued.ucan, expiresAt: token.expiresAt }
  }

  async revoke(input: { grantId: string; subjectId: string; tokenId?: string; reason?: string }) {
    const grant = await this.manager.getGrant(String(input.grantId || '').trim()); if (!grant) throw new ScopedGrantError(404, 'Scoped grant not found'); if (grant.subjectId !== input.subjectId) throw new ScopedGrantError(403, 'Scoped grant does not belong to subject')
    const now = getCurrentUtcString(); const tokenId = String(input.tokenId || '').trim(); let token: ScopedGrantTokenDO | null = null
    if (tokenId) { token = await this.manager.getToken(tokenId); if (!token || token.grantId !== grant.grantId) throw new ScopedGrantError(404, 'Scoped grant token not found'); token.status = 'revoked'; token.revokedAt = now; await this.manager.saveToken(token) } else { grant.status = 'revoked'; grant.revokedAt = now; grant.updatedAt = now; await this.manager.saveGrant(grant) }
    const revocation = new ScopedGrantRevocationDO(); revocation.grantId = grant.grantId; revocation.tokenId = tokenId; revocation.actorSubjectId = input.subjectId; revocation.revokedAt = now; revocation.reason = String(input.reason || '').trim(); await this.manager.saveRevocation(revocation)
    await this.audit({ grantId: grant.grantId, tokenId, subjectId: input.subjectId, appId: grant.appId, action: token ? 'token_revoked' : 'grant_revoked' }); return { revoked: true }
  }
}
