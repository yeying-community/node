import { Repository } from 'typeorm/repository/Repository'
import { ApplicationDO, ApplicationReleaseDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { getCurrentUtcString } from '../../common/date'

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

  async withdrawVersion(applicationUid: string, version: number) {
    return await SingletonDataSource.get().transaction(async (manager) => {
      const releaseRepository = manager.getRepository(ApplicationReleaseDO)
      const applicationRepository = manager.getRepository(ApplicationDO)
      const release = await releaseRepository.findOneBy({ applicationUid, version })
      if (!release) {
        throw new Error('RELEASE_NOT_FOUND')
      }
      if (release.status !== 'published') {
        throw new Error('RELEASE_NOT_PUBLISHED')
      }
      const application = await applicationRepository.findOneBy({ uid: applicationUid })
      if (!application) {
        throw new Error('APPLICATION_NOT_FOUND')
      }

      const updatedAt = getCurrentUtcString()
      const result = await releaseRepository.update(
        { uid: release.uid, status: 'published' },
        { status: 'withdrawn', updatedAt },
      )
      if (Number(result.affected || 0) === 0) {
        throw new Error('RELEASE_NOT_PUBLISHED')
      }

      if (application.version === version || application.isOnline) {
        const publishedReleases = await releaseRepository.find({
          where: { applicationUid, status: 'published' },
        })
        if (application.version === version || publishedReleases.length === 0) {
          await applicationRepository.update(
            { uid: applicationUid },
            {
              status: 'BUSINESS_STATUS_OFFLINE',
              isOnline: false,
              updatedAt,
            },
          )
        }
      }

      return (await releaseRepository.findOneBy({ uid: release.uid })) || {
        ...release,
        status: 'withdrawn',
        updatedAt,
      }
    })
  }

  save(release: ApplicationReleaseDO) {
    return this.repository.save(release)
  }
}
