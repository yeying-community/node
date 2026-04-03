import $audit, {
  parseAuditTargetMetadata,
  pickLatestAuditsByResource,
  resolveUsageAuditStatus
} from '@/plugins/audit'
import { apiUrl } from '@/plugins/api'
import { getAuthToken, getCurrentAccount, signWithWallet } from '@/plugins/auth'
import {
  createSignedActionBody,
  normalizeAddress
} from '@/utils/actionSignature'
import { generateUuid } from '@/utils/common'
import { notifyError } from '@/utils/message'

export {
  businessStatusMap,
  businessStatusOptions,
  resolveBusinessStatus,
  isBusinessOnline
} from '@/utils/businessStatus'

export const ApplyStatusMap = {
  1: '申请中',
  2: '已取消',
  3: '申请通过',
  4: '申请驳回'
}

export const codeMap = {
  SERVICE_CODE_UNKNOWN: '未知',
  SERVICE_CODE_NODE: '节点服务',
  SERVICE_CODE_WAREHOUSE: '资产服务',
  SERVICE_CODE_AGENT: '代理服务',
  SERVICE_CODE_MCP: 'MCP服务',
  SERVICE_CODE_RAG: '检索服务',
  SERVICE_CODE_CORRECTION: '修正服务'
}

export const serviceCodeMap = {
  API_CODE_UNKNOWN: '未知编码',
  API_CODE_USER: '用户编码',
  API_CODE_IDENTITY: '身份编码',
  API_CODE_LLM_SERVICE: '大模型服务编码',
  API_CODE_LLM_PROVIDER: '供应商服务编码',
  API_CODE_ASSET_SERVICE: '资产服务编码',
  API_CODE_ASSET_BLOCK: '资产块编码',
  API_CODE_ASSET_LINK: '资产链接编码',
  API_CODE_ASSET_NAMESPACE: '资产工作空间编码',
  API_CODE_ASSET_RECYCLE: '资产回收站编码',
  API_CODE_CERTIFICATE: '认证编码',
  API_CODE_STORAGE: '存储编码',
  API_CODE_APPLICATION: '应用编码',
  API_CODE_EVENT: '事件编码',
  API_CODE_INVITATION: '邀请编码',
  API_CODE_SERVICE: '服务编码',
  API_CODE_RAG: '检索编码'
}

export interface ServiceSearchCondition {
  code?: string
  status?: string
  owner?: string
  name?: string
  keyword?: string
  includeOffline?: boolean
}

export type ServiceConfigItem = {
  code: string
  instance: string
}

function toApiCodes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.length > 0)
  }
  if (value === undefined || value === null) {
    return []
  }
  const text = String(value)
  if (!text) {
    return []
  }
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function toApiCodesString(value: unknown) {
  return toApiCodes(value).join(',')
}

function normalizeService<T extends Record<string, unknown>>(
  service: T | null | undefined
): T | null | undefined {
  if (!service) {
    return service
  }
  if ('apiCodes' in service) {
    return { ...service, apiCodes: toApiCodes(service.apiCodes) }
  }
  return service
}

export enum CommonServiceCodeEnum {
  SERVICECODEUNKNOWN = 'SERVICE_CODE_UNKNOWN',
  SERVICECODENODE = 'SERVICE_CODE_NODE',
  SERVICECODEWAREHOUSE = 'SERVICE_CODE_WAREHOUSE',
  SERVICECODEAGENT = 'SERVICE_CODE_AGENT',
  SERVICECODEMCP = 'SERVICE_CODE_MCP',
  SERVICECODERAG = 'SERVICE_CODE_RAG',
  SERVICECODECORRECTION = 'SERVICE_CODE_CORRECTION'
}

