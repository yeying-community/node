import { ServiceDO } from '../mapper/entity'
import { ResponsePage } from '../../yeying/api/common/message'

export interface SearchCondition {
    owner?: string
    code?: string
    name?: string
    keyword?: string
    status?: string
    isOnline?: boolean
}

export interface PageResult {
    data?: Service[]
    page: ResponsePage
}

export interface Service {
    did: string
    version: number
    owner: string
    ownerName: string
    network: string
    address: string
    name: string
    description: string
    code: string
    apiCodes: string
    proxy: string
    grpc: string
    avatar: string
    createdAt: string
    updatedAt: string
    signature: string
    codePackagePath: string
    uid: string
    status: string
    isOnline: boolean
}

export function convertServiceTo(service: Partial<Service>): ServiceDO {
    const serviceDO = new ServiceDO()
    if (service === undefined) {
        return serviceDO
    }
    const resolvedStatus =
      service.status ||
      (service.isOnline
        ? 'BUSINESS_STATUS_ONLINE'
        : 'BUSINESS_STATUS_OFFLINE')
    serviceDO.did = service.did!
    serviceDO.owner = service.owner!
    serviceDO.ownerName = service.ownerName!
    serviceDO.network = service.network!
    serviceDO.address = service.address!
    serviceDO.version = service.version!
    serviceDO.name = service.name!
    serviceDO.description = service.description!
    serviceDO.code = service.code!
    serviceDO.apiCodes = service.apiCodes!
    serviceDO.proxy = service.proxy!
    serviceDO.grpc = service.grpc!
    serviceDO.avatar = service.avatar!
    serviceDO.createdAt = service.createdAt!
    serviceDO.updatedAt = service.updatedAt!
    serviceDO.signature = service.signature!
    serviceDO.codePackagePath = service.codePackagePath!
    serviceDO.status = resolvedStatus
    serviceDO.isOnline = service.isOnline ?? resolvedStatus === 'BUSINESS_STATUS_ONLINE'
    serviceDO.uid = service.uid!
    return serviceDO
}

export function convertServiceFrom(serviceDO: ServiceDO): Service {
    const resolvedStatus =
      serviceDO.status ||
      (serviceDO.isOnline
        ? 'BUSINESS_STATUS_ONLINE'
        : 'BUSINESS_STATUS_OFFLINE')
    return {
        did: serviceDO.did,
        owner: serviceDO.owner,
        ownerName: serviceDO.ownerName,
        network: serviceDO.network,
        address: serviceDO.address,
        version: serviceDO.version,
        name: serviceDO.name,
        description: serviceDO.description,
        code: serviceDO.code,
        apiCodes: serviceDO.apiCodes,
        proxy: serviceDO.proxy,
        grpc: serviceDO.grpc,
        avatar: serviceDO.avatar,
        createdAt: serviceDO.createdAt,
        updatedAt: serviceDO.updatedAt,
        signature: serviceDO.signature,
        codePackagePath: serviceDO.codePackagePath,
        uid: serviceDO.uid,
        status: resolvedStatus,
        isOnline: serviceDO.isOnline ?? resolvedStatus === 'BUSINESS_STATUS_ONLINE'
    }
}
