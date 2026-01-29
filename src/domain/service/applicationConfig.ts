import { ApplicationConfigManager } from '../manager/applicationConfig'
import { ApplicationConfig, convertApplicationConfigFrom, convertApplicationConfigTo } from '../model/applicationConfig'

export class ApplicationConfigService {
    private manager: ApplicationConfigManager

    constructor() {
        this.manager = new ApplicationConfigManager()
    }

    async getByApplicationAndApplicant(applicationUid: string, applicant: string) {
        const res = await this.manager.findByApplicationAndApplicant(applicationUid, applicant)
        return res ? convertApplicationConfigFrom(res) : null
    }

    async upsert(config: ApplicationConfig) {
        const existing = await this.manager.findByApplicationAndApplicant(config.applicationUid, config.applicant)
        if (existing) {
            existing.applicationDid = config.applicationDid
            existing.applicationVersion = config.applicationVersion
            existing.configJson = JSON.stringify(config.config || [])
            existing.updatedAt = config.updatedAt
            const saved = await this.manager.save(existing)
            return convertApplicationConfigFrom(saved)
        }
        const saved = await this.manager.save(convertApplicationConfigTo(config))
        return convertApplicationConfigFrom(saved)
    }
}
