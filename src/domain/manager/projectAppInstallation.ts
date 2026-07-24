import { Repository } from 'typeorm/repository/Repository'
import { ProjectAppInstallationDO, ProjectInstanceDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class ProjectAppInstallationManager {
  private readonly instanceRepository: Repository<ProjectInstanceDO>
  private readonly installationRepository: Repository<ProjectAppInstallationDO>

  constructor() {
    const dataSource = SingletonDataSource.get()
    this.instanceRepository = dataSource.getRepository(ProjectInstanceDO)
    this.installationRepository = dataSource.getRepository(ProjectAppInstallationDO)
  }

  findInstance(instanceId: string) {
    return this.instanceRepository.findOneBy({ instanceId })
  }

  findInstalled(instanceId: string) {
    return this.installationRepository.find({
      where: { instanceId, status: 'installed' },
      order: { installAt: 'ASC' },
    })
  }

  findByInstanceAndApp(instanceId: string, appId: string) {
    return this.installationRepository.findOneBy({ instanceId, appId })
  }

  saveInstallation(installation: ProjectAppInstallationDO) {
    return this.installationRepository.save(installation)
  }
}
