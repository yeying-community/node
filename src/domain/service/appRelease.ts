import fs from 'fs/promises'
import path from 'path'
import { AppReleaseDO } from '../mapper/entity'
import { AppReleaseManager } from '../manager/appRelease'
import { getCurrentUtcString } from '../../common/date'
import { ReleaseValidationResult } from '../../appstore/release/validator'
import { ProjectAppManifest } from '../../appstore/manifests'

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  submitted: ['approved', 'rejected'],
  approved: ['published', 'rejected'],
  published: ['withdrawn'],
  withdrawn: [],
  rejected: [],
}

export function canTransitionRelease(current: string, target: string): boolean {
  return (ALLOWED_TRANSITIONS[current] || []).includes(target)
}

export class AppReleaseService {
  private readonly manager = new AppReleaseManager()

  async submit(input: {
    publisher: string
    publisherKeyId: string
    artifactDir: string
    files: Record<string, string>
    validation: ReleaseValidationResult
  }) {
    const existing = await this.manager.findByVersion(input.validation.appId, input.validation.version)
    if (existing) {
      if (existing.releaseDigest !== input.validation.releaseDigest) {
        throw new Error('RELEASE_VERSION_IMMUTABLE')
      }
      return existing
    }

    const digestName = input.validation.releaseDigest.replace(':', '-')
    const relativePath = path.join(input.validation.appId, input.validation.version, `${digestName}.json`)
    const root = path.resolve(input.artifactDir)
    const artifactPath = path.resolve(root, relativePath)
    if (!artifactPath.startsWith(`${root}${path.sep}`)) throw new Error('INVALID_ARTIFACT_PATH')
    await fs.mkdir(path.dirname(artifactPath), { recursive: true, mode: 0o750 })
    const temporaryPath = `${artifactPath}.${process.pid}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify({ files: input.files }), { mode: 0o640 })
    await fs.rename(temporaryPath, artifactPath)

    const now = getCurrentUtcString()
    const release = new AppReleaseDO()
    release.appId = input.validation.appId
    release.version = input.validation.version
    release.publisher = input.publisher.toLowerCase()
    release.publisherKeyId = input.publisherKeyId
    release.releaseDigest = input.validation.releaseDigest
    release.image = input.validation.image
    release.status = 'submitted'
    release.artifactPath = relativePath
    release.validationJson = JSON.stringify({ valid: true, validated_at: now })
    release.createdAt = now
    release.updatedAt = now
    return await this.manager.save(release)
  }

  async transition(uid: string, targetStatus: string) {
    const release = await this.manager.findByUid(uid)
    if (!release) throw new Error('RELEASE_NOT_FOUND')
    if (!canTransitionRelease(release.status, targetStatus)) throw new Error('INVALID_RELEASE_TRANSITION')
    release.status = targetStatus
    release.updatedAt = getCurrentUtcString()
    return await this.manager.save(release)
  }

  async findPublishedManifest(input: { appId: string; version?: string; artifactDir: string }) {
    const releases = await this.manager.findPublished()
    for (const release of releases) {
      if (release.appId !== input.appId || (input.version && release.version !== input.version)) continue
      return await this.toManifest(release, input.artifactDir)
    }
    return null
  }

  async findPublishedRelease(appId: string, version: string) {
    const release = await this.manager.findByVersion(appId, version)
    return release?.status === 'published' ? release : null
  }

  async getPublishedArtifact(input: { appId: string; version: string; artifactDir: string }) {
    const release = await this.findPublishedRelease(input.appId, input.version)
    if (!release) return null
    const root = path.resolve(input.artifactDir)
    const artifactPath = path.resolve(root, release.artifactPath)
    if (!artifactPath.startsWith(`${root}${path.sep}`)) throw new Error('INVALID_ARTIFACT_PATH')
    const raw = await fs.readFile(artifactPath, 'utf8')
    const stored = JSON.parse(raw) as { files?: Record<string, string> }
    if (!stored.files || typeof stored.files !== 'object') throw new Error('INVALID_ARTIFACT')
    return { release, files: stored.files }
  }

  async listPublishedManifests(artifactDir: string) {
    const releases = await this.manager.findPublished()
    const manifests: ProjectAppManifest[] = []
    for (const release of releases) {
      try {
        manifests.push(await this.toManifest(release, artifactDir))
      } catch {
        // A published release with missing or corrupted artifact is not installable.
      }
    }
    return manifests
  }

  private async toManifest(release: AppReleaseDO, artifactDir: string): Promise<ProjectAppManifest> {
    const root = path.resolve(artifactDir)
    const artifactPath = path.resolve(root, release.artifactPath)
    if (!artifactPath.startsWith(`${root}${path.sep}`)) throw new Error('INVALID_ARTIFACT_PATH')
    const raw = await fs.readFile(artifactPath, 'utf8')
    const stored = JSON.parse(raw) as { files?: Record<string, string> }
    const application = JSON.parse(String(stored.files?.['application.json'] || '')) as {
      metadata?: { id?: string; name?: Record<string, string> }
      spec?: { version?: string; host?: { project?: string }; entries?: Array<Record<string, unknown>> }
    }
    if (application.metadata?.id !== release.appId || application.spec?.version !== release.version) {
      throw new Error('ARTIFACT_RELEASE_MISMATCH')
    }
    const menuItems = (application.spec?.entries || []).map((entry) => ({
      location: String(entry.location || 'application'),
      label: String((entry.label as Record<string, string> | undefined)?.['zh-CN'] || application.metadata?.name?.['zh-CN'] || release.appId),
      url: String(entry.path || '').replace(/^\//, ''),
      visible_to: String(entry.visibility || 'all'),
    }))
    return {
      id: release.appId,
      name: String(application.metadata?.name?.['zh-CN'] || release.appId),
      version: release.version,
      status: 'published',
      image: release.image,
      minimumProjectVersion: String(application.spec?.host?.project || ''),
      menuItems,
    }
  }
}
