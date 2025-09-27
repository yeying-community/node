import { ServiceDO } from '../mapper/entity'
import { ResponsePage } from '../../yeying/api/common/message'

export interface SearchCondition {
    owner?: string
    code?: string
    name?: string
    keyword?: string
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
}

export function convertServiceTo(service: Partial<Service>): ServiceDO {
    const serviceDO = new ServiceDO()
    if (service === undefined) {
        return serviceDO
    }
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
    serviceDO.isOnline = true
    return serviceDO
}

export function convertServiceFrom(serviceDO: ServiceDO): Service {
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
        codePackagePath: serviceDO.codePackagePath
    }
}
