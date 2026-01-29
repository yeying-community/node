import { ApplicationDO } from '../mapper/entity'
import { ResponsePage } from '../../common/page'

export interface SearchCondition {
    code?: string
    owner?: string
    name?: string
    keyword?: string
    status?: string
    isOnline?: boolean
}

export interface PageResult {
    data: Application[]
    page: ResponsePage
}

export interface Application {
    owner: string
    ownerName: string
    network: string
    address: string
    did: string
    version: number
    name: string
    description: string
    code: string
    location: string
    serviceCodes: string
    avatar: string
    createdAt: string
    updatedAt: string
    signature: string
    codePackagePath: string
    uid: string
    status: string
    isOnline: boolean
}

const STATUS_UNKNOWN = 'BUSINESS_STATUS_UNKNOWN'
const STATUS_OFFLINE = 'BUSINESS_STATUS_OFFLINE'
const STATUS_ONLINE = 'BUSINESS_STATUS_ONLINE'

export function convertApplicationTo(application: Application): ApplicationDO {
    if (application === undefined) {
        return new ApplicationDO()
    }

    const resolvedStatus =
      application.status ||
      (application.isOnline ? STATUS_ONLINE : STATUS_OFFLINE)

    const applicationDO = new ApplicationDO()
    applicationDO.owner = application.owner
    applicationDO.ownerName = application.ownerName
    applicationDO.network = application.network
    applicationDO.address = application.address
    applicationDO.did = application.did
    applicationDO.version = application.version
    applicationDO.name = application.name
    applicationDO.description = application.description
    applicationDO.code = application.code
    applicationDO.location = application.location
    applicationDO.serviceCodes = application.serviceCodes
    applicationDO.avatar = application.avatar
    applicationDO.createdAt = application.createdAt
    applicationDO.updatedAt = application.updatedAt
    applicationDO.signature = application.signature
    applicationDO.codePackagePath = application.codePackagePath
    applicationDO.status = resolvedStatus
    applicationDO.isOnline =
      application.isOnline ?? resolvedStatus === STATUS_ONLINE
    applicationDO.uid = application.uid
    return applicationDO
}

export function convertApplicationFrom(applicationDO?: ApplicationDO | null | undefined): Application {
    if (applicationDO === null || applicationDO === undefined) {
        return {
            owner: '',
            ownerName: '',
            network: '',
            address: '',
            did: '',
            version: 0,
            name: '',
            description: '',
            code: '',
            location: '',
            serviceCodes: '',
            avatar: '',
            createdAt: '',
            updatedAt: '',
            signature: '',
            codePackagePath: '',
            uid: '',
            status: STATUS_UNKNOWN,
            isOnline: false
        }
    }
    const resolvedStatus =
      applicationDO.status ||
      (applicationDO.isOnline
        ? STATUS_ONLINE
        : STATUS_OFFLINE)
    return {
        owner: applicationDO.owner,
        ownerName: applicationDO.ownerName,
        network: applicationDO.network,
        address: applicationDO.address,
        did: applicationDO.did,
        version: applicationDO.version,
        name: applicationDO.name,
        description: applicationDO.description,
        code: applicationDO.code,
        location: applicationDO.location,
        serviceCodes: applicationDO.serviceCodes,
        avatar: applicationDO.avatar,
        createdAt: applicationDO.createdAt,
        updatedAt: applicationDO.updatedAt,
        signature: applicationDO.signature,
        codePackagePath: applicationDO.codePackagePath,
        uid: applicationDO.uid,
        status: resolvedStatus,
        isOnline: applicationDO.isOnline ?? resolvedStatus === STATUS_ONLINE
    }
}
