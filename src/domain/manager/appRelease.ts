import { Repository } from 'typeorm/repository/Repository'
import { AppReleaseDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class AppReleaseManager {
  private readonly repository: Repository<AppReleaseDO>

  constructor() {
    this.repository = SingletonDataSource.get().getRepository(AppReleaseDO)
  }

  findByVersion(appId: string, version: string) {
    return this.repository.findOneBy({ appId, version })
  }

  findByUid(uid: string) {
    return this.repository.findOneBy({ uid })
  }

  findPublished() {
    return this.repository.find({
      where: { status: 'published' },
      order: { createdAt: 'DESC' },
    })
  }

  save(release: AppReleaseDO) {
    return this.repository.save(release)
  }
}
