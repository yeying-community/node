import { Repository } from 'typeorm/repository/Repository'
import { ApplicationDO, ApplicationReleaseDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { SearchCondition } from '../model/application'
import { createResponsePage } from '../../common/page'
import { Like } from "typeorm";
import { SingletonLogger } from '../facade/logger'
import { Logger } from 'winston'
import { getCurrentUtcString } from '../../common/date'

export class ApplicationManager {
    private repository: Repository<ApplicationDO>

    private logger: Logger = SingletonLogger.get()

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(ApplicationDO)
    }

    async save(application: ApplicationDO) {
        return await this.repository.save(application)
    }

    async saveWithRelease(application: ApplicationDO, current?: ApplicationDO) {
        return await SingletonDataSource.get().transaction(async (manager) => {
            const applicationRepository = manager.getRepository(ApplicationDO)
            const releaseRepository = manager.getRepository(ApplicationReleaseDO)
            const toRelease = (value: ApplicationDO) => {
                const release = new ApplicationReleaseDO()
                release.applicationUid = value.uid
                release.version = value.version
                release.metadataJson = JSON.stringify({
                    uid: value.uid,
                    owner: value.owner,
                    ownerName: value.ownerName,
                    network: value.network,
                    address: value.address,
                    did: value.did,
                    version: value.version,
                    name: value.name,
                    description: value.description,
                    code: value.code,
                    location: value.location,
                    serviceCodes: value.serviceCodes,
                    redirectUris: value.redirectUris,
                    ucanAudience: value.ucanAudience,
                    ucanCapabilities: value.ucanCapabilities,
                    avatar: value.avatar,
                    createdAt: value.createdAt,
                    updatedAt: value.updatedAt,
                    signature: value.signature,
                    codePackagePath: value.codePackagePath,
                    status: value.status,
                    isOnline: value.isOnline,
                })
                release.signature = value.signature || ''
                release.status = value.isOnline ? 'published' : 'draft'
                release.createdAt = value.createdAt
                release.updatedAt = value.updatedAt
                return release
            }

            if (current) {
                const lockedCurrent = await applicationRepository.findOne({
                    where: { uid: current.uid },
                    lock: { mode: 'pessimistic_write' },
                })
                if (!lockedCurrent) {
                    throw new Error('APPLICATION_NOT_FOUND')
                }
                if (lockedCurrent.owner.toLowerCase() !== application.owner.toLowerCase()) {
                    throw new Error('APPLICATION_OWNER_MISMATCH')
                }
                if (lockedCurrent.did !== application.did) {
                    throw new Error('APPLICATION_DID_MISMATCH')
                }
                if (application.version <= lockedCurrent.version) {
                    throw new Error('APPLICATION_VERSION_NOT_GREATER')
                }
                const currentRelease = await releaseRepository.findOneBy({
                    applicationUid: lockedCurrent.uid,
                    version: lockedCurrent.version,
                })
                if (!currentRelease) {
                    await releaseRepository.insert(toRelease(lockedCurrent))
                }
            }

            const existingRelease = await releaseRepository.findOneBy({
                applicationUid: application.uid,
                version: application.version,
            })
            if (existingRelease) {
                throw new Error('APPLICATION_RELEASE_ALREADY_EXISTS')
            }
            const nextRelease = toRelease(application)
            nextRelease.status = 'draft'
            await releaseRepository.insert(nextRelease)
            return await applicationRepository.save(application)
        })
    }

    async query(did: string, version: number) {
        return await this.repository.findOneBy({ did: did, version: version})
    }

    async queryByUid(uid: string) {
        return await this.repository.findOneBy({uid: uid})
    }

    async queryByCondition(condition: SearchCondition, page: number, pageSize: number) {
        let completeCondition: object[] = [];
        const hasStatus = condition.status !== undefined && condition.status !== ''
        const includeOffline = condition.includeOffline === true
        const isOnline = hasStatus
            ? undefined
            : includeOffline
              ? undefined
              : (condition.isOnline !== undefined ? condition.isOnline : true)
        const baseFilter: Record<string, any> = {}
        if (hasStatus) {
            baseFilter.status = condition.status
        } else if (isOnline !== undefined) {
            baseFilter.isOnline = isOnline
        }
        if (condition.did) {
            baseFilter.did = condition.did
        }
        if (Number.isFinite(Number(condition.version))) {
            baseFilter.version = Number(condition.version)
        }
        if (condition.keyword && condition.keyword !== '') {
            const safeKeyword = condition.keyword.replace(/([%_])/g, "\\$1");
            completeCondition.push({name: Like(`%${safeKeyword}%`), ...baseFilter})
            completeCondition.push({owner: Like(`%${safeKeyword}%`), ...baseFilter})
            completeCondition.push({code: Like(`%${safeKeyword}%`), ...baseFilter})
        } else {
            const cond: SearchCondition = {}
            if (condition.name) {
                cond.name = condition.name
            }
            if (condition.owner) {
                cond.owner = condition.owner
            }
            if (condition.code) {
                cond.code = condition.code
            }
            if (cond.name || cond.owner || cond.code || baseFilter.did || baseFilter.version !== undefined) {
                completeCondition.push({ ...cond, ...baseFilter })
            }
            if (completeCondition.length == 0) {
                completeCondition = []
            }
        }
        if (completeCondition.length > 0) {
            const [applications, total] = await this.repository.findAndCount({
                where: completeCondition,
                skip: (page - 1) * pageSize,
                take: pageSize,
                order: { createdAt: 'DESC' }
            })
            return {
                data: applications,
                page: createResponsePage(total, page, pageSize)
            }
        }
        const where = baseFilter
        const [applications, total] = await this.repository.findAndCount({
            where: where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            order: { createdAt: 'DESC' }
        })
        return {
            data: applications,
            page: createResponsePage(total, page, pageSize)
        }
    }

    async delete(did: string, version: number) {
        return await this.repository.delete({ did: did, version: version })
    }

    async setOnline(did: string, version: number, isOnline: boolean) {
        return await this.repository.update({ did: did, version: version }, { isOnline: isOnline })
    }

    async updatePublishState(
        did: string,
        version: number,
        status: string,
        isOnline: boolean,
        releaseStatus?: string
    ) {
        return await SingletonDataSource.get().transaction(async (manager) => {
            const applicationRepository = manager.getRepository(ApplicationDO)
            const application = await applicationRepository.findOneBy({ did, version })
            if (!application) return { affected: 0 }
            const updatedAt = getCurrentUtcString()
            const result = await applicationRepository.update(
                { uid: application.uid },
                { status, isOnline, updatedAt }
            )
            await manager.getRepository(ApplicationReleaseDO).update(
                { applicationUid: application.uid, version },
                {
                    status: releaseStatus || (isOnline ? 'published' : 'withdrawn'),
                    updatedAt,
                }
            )
            return result
        })
    }
}
