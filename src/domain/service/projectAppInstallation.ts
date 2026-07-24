import { ProjectAppInstallationManager } from '../manager/projectAppInstallation'
import { projectInstallationFrom, projectInstanceFrom } from '../model/projectAppInstallation'
import { ProjectAppInstallationDO } from '../mapper/entity'
import { ProjectAppManifest } from '../../appstore/manifests'

export class ProjectAppInstallationService {
  private readonly manager = new ProjectAppInstallationManager()

  async getActiveInstance(instanceId: string) {
    const instance = await this.manager.findInstance(instanceId)
    if (!instance || instance.status !== 'active') return null
    return projectInstanceFrom(instance)
  }

  async getInstalled(instanceId: string) {
    const records = await this.manager.findInstalled(instanceId)
    return records.map(projectInstallationFrom)
  }

  async requestInstall(instanceId: string, manifest: ProjectAppManifest) {
    const now = new Date().toISOString()
    const existing = await this.manager.findByInstanceAndApp(instanceId, manifest.id)
    const installation = existing || new ProjectAppInstallationDO()
    installation.instanceId = instanceId
    installation.appId = manifest.id
    installation.installVersion = manifest.version
    installation.status = 'pending'
    installation.menuItemsJson = JSON.stringify(manifest.menuItems)
    installation.runtimeConfigJson = JSON.stringify({})
    installation.installAt = existing?.installAt || ''
    installation.updatedAt = now
    const saved = await this.manager.saveInstallation(installation)
    return projectInstallationFrom(saved)
  }
}
