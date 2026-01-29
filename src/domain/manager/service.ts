import { Repository } from 'typeorm/repository/Repository'
import { ServiceDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { SearchCondition } from '../model/service'
import { createResponsePage } from '../../common/page'
import { SingletonLogger } from '../facade/logger'
import { Logger } from 'winston'
import { Like } from "typeorm";

export class ServiceManager {
    private repository: Repository<ServiceDO>

    private logger: Logger = SingletonLogger.get()

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(ServiceDO)
    }

    async save(service: ServiceDO) {
        return await this.repository.save(service)
    }

    async query(did: string, version: number): Promise<ServiceDO|null> {
        return await this.repository.findOneBy({ did: did, version: version })
    }

    async queryByUid(uid: string): Promise<ServiceDO|null> {
        return await this.repository.findOneBy({ uid: uid})
    }

    async delete(did: string, version: number) {
        return await this.repository.delete({ did: did, version: version })
    }

    async setOnline(did: string, version: number, isOnline: boolean) {
        return await this.repository.update({ did: did, version: version }, { isOnline: isOnline })
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
        if (condition.keyword) {
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
        if (completeCondition.length != 0) {
            const [services, total] = await this.repository.findAndCount({
                where: completeCondition,
                skip: (page - 1) * pageSize,
                take: pageSize,
                order: { createdAt: 'DESC' }
            })
            return {
                data: services,
                page: createResponsePage(total, page, pageSize)
            }
        }
        const where = hasStatus ? { status: condition.status } : { isOnline: isOnline }
        const [services, total] = await this.repository.findAndCount({
            where: where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            order: { createdAt: 'DESC' }
        })
        console.log(`services=${JSON.stringify(services)}`)
        return {
            data: services,
            page: createResponsePage(total, page, pageSize)
        }
    }

    async updatePublishState(did: string, version: number, status: string, isOnline: boolean) {
        return await this.repository.update({ did: did, version: version }, { status: status, isOnline: isOnline })
    }
}
