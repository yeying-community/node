import { ProjectAppMenuItem } from '../../domain/model/projectAppInstallation'
import { aiManifest } from './ai'

export type ProjectAppManifest = {
  id: string
  name: string
  version: string
  status: 'published' | 'draft' | 'offline'
  image: string
  minimumProjectVersion: string
  menuItems: ProjectAppMenuItem[]
}

const manifests: ProjectAppManifest[] = [aiManifest]

export function findPublishedManifest(appId: string, version?: string) {
  return manifests.find((manifest) =>
    manifest.id === appId &&
    manifest.status === 'published' &&
    (!version || manifest.version === version),
  ) || null
}

export function listPublishedManifests() {
  return manifests.filter((manifest) => manifest.status === 'published')
}
