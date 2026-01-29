import { ServiceConfigDO } from '../mapper/entity'

export type ServiceConfig = {
    uid: string
    serviceUid: string
    serviceDid: string
    serviceVersion: number
    applicant: string
    config: Array<{ code: string; instance: string }>
    createdAt: string
    updatedAt: string
}

export function convertServiceConfigTo(config: ServiceConfig): ServiceConfigDO {
    const serviceConfigDO = new ServiceConfigDO()
    serviceConfigDO.uid = config.uid
    serviceConfigDO.serviceUid = config.serviceUid
    serviceConfigDO.serviceDid = config.serviceDid
    serviceConfigDO.serviceVersion = config.serviceVersion
    serviceConfigDO.applicant = config.applicant
    serviceConfigDO.configJson = JSON.stringify(config.config || [])
    serviceConfigDO.createdAt = config.createdAt
    serviceConfigDO.updatedAt = config.updatedAt
    return serviceConfigDO
}

export function convertServiceConfigFrom(serviceConfigDO: ServiceConfigDO): ServiceConfig {
    let config: Array<{ code: string; instance: string }> = []
    try {
        const parsed = JSON.parse(serviceConfigDO.configJson || '[]')
        if (Array.isArray(parsed)) {
            config = parsed
        }
    } catch {
        config = []
    }
    return {
        uid: serviceConfigDO.uid,
        serviceUid: serviceConfigDO.serviceUid,
        serviceDid: serviceConfigDO.serviceDid,
        serviceVersion: serviceConfigDO.serviceVersion,
        applicant: serviceConfigDO.applicant,
        config,
        createdAt: serviceConfigDO.createdAt,
        updatedAt: serviceConfigDO.updatedAt
    }
}
