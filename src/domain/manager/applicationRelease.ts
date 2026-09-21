import { Repository } from 'typeorm/repository/Repository'
import { ApplicationReleaseDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class ApplicationReleaseManager {
  private readonly repository: Repository<ApplicationReleaseDO>

  constructor() {
    this.repository = SingletonDataSource.get().getRepository(ApplicationReleaseDO)
  }

  findByApplicationVersion(applicationUid: string, version: number) {
    return this.repository.findOneBy({ applicationUid, version })
  }

  findByVersion(version: number) {
    return this.repository.find({
      where: { version },
      order: { updatedAt: 'DESC' },
    })
  }

  findByApplication(applicationUid: string) {
    return this.repository.find({
      where: { applicationUid },
      order: { version: 'DESC' },
    })
  }

  save(release: ApplicationReleaseDO) {
    return this.repository.save(release)
  }
}
