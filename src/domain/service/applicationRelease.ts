import { Application } from '../model/application'
import { ApplicationReleaseDO } from '../mapper/entity'
import { ApplicationReleaseManager } from '../manager/applicationRelease'

export type ApplicationReleaseView = {
  uid: string
  applicationUid: string
  version: number
  releaseDigest: string
  signature: string
  status: string
  createdAt: string
  updatedAt: string
  application: Application | null
}

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

  async listByApplicationUid(applicationUid: string): Promise<ApplicationReleaseView[]> {
    const releases = await this.manager.findByApplication(applicationUid)
    return await Promise.all(releases.map((release) => this.toView(release)))
  }

  async getByApplicationVersion(applicationUid: string, version: number): Promise<ApplicationReleaseView | null> {
    const release = await this.manager.findByApplicationVersion(applicationUid, version)
    return release ? await this.toView(release) : null
  }

  async withdrawVersion(applicationUid: string, version: number): Promise<ApplicationReleaseView> {
    const release = await this.manager.withdrawVersion(applicationUid, version)
    return await this.toView(release)
  }

  private async toView(release: ApplicationReleaseDO): Promise<ApplicationReleaseView> {
    return {
      uid: release.uid,
      applicationUid: release.applicationUid,
      version: release.version,
      releaseDigest: release.releaseDigest || '',
      signature: release.signature || '',
      status: release.status,
      createdAt: release.createdAt,
      updatedAt: release.updatedAt,
      application: await this.snapshotToApplication(release),
    }
  }
}
