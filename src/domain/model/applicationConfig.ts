import { ApplicationConfigDO } from '../mapper/entity'

export type ApplicationConfig = {
    uid: string
    applicationUid: string
    applicationDid: string
    applicationVersion: number
    applicant: string
    config: Array<{ code: string; instance: string }>
    createdAt: string
    updatedAt: string
}

export function convertApplicationConfigTo(config: ApplicationConfig): ApplicationConfigDO {
    const applicationConfigDO = new ApplicationConfigDO()
    applicationConfigDO.uid = config.uid
    applicationConfigDO.applicationUid = config.applicationUid
    applicationConfigDO.applicationDid = config.applicationDid
    applicationConfigDO.applicationVersion = config.applicationVersion
    applicationConfigDO.applicant = config.applicant
    applicationConfigDO.configJson = JSON.stringify(config.config || [])
    applicationConfigDO.createdAt = config.createdAt
    applicationConfigDO.updatedAt = config.updatedAt
    return applicationConfigDO
}

export function convertApplicationConfigFrom(applicationConfigDO: ApplicationConfigDO): ApplicationConfig {
    let config: Array<{ code: string; instance: string }> = []
    try {
        const parsed = JSON.parse(applicationConfigDO.configJson || '[]')
        if (Array.isArray(parsed)) {
            config = parsed
        }
    } catch {
        config = []
    }
    return {
        uid: applicationConfigDO.uid,
        applicationUid: applicationConfigDO.applicationUid,
        applicationDid: applicationConfigDO.applicationDid,
        applicationVersion: applicationConfigDO.applicationVersion,
        applicant: applicationConfigDO.applicant,
        config,
        createdAt: applicationConfigDO.createdAt,
        updatedAt: applicationConfigDO.updatedAt
    }
}
