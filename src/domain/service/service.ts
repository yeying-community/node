import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'
import { ServiceManager } from '../manager/service'
import { convertServiceFrom, convertServiceTo, PageResult, SearchCondition, Service } from '../model/service'

export class ServiceService {
    private logger: Logger = SingletonLogger.get()
    private serviceManager: ServiceManager

    constructor() {
        this.serviceManager = new ServiceManager()
    }

    async search(condition: SearchCondition, page: number, pageSize: number): Promise<PageResult> {
        const result = await this.serviceManager.queryByCondition(condition, page, pageSize)
        return {
            data: result.data.map(convertServiceFrom),
            page: result.page
        }
    }

    async get(did: string, version: number) {
        const res = await this.serviceManager.query(did, version)
        if (res === undefined || res === null) {
            throw new Error("res is null")
        }
        return convertServiceFrom(res)
    }

    async getByUid(uid: string) {
        const res = await this.serviceManager.queryByUid(uid)
        if (res === undefined || res === null) {
            throw new Error("res is null")
        }
        return convertServiceFrom(res)
    }

    async delete(did: string, version: number) {
        return await this.serviceManager.delete(did, version)
    }

    async save(service: Service) {
        return this.serviceManager.save(convertServiceTo(service))
    }

    async add(service: Service) {
        const existing = await this.serviceManager.query(service.did, service.version)
        if (existing === undefined) {
            this.logger.error(`The service=${service.did}:${service.version} already exists when adding.`)
            throw new Error('Existing')
        }
        const serviceDO = convertServiceTo(service)
        const res = this.serviceManager.save(serviceDO)
        return res
    }

}