export enum CommonApiCodeEnum {
  APICODEUNKNOWN = 'API_CODE_UNKNOWN',
  APICODEUSER = 'API_CODE_USER',
  APICODEIDENTITY = 'API_CODE_IDENTITY',
  APICODELLMSERVICE = 'API_CODE_LLM_SERVICE',
  APICODELLMPROVIDER = 'API_CODE_LLM_PROVIDER',
  APICODEASSETSERVICE = 'API_CODE_ASSET_SERVICE',
  APICODEASSETBLOCK = 'API_CODE_ASSET_BLOCK',
  APICODEASSETLINK = 'API_CODE_ASSET_LINK',
  APICODEASSETNAMESPACE = 'API_CODE_ASSET_NAMESPACE',
  APICODEASSETRECYCLE = 'API_CODE_ASSET_RECYCLE',
  APICODECERTIFICATE = 'API_CODE_CERTIFICATE',
  APICODESTORAGE = 'API_CODE_STORAGE',
  APICODEAPPLICATION = 'API_CODE_APPLICATION',
  APICODEEVENT = 'API_CODE_EVENT',
  APICODEINVITATION = 'API_CODE_INVITATION',
  APICODESERVICE = 'API_CODE_SERVICE',
  APICODERAG = 'API_CODE_RAG'
}

export interface ServiceMetadata {
  owner?: string
  ownerName?: string
  network?: string
  address?: string
  did?: string
  version?: number
  name?: string
  description?: string
  code?: string
  apiCodes?: string[]
  proxy?: string
  grpc?: string
  avatar?: string
  createdAt?: string
  updatedAt?: string
  signature?: string
  codePackagePath?: string
  uid?: string
  status?: string
  isOnline?: boolean
  avatarName?: string
  codeType?: string
  codePackageName?: string
  applyOwner?: string
  operateType?: string
  bindApplyCount?: number
  userCount?: number
  applyAuditId?: string
  applyStatus?: 'success' | 'applying' | 'reject'
}

function ensureWalletConnected() {
  if (localStorage.getItem('hasConnectedWallet') === 'false') {
    notifyError('❌未检测到钱包，请先安装并连接钱包')
    return false
  }
  return true
}

async function requireReadToken() {
  if (!ensureWalletConnected()) {
    return null
  }
  const token = await getAuthToken()
  if (!token) {
    notifyError('❌未获取到访问令牌')
    return null
  }
  return token
}

async function requireWriteSession() {
  const token = await requireReadToken()
  if (!token) {
    return null
  }
  const account = getCurrentAccount()
  if (!account) {
    notifyError('❌未查询到当前账户，请登录')
    return null
  }
  return { token, actor: normalizeAddress(account) }
}

