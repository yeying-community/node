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

export interface ApplicationDetail {
  name: string
  description: string
  location: string
  code: string
  serviceCodes: string[]
  redirectUris: string[]
  avatar: string
  owner: string
  ownerName: string
  codePackagePath: string
}

export interface ApplicationUcanCapability {
  with: string
  can: string
}

export const codeMapTrans = {
  0: 'APPLICATION_CODE_UNKNOWN',
  1: 'APPLICATION_CODE_MARKET',
  2: 'APPLICATION_CODE_ASSET',
  3: 'APPLICATION_CODE_KNOWLEDGE',
  4: 'APPLICATION_CODE_KEEPER',
  5: 'APPLICATION_CODE_SOCIAL',
  6: 'APPLICATION_CODE_WORKBENCH'
}

export const serviceCodeMapTrans = {
  0: 'SERVICE_CODE_UNKNOWN',
  2: 'SERVICE_CODE_WAREHOUSE',
  3: 'SERVICE_CODE_AGENT'
}

export const codeMap = {
  APPLICATION_CODE_CHAT: '聊天',
  APPLICATION_CODE_ROUTER: '网关',
  APPLICATION_CODE_WAREHOUSE: '仓储',
  APPLICATION_CODE_UNKNOWN: '未知',
  APPLICATION_CODE_MARKET: '社区集市',
  APPLICATION_CODE_ASSET: '资产应用',
  APPLICATION_CODE_KNOWLEDGE: '知识库应用',
  APPLICATION_CODE_KEEPER: '智能管家应用',
  APPLICATION_CODE_SOCIAL: '社交应用',
  APPLICATION_CODE_WORKBENCH: '工作台应用'
}

export function resolveApplicationCategoryLabel(code: unknown): string {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) {
    return '未分类'
  }
  const fullLabel = codeMap[normalizedCode as keyof typeof codeMap]
  if (!fullLabel) {
    return '未分类'
  }
  const parts = fullLabel.trim().split(/\s+/).filter((item) => item.length > 0)
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '未分类'
}

export const serviceCodeMap = {
  SERVICE_CODE_UNKNOWN: '未知',
  SERVICE_CODE_WAREHOUSE: '仓储服务供应商',
  SERVICE_CODE_AGENT: '智能体供应商'
}

const legacyServiceCodeSet = new Set(['SERVICE_CODE_NODE', 'SERVICE_CODE_MCP'])
const legacyServiceLabelSet = new Set(['网络节点供应商', '模型上下文供应商'])

export function isLegacyDependencyValue(value: unknown): boolean {
  const text = String(value || '').trim()
  if (!text) {
    return false
  }
  if (legacyServiceCodeSet.has(text.toUpperCase())) {
    return true
  }
  return legacyServiceLabelSet.has(text)
}

export function filterLegacyDependencies(values: string[]): string[] {
  return values.filter((item) => !isLegacyDependencyValue(item))
}

export interface ApplicationMetadata {
  owner?: string
  ownerName?: string
  network?: string
  address?: string
  did?: string
  version?: number
  name?: string
  code?: string
  description?: string
  location?: string
  serviceCodes?: string[]
  redirectUris?: string[]
  ucanAudience?: string
  ucanCapabilities?: ApplicationUcanCapability[]
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

export interface ApplicationSearchCondition {
  code?: string
  status?: string
  owner?: string
  name?: string
  keyword?: string
  includeOffline?: boolean
}

export type ApplicationConfigItem = {
  code: string
  instance: string
}

function toServiceCodes(value: unknown): string[] {
  const normalize = (item: unknown) => String(item).trim()
  if (Array.isArray(value)) {
    return filterLegacyDependencies(value.map(normalize).filter((item) => item.length > 0))
  }
  if (value === undefined || value === null) {
    return []
  }
  const text = String(value)
  if (!text) {
    return []
  }
  return filterLegacyDependencies(
    text
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  )
}

function toServiceCodesString(value: unknown): string {
  return toServiceCodes(value).join(',')
}

function toRedirectUris(value: unknown): string[] {
  const normalize = (item: unknown) => String(item || '').trim()
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => normalize(item)).filter((item) => item.length > 0)))
  }
  if (value === undefined || value === null) {
    return []
  }
  const raw = String(value).trim()
  if (!raw) {
    return []
  }
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(parsed.map((item) => normalize(item)).filter((item) => item.length > 0))
        )
      }
    } catch {
      // fallback to split mode
    }
  }
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  )
}

function normalizeApplication<T extends Record<string, unknown>>(
  app: T | null | undefined
): T | null | undefined {
  if (!app) {
    return app
  }
  const normalized: Record<string, unknown> = { ...app }
  if ('serviceCodes' in app) {
    normalized.serviceCodes = toServiceCodes(app.serviceCodes)
  }
  if ('redirectUris' in app) {
    normalized.redirectUris = toRedirectUris(app.redirectUris)
  }
  if ('ucanAudience' in app) {
    normalized.ucanAudience = String(app.ucanAudience || '').trim()
  }
  if ('ucanCapabilities' in app) {
    normalized.ucanCapabilities = toUcanCapabilities(app.ucanCapabilities)
  }
  return normalized as T
}

