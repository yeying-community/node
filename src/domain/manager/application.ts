import { Repository } from 'typeorm/repository/Repository'
import { ApplicationDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { SearchCondition } from '../model/application'
import { ResponsePage } from '../../yeying/api/common/message'
import { Like } from "typeorm";
import { SingletonLogger } from '../facade/logger'
import { Logger } from 'winston'

export class ApplicationManager {
    private repository: Repository<ApplicationDO>

    private logger: Logger = SingletonLogger.get()

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(ApplicationDO)
    }

    async save(application: ApplicationDO) {
        return await this.repository.save(application)
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
        const isOnline = hasStatus ? undefined : (condition.isOnline !== undefined ? condition.isOnline : true)
        const baseFilter: Record<string, any> = {}
        if (hasStatus) {
            baseFilter.status = condition.status
        } else if (isOnline !== undefined) {
            baseFilter.isOnline = isOnline
        }
        if (condition.keyword && condition.keyword !== '') {
            const safeKeyword = condition.keyword.replace(/([%_])/g, "\\$1");
            completeCondition.push({name: Like(`%${safeKeyword}%`), ...baseFilter})
            completeCondition.push({owner: Like(`%${safeKeyword}%`), ...baseFilter})
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
            if (cond.name || cond.owner || cond.code) {
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
                page: ResponsePage.create({
                    total: total,
                    page: page,
                    pageSize: pageSize
                })
            }
        }
        const where = hasStatus ? { status: condition.status } : { isOnline: isOnline }
        const [applications, total] = await this.repository.findAndCount({
            where: where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            order: { createdAt: 'DESC' }
        })
        return {
            data: applications,
            page: ResponsePage.create({
                total: total,
                page: page,
                pageSize: pageSize
            })
        }
    }

    async delete(did: string, version: number) {
        return await this.repository.delete({ did: did, version: version })
    }

    async setOnline(did: string, version: number, isOnline: boolean) {
        return await this.repository.update({ did: did, version: version }, { isOnline: isOnline })
    }

    async updatePublishState(did: string, version: number, status: string, isOnline: boolean) {
        return await this.repository.update({ did: did, version: version }, { status: status, isOnline: isOnline })
    }
}
