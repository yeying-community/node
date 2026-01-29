import { ServiceConfigManager } from '../manager/serviceConfig'
import { ServiceConfig, convertServiceConfigFrom, convertServiceConfigTo } from '../model/serviceConfig'

export class ServiceConfigService {
    private manager: ServiceConfigManager

    constructor() {
        this.manager = new ServiceConfigManager()
    }

    async getByServiceAndApplicant(serviceUid: string, applicant: string) {
        const res = await this.manager.findByServiceAndApplicant(serviceUid, applicant)
        return res ? convertServiceConfigFrom(res) : null
    }

    async upsert(config: ServiceConfig) {
        const existing = await this.manager.findByServiceAndApplicant(config.serviceUid, config.applicant)
        if (existing) {
            existing.serviceDid = config.serviceDid
            existing.serviceVersion = config.serviceVersion
            existing.configJson = JSON.stringify(config.config || [])
            existing.updatedAt = config.updatedAt
            const saved = await this.manager.save(existing)
            return convertServiceConfigFrom(saved)
        }
        const saved = await this.manager.save(convertServiceConfigTo(config))
        return convertServiceConfigFrom(saved)
    }
}