function toUcanCapabilities(value: unknown): ApplicationUcanCapability[] {
  const values: ApplicationUcanCapability[] = []
  const pushValue = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const source = entry as Record<string, unknown>
    const withValue =
      (typeof source.with === 'string' && source.with.trim()) ||
      (typeof source.resource === 'string' && source.resource.trim()) ||
      ''
    const canValue =
      (typeof source.can === 'string' && source.can.trim()) ||
      (typeof source.action === 'string' && source.action.trim()) ||
      ''
    if (!withValue || !canValue) {
      return
    }
    values.push({ with: withValue, can: canValue })
  }
  if (Array.isArray(value)) {
    value.forEach((item) => pushValue(item))
    return values
  }
  if (value === undefined || value === null) {
    return []
  }
  const raw = String(value).trim()
  if (!raw || !raw.startsWith('[')) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => pushValue(item))
    }
  } catch {
    return []
  }
  return values
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

function buildApplicationCreateBody(params: ApplicationMetadata, actor: string) {
  const uid = String(params.uid || generateUuid())
  const owner = normalizeAddress(params.owner || actor)
  const ownerName = String(params.ownerName || owner)
  const version = Number(params.version)
  if (!params.did || !Number.isFinite(version)) {
    throw new Error('缺少应用 DID 或版本号')
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
    code: String(params.code || 'APPLICATION_CODE_UNKNOWN'),
    location: String(params.location || ''),
    serviceCodes: toServiceCodesString(params.serviceCodes),
    redirectUris: toRedirectUris(params.redirectUris),
    avatar: String(params.avatar || ''),
    codePackagePath: String(params.codePackagePath || '')
  }
}

function buildApplicationCreatePayload(body: ReturnType<typeof buildApplicationCreateBody>) {
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
    location: body.location,
    serviceCodes: body.serviceCodes,
    redirectUris: body.redirectUris,
    avatar: body.avatar,
    codePackagePath: body.codePackagePath
  }
}

function buildApplicationUpdateBody(patch: Partial<ApplicationMetadata>) {
  return {
    ...(patch.name !== undefined ? { name: String(patch.name || '') } : {}),
    ...(patch.description !== undefined ? { description: String(patch.description || '') } : {}),
    ...(patch.location !== undefined ? { location: String(patch.location || '') } : {}),
    ...(patch.code !== undefined ? { code: String(patch.code || '') } : {}),
    ...(patch.serviceCodes !== undefined
      ? { serviceCodes: toServiceCodesString(patch.serviceCodes) }
      : {}),
    ...(patch.redirectUris !== undefined ? { redirectUris: toRedirectUris(patch.redirectUris) } : {}),
    ...(patch.avatar !== undefined ? { avatar: String(patch.avatar || '') } : {}),
    ...(patch.codePackagePath !== undefined
      ? { codePackagePath: String(patch.codePackagePath || '') }
      : {})
  }
}

function buildApplicationUpdatePayload(uid: string, patch: ReturnType<typeof buildApplicationUpdateBody>) {
  return {
    applicationUid: uid,
    ...patch
  }
}

async function fetchApplicationUid(
  target: ApplicationMetadata | { uid?: string; did?: string; version?: number } | string,
  version?: number
) {
  if (typeof target === 'string') {
    if (typeof version === 'number') {
      const detail = await applicationClient.detail(target, version)
      return detail?.uid
    }
    return target
  }
  if (target?.uid) {
    return target.uid
  }
  if (target?.did && target?.version !== undefined) {
    const detail = await applicationClient.detail(target.did, Number(target.version))
    return detail?.uid
  }
  return ''
}

