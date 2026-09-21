import { Application } from '../model/application'
import { ApplicationReleaseDO } from '../mapper/entity'
import { ApplicationReleaseManager } from '../manager/applicationRelease'

export class ApplicationReleaseService {
  private readonly manager = new ApplicationReleaseManager()

  async findByDidVersion(did: string, version: number) {
    const releases = await this.manager.findByVersion(version)
    for (const release of releases) {
      try {
        const metadata = JSON.parse(release.metadataJson) as { did?: unknown }
        if (String(metadata?.did || '') === did) {
          return release
        }
      } catch {
        // Ignore malformed historical snapshots and continue searching.
      }
    }
    return null
  }

  async snapshotToApplication(release: ApplicationReleaseDO): Promise<Application | null> {
    try {
      const parsed = JSON.parse(release.metadataJson) as Partial<Application>
      if (!parsed || typeof parsed !== 'object') return null
      const isOnline = release.status === 'published'
      const status =
        release.status === 'published'
          ? 'BUSINESS_STATUS_ONLINE'
          : release.status === 'withdrawn'
            ? 'BUSINESS_STATUS_OFFLINE'
            : release.status === 'rejected'
              ? 'BUSINESS_STATUS_REJECTED'
              : release.status === 'reviewing'
                ? 'BUSINESS_STATUS_REVIEWING'
                : 'BUSINESS_STATUS_PENDING'
      return {
        owner: String(parsed.owner || ''),
        ownerName: String(parsed.ownerName || ''),
        network: String(parsed.network || ''),
        address: String(parsed.address || ''),
        did: String(parsed.did || ''),
        version: Number(parsed.version ?? release.version),
        name: String(parsed.name || ''),
        description: String(parsed.description || ''),
        code: String(parsed.code || ''),
        location: String(parsed.location || ''),
        serviceCodes: String(parsed.serviceCodes || ''),
        redirectUris: String(parsed.redirectUris || ''),
        ucanAudience: String(parsed.ucanAudience || ''),
        ucanCapabilities: String(parsed.ucanCapabilities || ''),
        avatar: String(parsed.avatar || ''),
        createdAt: String(parsed.createdAt || release.createdAt || ''),
        updatedAt: String(parsed.updatedAt || release.updatedAt || ''),
        signature: String(parsed.signature || release.signature || ''),
        codePackagePath: String(parsed.codePackagePath || ''),
        uid: release.applicationUid,
        status,
        isOnline,
      }
    } catch {
      return null
    }
  }
}