async function parseEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${fallbackMessage}: ${response.status} error: ${await response.text()}`)
  }
  const result = await response.json()
  if (result.code !== 0) {
    throw new Error(result.message || fallbackMessage)
  }
  return result.data as T
}

function buildServiceCreateBody(params: ServiceMetadata, actor: string) {
  const uid = String(params.uid || generateUuid())
  const owner = normalizeAddress(params.owner || actor)
  const ownerName = String(params.ownerName || owner)
  const version = Number(params.version)
  if (!params.did || !Number.isFinite(version)) {
    throw new Error('缺少服务 DID 或版本号')
  }
  return {
    uid,
    owner,
    ownerName,
    network: String(params.network || ''),
    address: String(params.address || ''),
    did: String(params.did),
    version,
    name: String(params.name || ''),
    description: String(params.description || ''),
    code: String(params.code || 'SERVICE_CODE_UNKNOWN'),
    apiCodes: toApiCodesString(params.apiCodes),
    proxy: String(params.proxy || ''),
    grpc: String(params.grpc || ''),
    avatar: String(params.avatar || ''),
    codePackagePath: String(params.codePackagePath || '')
  }
}

function buildServiceCreatePayload(body: ReturnType<typeof buildServiceCreateBody>) {
  return {
    requestedUid: body.uid,
    owner: body.owner,
    ownerName: body.ownerName,
    network: body.network,
    address: body.address,
    did: body.did,
    version: body.version,
    name: body.name,
    description: body.description,
    code: body.code,
    apiCodes: body.apiCodes,
    proxy: body.proxy,
    grpc: body.grpc,
    avatar: body.avatar,
    codePackagePath: body.codePackagePath
  }
}

function buildServiceUpdateBody(patch: Partial<ServiceMetadata>) {
  return {
    ...(patch.name !== undefined ? { name: String(patch.name || '') } : {}),
    ...(patch.description !== undefined ? { description: String(patch.description || '') } : {}),
    ...(patch.code !== undefined ? { code: String(patch.code || '') } : {}),
    ...(patch.apiCodes !== undefined ? { apiCodes: toApiCodesString(patch.apiCodes) } : {}),
    ...(patch.proxy !== undefined ? { proxy: String(patch.proxy || '') } : {}),
    ...(patch.grpc !== undefined ? { grpc: String(patch.grpc || '') } : {}),
    ...(patch.avatar !== undefined ? { avatar: String(patch.avatar || '') } : {}),
    ...(patch.codePackagePath !== undefined
      ? { codePackagePath: String(patch.codePackagePath || '') }
      : {})
  }
}

function buildServiceUpdatePayload(uid: string, patch: ReturnType<typeof buildServiceUpdateBody>) {
  return {
    serviceUid: uid,
    ...patch
  }
}

async function fetchServiceUid(
  target: ServiceMetadata | { uid?: string; did?: string; version?: number } | string,
  version?: number
) {
  if (typeof target === 'string') {
    if (typeof version === 'number') {
      const detail = await serviceClient.detail(target, version)
      return detail?.uid
    }
    return target
  }
  if (target?.uid) {
    return target.uid
  }
  if (target?.did && target?.version !== undefined) {
    const detail = await serviceClient.detail(target.did, Number(target.version))
    return detail?.uid
  }
  return ''
}

class ServiceClient {
  async search(condition: ServiceSearchCondition, page?: number, pageSize?: number) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl('/api/v1/public/services/search'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      },
      body: JSON.stringify({
        condition: {
          code: condition.code,
          status: condition.status,
          owner: condition.owner,
          name: condition.name,
          keyword: condition.keyword,
          includeOffline: condition.includeOffline
        },
        page: page || 1,
        pageSize: pageSize || 10
      })
    })
    const data = await parseEnvelope<{ items?: ServiceMetadata[] }>(response, 'Search services failed')
    const items = data.items || []
    return items.map((item) => normalizeService(item))
  }

  async create(params: ServiceMetadata) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const body = buildServiceCreateBody(params, session.actor)
    const signedBody = await createSignedActionBody({
      action: 'service_create',
      actor: session.actor,
      payload: buildServiceCreatePayload(body),
      body,
      sign: signWithWallet
    })
    const response = await fetch(apiUrl('/api/v1/public/services'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    const data = await parseEnvelope<ServiceMetadata>(response, 'Sync service failed')
    return normalizeService(data)
  }

  async syncToServer(params: ServiceMetadata) {
    return this.create(params)
  }

  async myCreateList(owner: string) {
    return this.search(
      {
        owner: normalizeAddress(owner),
        includeOffline: true
      },
      1,
      1000
    )
  }

  async myApplyList(applyOwner: string) {
    const actor = normalizeAddress(applyOwner)
    const applicant = `${actor}::${actor}`
    const audits = await $audit.search({ applicant })
    const latestAudits = pickLatestAuditsByResource(audits || [], {
      auditType: 'service',
      reason: '申请使用'
    })
    const items = await Promise.all(
      latestAudits.map(async (audit) => {
        const parsed = parseAuditTargetMetadata(audit.meta?.appOrServiceMetadata)
        if (!parsed) {
          return null
        }
        let remote: ServiceMetadata | null | undefined = null
        try {
          if (parsed.uid) {
            remote = await this.queryByUid(parsed.uid)
          } else if (parsed.did && parsed.version !== undefined) {
            remote = await this.detail(parsed.did, parsed.version)
          }
        } catch {
          remote = null
        }
        const merged = normalizeService({
          ...(parsed.raw as ServiceMetadata),
          ...(remote || {}),
          uid: remote?.uid || parsed.uid || (parsed.raw.uid ? String(parsed.raw.uid) : ''),
          did: remote?.did || parsed.did || (parsed.raw.did ? String(parsed.raw.did) : ''),
          version:
            remote?.version ??
            parsed.version ??
            (parsed.raw.version !== undefined ? Number(parsed.raw.version) : undefined),
          owner:
            remote?.owner ||
            parsed.owner ||
            (parsed.raw.owner ? String(parsed.raw.owner) : ''),
          ownerName:
            remote?.ownerName ||
            parsed.ownerName ||
            (parsed.raw.ownerName ? String(parsed.raw.ownerName) : ''),
          applyAuditId: audit.meta?.uid,
          applyStatus: resolveUsageAuditStatus(audit)
        }) as ServiceMetadata
        return merged
      })
    )
    return items.filter((item): item is ServiceMetadata => Boolean(item))
  }

  async myCreateDetailByUid(uid: string) {
    return this.queryByUid(uid)
  }

  async myCreateUpdate(params: Partial<ServiceMetadata> & { uid?: string }) {
    const uid = String(params.uid || '').trim()
    if (!uid) {
      throw new Error('Missing service uid')
    }
    return this.updateByUid(uid, params)
  }

  async myCreateDelete(uid: string) {
    return this.deleteByUid(uid)
  }

  async updateByUid(uid: string, patch: Partial<ServiceMetadata>) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const body = buildServiceUpdateBody(patch)
    const signedBody = await createSignedActionBody({
      action: 'service_update',
      actor: session.actor,
      payload: buildServiceUpdatePayload(uid, body),
      body,
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/services/${uid}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    const data = await parseEnvelope<ServiceMetadata>(response, 'Update service failed')
    return normalizeService(data)
  }

  async deleteByUid(uid: string) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const signedBody = await createSignedActionBody({
      action: 'service_delete',
      actor: session.actor,
      payload: {
        serviceUid: uid
      },
      body: {},
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/services/${uid}`), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<{ deleted?: boolean }>(response, 'Delete service failed')
  }

  async detail(did: string, version: number) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const url = apiUrl(`/api/v1/public/services/by-did?did=${encodeURIComponent(did)}&version=${version}`)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    })
    const data = await parseEnvelope<ServiceMetadata>(response, 'Fetch service failed')
    return normalizeService(data)
  }

  async queryByUid(uid: string) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl(`/api/v1/public/services/${uid}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    })
    const data = await parseEnvelope<ServiceMetadata>(response, 'Fetch service failed')
    return normalizeService(data)
  }

  async getConfig(uid: string) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl(`/api/v1/public/services/${uid}/config`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    })
    const data = await parseEnvelope<{ config?: ServiceConfigItem[] }>(
      response,
      'Fetch service config failed'
    )
    return data.config || []
  }

  async saveConfig(uid: string, config: ServiceConfigItem[]) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const normalizedConfig = config
      .map((item) => ({
        code: String(item.code || '').trim(),
        instance: String(item.instance || '').trim()
      }))
      .filter((item) => item.code && item.instance)
    const body = {
      applicant: session.actor,
      config: normalizedConfig
    }
    const signedBody = await createSignedActionBody({
      action: 'service_config_upsert',
      actor: session.actor,
      payload: {
        serviceUid: uid,
        applicant: session.actor,
        config: normalizedConfig
      },
      body,
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/services/${uid}/config`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<Record<string, unknown>>(response, 'Save service config failed')
  }

  async offline(
    target: { uid?: string; did?: string; version?: number } | string,
    version?: number
  ) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const uid = await fetchServiceUid(target, version)
    if (!uid) {
      notifyError('❌未找到服务 UID')
      return
    }
    const signedBody = await createSignedActionBody({
      action: 'service_unpublish',
      actor: session.actor,
      payload: {
        serviceUid: uid
      },
      body: {},
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/services/${uid}/unpublish`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<{ unpublished?: boolean }>(response, 'Unpublish service failed')
  }

  async online(
    target: ServiceMetadata | { uid?: string; did?: string; version?: number } | string,
    version?: number
  ) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const uid = await fetchServiceUid(target, version)
    if (!uid) {
      notifyError('❌未找到服务 UID')
      return
    }
    const signedBody = await createSignedActionBody({
      action: 'service_publish',
      actor: session.actor,
      payload: {
        serviceUid: uid
      },
      body: {},
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/services/${uid}/publish`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<{ published?: boolean }>(response, 'Publish service failed')
  }
}

const serviceClient = new ServiceClient()

export default serviceClient