class ApplicationClient {
  async create(params: ApplicationMetadata) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const body = buildApplicationCreateBody(params, session.actor)
    const signedBody = await createSignedActionBody({
      action: 'application_create',
      actor: session.actor,
      payload: buildApplicationCreatePayload(body),
      body,
      sign: signWithWallet
    })
    const response = await fetch(apiUrl('/api/v1/public/applications'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    const data = await parseEnvelope<ApplicationMetadata>(response, 'Sync application failed')
    return normalizeApplication(data)
  }

  async syncToServer(params: ApplicationMetadata) {
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

  async myCreateDelete(uid: string) {
    return this.deleteByUid(uid)
  }

  async myCreateUpdate(params: Partial<ApplicationMetadata> & { uid?: string }) {
    const uid = String(params.uid || '').trim()
    if (!uid) {
      throw new Error('Missing application uid')
    }
    return this.updateByUid(uid, params)
  }

  async myCreateDetailByUid(uid: string) {
    return this.queryByUid(uid)
  }

  async myCreateDeleteByUid(uid: string) {
    return this.deleteByUid(uid)
  }

  async search(condition: ApplicationSearchCondition, page?: number, pageSize?: number) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl('/api/v1/public/applications/search'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      },
      body: JSON.stringify({
        condition: {
          code: condition.code,
          owner: condition.owner,
          name: condition.name,
          keyword: condition.keyword,
          status: condition.status,
          includeOffline: condition.includeOffline
        },
        page: page || 1,
        pageSize: pageSize || 10
      })
    })
    const data = await parseEnvelope<{ items?: ApplicationMetadata[] }>(
      response,
      'Search applications failed'
    )
    const items = data.items || []
    return items.map((item) => normalizeApplication(item))
  }

  async myApplyList(applyOwner: string) {
    const actor = normalizeAddress(applyOwner)
    const applicant = `${actor}::${actor}`
    const audits = await $audit.search({ applicant })
    const latestAudits = pickLatestAuditsByResource(audits || [], {
      auditType: 'application',
      reason: '申请使用'
    })
    const items = await Promise.all(
      latestAudits.map(async (audit) => {
        const parsed = parseAuditTargetMetadata(audit.meta?.appOrServiceMetadata)
        if (!parsed) {
          return null
        }
        let remote: ApplicationMetadata | null | undefined = null
        try {
          if (parsed.uid) {
            remote = await this.queryByUid(parsed.uid)
          } else if (parsed.did && parsed.version !== undefined) {
            remote = await this.detail(parsed.did, parsed.version)
          }
        } catch {
          remote = null
        }
        const merged = normalizeApplication({
          ...(parsed.raw as ApplicationMetadata),
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
        }) as ApplicationMetadata
        return merged
      })
    )
    return items.filter((item): item is ApplicationMetadata => Boolean(item))
  }

  async update(params: Partial<ApplicationMetadata> & { uid?: string }) {
    return this.myCreateUpdate(params)
  }

  async updateByUid(uid: string, patch: Partial<ApplicationMetadata>) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const body = buildApplicationUpdateBody(patch)
    const signedBody = await createSignedActionBody({
      action: 'application_update',
      actor: session.actor,
      payload: buildApplicationUpdatePayload(uid, body),
      body,
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    const data = await parseEnvelope<ApplicationMetadata>(response, 'Update application failed')
    return normalizeApplication(data)
  }

  async deleteByUid(uid: string) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const signedBody = await createSignedActionBody({
      action: 'application_delete',
      actor: session.actor,
      payload: {
        applicationUid: uid
      },
      body: {},
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}`), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<{ deleted?: boolean }>(response, 'Delete application failed')
  }

  async detail(did: string, version: number) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const url = apiUrl(
      `/api/v1/public/applications/by-did?did=${encodeURIComponent(did)}&version=${version}`
    )
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    })
    const data = await parseEnvelope<ApplicationMetadata>(response, 'Fetch application failed')
    return normalizeApplication(data)
  }

  async queryByUid(uid: string) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    })
    const data = await parseEnvelope<ApplicationMetadata>(response, 'Fetch application failed')
    return normalizeApplication(data)
  }

  async getConfig(uid: string) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/config`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    })
    const data = await parseEnvelope<{ config?: ApplicationConfigItem[] }>(
      response,
      'Fetch application config failed'
    )
    return data.config || []
  }

  async saveConfig(uid: string, config: ApplicationConfigItem[]) {
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
      action: 'application_config_upsert',
      actor: session.actor,
      payload: {
        applicationUid: uid,
        applicant: session.actor,
        config: normalizedConfig
      },
      body,
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/config`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<Record<string, unknown>>(response, 'Save application config failed')
  }

  async offline(
    target: { uid?: string; did?: string; version?: number } | string,
    version?: number
  ) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const uid = await fetchApplicationUid(target, version)
    if (!uid) {
      notifyError('❌未找到应用 UID')
      return
    }
    const signedBody = await createSignedActionBody({
      action: 'application_unpublish',
      actor: session.actor,
      payload: {
        applicationUid: uid
      },
      body: {},
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/unpublish`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<{ unpublished?: boolean }>(response, 'Unpublish application failed')
  }

  async online(
    target: ApplicationMetadata | { uid?: string; did?: string; version?: number } | string,
    version?: number
  ) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const uid = await fetchApplicationUid(target, version)
    if (!uid) {
      notifyError('❌未找到应用 UID')
      return
    }
    const signedBody = await createSignedActionBody({
      action: 'application_publish',
      actor: session.actor,
      payload: {
        applicationUid: uid
      },
      body: {},
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/publish`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<{ published?: boolean }>(response, 'Publish application failed')
  }
}

const applicationClient = new ApplicationClient()

export default applicationClient
