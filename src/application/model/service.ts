import { SearchCondition, Service } from '../../domain/model/service'
import { ApiCodeEnum, ServiceCodeEnum } from '../../yeying/api/common/code'
import { Identity, NetworkTypeEnum, signData } from '@yeying-community/yeying-web3'
import { CreateServiceResponse, CreateServiceResponseBody, DeleteServiceResponse, DeleteServiceResponseBody, DetailServiceResponse, DetailServiceResponseBody, SearchServiceCondition, SearchServiceResponse, SearchServiceResponseBody } from '../../yeying/api/service/service'
import { ServiceMetadata } from '../../yeying/api/common/model'
import { Authenticate } from '../../common/authenticate'
import { ResponseStatus } from '../../yeying/api/common/message'

export function convertServiceCodeTo(code: ServiceCodeEnum) {
    return ServiceCodeEnum[code] || ServiceCodeEnum[ServiceCodeEnum.SERVICE_CODE_UNKNOWN]
}

export function convertServiceCodeFrom(code: string) {
    const v = ServiceCodeEnum[code as keyof typeof ServiceCodeEnum]
    return v !== undefined ? v : ServiceCodeEnum.SERVICE_CODE_UNKNOWN
}

export function convertServiceConditionTo(condition: SearchServiceCondition): SearchCondition {
    const search: SearchCondition = {}
    if (condition.code) {
        search.code = convertServiceCodeTo(condition.code)
    }
    if (condition.owner) {
        search.owner = condition.owner
    }

    if (condition.name) {
        search.name = condition.name
    }

    if (condition.keyword) {
        search.keyword = condition.keyword
    }
    return search
}

export function convertServiceMetadataFrom(service: Service): ServiceMetadata {
    return ServiceMetadata.create({
        network: service.network,
        owner: service.owner,
        address: service.address,
        name: service.name,
        description: service.description,
        did: service.did,
        version: service.version,
        code: ServiceCodeEnum[service.code as keyof typeof ServiceCodeEnum],
        apiCodes: service.apiCodes.split(',').map((a) => ApiCodeEnum[a as keyof typeof ApiCodeEnum]),
        proxy: service.proxy,
        grpc: service.grpc,
        avatar: service.avatar,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        signature: service.signature,
        codePackagePath: service.codePackagePath
    })
}

export function convertServiceMetadataTo(metadata: ServiceMetadata): Service {
    return {
        network: metadata.network,
        owner: metadata.owner,
        ownerName: metadata.name,
        address: metadata.address,
        name: metadata.name,
        description: metadata.description,
        did: metadata.did,
        version: metadata.version,
        code: ServiceCodeEnum[metadata.code],
        apiCodes: metadata.apiCodes.map((a) => ApiCodeEnum[a]).join(','),
        proxy: metadata.proxy,
        grpc: metadata.grpc,
        avatar: metadata.avatar,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        signature: metadata.signature,
        codePackagePath: metadata.codePackagePath
    }
}

export function convertServiceMetadataFromIdentity(identity: Identity) {
    const metadata = identity.metadata
    const extend = identity.serviceExtend
    if (metadata === undefined) {
        throw new Error("metadata is undefined")
    }
    if (extend === undefined) {
        throw new Error("extend is undefined")
    }
    return ServiceMetadata.create({
        network: NetworkTypeEnum[metadata.network],
        owner: metadata.parent,
        address: metadata.address,
        name: metadata.name,
        description: metadata.description,
        did: metadata.did,
        version: metadata.version,
        code: ServiceCodeEnum[extend.code as keyof typeof ServiceCodeEnum],
        apiCodes: extend.apiCodes.split(',').map((a) => ApiCodeEnum[a as keyof typeof ApiCodeEnum]),
        proxy: extend.proxy,
        grpc: extend.grpc,
        avatar: metadata.avatar,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt
    })
}

export async function verifyServiceMetadata(metadata: ServiceMetadata) {
    const signature = metadata.signature
    metadata.signature = ''
    try {
        const passed = await Authenticate.verifyData(metadata.did, ServiceMetadata.encode(metadata).finish(), signature)
        if (!passed) {
            throw new Error(`Invalid service metadata=${JSON.stringify(metadata, null, 2)}`)
        }
        return metadata
    } finally {
        metadata.signature = signature
    }
}

export async function signServiceMetadata(privateKey: string, metadata: ServiceMetadata) {
    metadata.signature = ''
    metadata.signature = await signData(privateKey, ServiceMetadata.encode(metadata).finish())
    return metadata
}


export async function createCreateServiceResponse(authenticate: Authenticate,
    status: ResponseStatus,
    service?: ServiceMetadata) {
    const body = CreateServiceResponseBody.create({status: status, service: service})
    return CreateServiceResponse.create({
        header: await authenticate.createHeader(CreateServiceResponseBody.encode(body).finish()),
        body: body
    })
}

export async function createSearchServiceResponse(authenticate: Authenticate,
    status: ResponseStatus,
    services?: ServiceMetadata[]) {
    const body = SearchServiceResponseBody.create({status: status, services: services})
    return SearchServiceResponse.create({
        header: await authenticate.createHeader(SearchServiceResponseBody.encode(body).finish()),
        body: body
    })
}


export async function createDetailServiceResponse(authenticate: Authenticate,
    status: ResponseStatus,
    service?: ServiceMetadata) {
    const body = DetailServiceResponseBody.create({status: status, service: service})
    return DetailServiceResponse.create({
        header: await authenticate.createHeader(DetailServiceResponseBody.encode(body).finish()),
        body: body
    })
}

export async function createDeleteServiceResponse(authenticate: Authenticate,
    status: ResponseStatus,
    service?: ServiceMetadata) {
    const body = DeleteServiceResponseBody.create({status: status})
    return DeleteServiceResponse.create({
        header: await authenticate.createHeader(DeleteServiceResponseBody.encode(body).finish()),
        body: body
    })
}
