import { ApplicationDO } from '../mapper/entity'
import { ResponsePage } from '../../yeying/api/common/message'
import { Api } from '../../models'

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

export function convertToApplication(metadata: Api.CommonApplicationMetadata): Application {
  const resolvedStatus = Api.CommonApplicationStatusEnum.BUSINESSSTATUSPENDING
  const resolvedIsOnline = false
  // 检查必要字段，或提供默认值
  return {
    owner: metadata.owner ?? '',
    ownerName: metadata.ownerName ?? '',
    network: metadata.network ?? '',
    address: metadata.address ?? '',
    did: metadata.did ?? '',
    version: metadata.version ?? 1,
    name: metadata.name ?? '',
    description: metadata.description ?? '',
    code: metadata.code ?? 'APPLICATION_CODE_UNKNOWN',
    location: metadata.location ?? '',
    serviceCodes: (metadata.serviceCodes?.join(',') ?? '') as string, // 将枚举数组转为逗号分隔字符串
    avatar: metadata.avatar ?? '',
    createdAt: metadata.createdAt ?? new Date().toISOString(),
    updatedAt: metadata.updatedAt ?? new Date().toISOString(),
    signature: metadata.signature ?? '',
    codePackagePath: metadata.codePackagePath ?? '',
    uid: metadata.uid ?? '',
    status: resolvedStatus as string,
    isOnline: resolvedIsOnline
  };
}

export function convertApplicationTo(application: Application): ApplicationDO {
    if (application === undefined) {
        return new ApplicationDO()
    }

    const resolvedStatus =
      application.status ||
      (application.isOnline
        ? Api.CommonApplicationStatusEnum.BUSINESSSTATUSONLINE
        : Api.CommonApplicationStatusEnum.BUSINESSSTATUSOFFLINE)

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
      application.isOnline ?? resolvedStatus === Api.CommonApplicationStatusEnum.BUSINESSSTATUSONLINE
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
            status: Api.CommonApplicationStatusEnum.BUSINESSSTATUSUNKNOWN,
            isOnline: false
        }
    }
    const resolvedStatus =
      applicationDO.status ||
      (applicationDO.isOnline
        ? Api.CommonApplicationStatusEnum.BUSINESSSTATUSONLINE
        : Api.CommonApplicationStatusEnum.BUSINESSSTATUSOFFLINE)
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
        isOnline: applicationDO.isOnline ?? resolvedStatus === Api.CommonApplicationStatusEnum.BUSINESSSTATUSONLINE
    }
}
