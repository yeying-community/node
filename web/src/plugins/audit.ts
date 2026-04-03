import { getAuthToken, getCurrentAccount, signWithWallet } from '@/plugins/auth'
import { apiUrl } from '@/plugins/api'
import { createSignedActionBody, normalizeAddress } from '@/utils/actionSignature'
import { notifyError } from '@/utils/message'

export interface AuditAuditMetadata {
  uid?: string
  appOrServiceMetadata?: string
  auditType?: string
  applicant?: string
  approver?: string
  reason?: string
  createdAt?: string
  updatedAt?: string
  signature?: string
}

export interface AuditAuditSearchCondition {
  approver?: string
  name?: string
  type?: string
  auditType?: string
  applicant?: string
  states?: string[]
  startTime?: string
  endTime?: string
}

export enum AuditCommentStatusEnum {
  COMMENTSTATUSAGREE = 'COMMENT_STATUS_AGREE',
  COMMENTSTATUSREJECT = 'COMMENT_STATUS_REJECT'
}

export interface AuditCommentMetadata {
  uid?: string
  auditId?: string
  text?: string
  status?: AuditCommentStatusEnum
  createdAt?: string
  updatedAt?: string
  signature?: string
}

export interface AuditDecisionSummary {
  state: '待审批' | '审批通过' | '审批驳回'
  approvers: string[]
  requiredApprovals: number
  approvalCount: number
  rejectionCount: number
  approvedBy: string[]
  rejectedBy: string[]
  pendingApprovers: string[]
  isDecided: boolean
}

export interface AuditAuditDetail {
  meta?: AuditAuditMetadata
  commentMeta?: AuditCommentMetadata[]
  summary?: AuditDecisionSummary
}

export interface AuditDetailBox {
  uid?: string
  name?: string
  desc?: string
  applicantor?: string
  state?: string
  date?: string
  serviceType?: string
  auditType?: string
  msg?: string
  progress?: string
  summary?: AuditDecisionSummary
}

export interface AuditSearchPage {
  total: number
  page: number
  pageSize: number
}

export interface AuditSearchResult {
  items: AuditAuditDetail[]
  page: AuditSearchPage
}

type AuditTargetType = 'application' | 'service'

export type AuditApplyStatus = 'success' | 'applying' | 'reject'

export type ParsedAuditTarget = {
  raw: Record<string, unknown>
  operateType: string
  uid?: string
  did?: string
  version?: number
  name?: string
  owner?: string
  ownerName?: string
  key: string
}

function getAuditState(summary?: AuditDecisionSummary) {
  return summary?.state || '待审批'
}

function buildDecisionProgress(summary?: AuditDecisionSummary) {
  if (!summary) {
    return ''
  }
  if (summary.rejectionCount > 0) {
    return `已驳回 ${summary.rejectionCount} 人`
  }
  return `已同意 ${summary.approvalCount}/${Math.max(1, summary.requiredApprovals)}`
}

function cvData(auditMyApply: AuditAuditDetail) {
  if (
    auditMyApply === undefined ||
    auditMyApply.meta === undefined ||
    auditMyApply.meta.appOrServiceMetadata === undefined ||
    auditMyApply.meta.applicant === undefined
  ) {
    return null
  }
  const parsed = parseAuditTargetMetadata(auditMyApply.meta.appOrServiceMetadata)
  if (!parsed) {
    return null
  }
  const did = auditMyApply.meta.applicant.split('::')[0]
  const latestComment = [...(auditMyApply.commentMeta || [])]
    .sort((left, right) => toAuditTimestamp(right.createdAt) - toAuditTimestamp(left.createdAt))[0]
  const auditType = String(auditMyApply.meta.auditType || parsed.operateType || '').trim()
  const summary = auditMyApply.summary

  const metadata: AuditDetailBox = {
    uid: auditMyApply.meta.uid,
    name: parsed.name || String(parsed.raw.name || ''),
    desc: String(parsed.raw.description || ''),
    serviceType: auditType === 'service' ? '服务' : auditType === 'application' ? '应用' : auditType,
    auditType,
    applicantor: did,
    state: getAuditState(summary),
    date: auditMyApply.meta.createdAt,
    msg: latestComment?.text ? String(latestComment.text) : '',
    progress: buildDecisionProgress(summary),
    summary
  }
  return metadata
}

export function convertAuditMetadata(auditMyApply: AuditAuditDetail[]) {
  return auditMyApply.map(cvData).filter((item): item is AuditDetailBox => item !== null)
}

function toAuditTimestamp(value?: string) {
  const timestamp = value ? Date.parse(value) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function parseAuditTargetMetadata(metadataRaw?: string): ParsedAuditTarget | null {
  if (!metadataRaw) {
    return null
  }
  try {
    const parsed = JSON.parse(metadataRaw) as Record<string, unknown>
    const operateType = String(parsed.operateType || '').trim()
    const uid = parsed.uid ? String(parsed.uid).trim() : ''
    const did = parsed.did ? String(parsed.did).trim() : ''
    const versionRaw = parsed.version
    const version = versionRaw !== undefined && versionRaw !== null ? Number(versionRaw) : undefined
    const normalizedVersion = Number.isFinite(version) ? version : undefined
    const name = parsed.name ? String(parsed.name).trim() : ''
    const key =
      uid ||
      (did && normalizedVersion !== undefined ? `${did}:${normalizedVersion}` : '') ||
      (operateType && name ? `${operateType}:${name}` : '')
    return {
      raw: parsed,
      operateType,
      uid: uid || undefined,
      did: did || undefined,
      version: normalizedVersion,
      name: name || undefined,
      owner: parsed.owner ? String(parsed.owner).trim() : undefined,
      ownerName: parsed.ownerName ? String(parsed.ownerName).trim() : undefined,
      key
    }
  } catch {
    return null
  }
}

export function isAuditForResource(
  audit: AuditAuditDetail,
  target: {
    auditType?: string
    uid?: string
    did?: string
    version?: number
    name?: string
    reason?: string
  }
) {
  if (target.reason && audit.meta?.reason !== target.reason) {
    return false
  }
  if (target.auditType && audit.meta?.auditType !== target.auditType) {
    return false
  }
  const parsed = parseAuditTargetMetadata(audit.meta?.appOrServiceMetadata)
  if (!parsed) {
    return false
  }
  if (target.auditType && parsed.operateType && parsed.operateType !== target.auditType) {
    return false
  }
  if (target.uid && parsed.uid) {
    return target.uid === parsed.uid
  }
  if (target.did && target.version !== undefined && parsed.did && parsed.version !== undefined) {
    return target.did === parsed.did && Number(target.version) === Number(parsed.version)
  }
  if (target.name && parsed.name) {
    return target.name === parsed.name
  }
  return false
}

export function resolveUsageAuditStatus(audit?: AuditAuditDetail): AuditApplyStatus {
  const state = getAuditState(audit?.summary)
  if (state === '审批通过') {
    return 'success'
  }
  if (state === '审批驳回') {
    return 'reject'
  }
  return 'applying'
}

export function pickLatestAuditsByResource(
  audits: AuditAuditDetail[],
  input: { auditType: AuditTargetType; reason: string }
) {
  const latestByKey = new Map<string, AuditAuditDetail>()
  for (const audit of audits) {
    if (audit.meta?.auditType !== input.auditType || audit.meta?.reason !== input.reason) {
      continue
    }
    const parsed = parseAuditTargetMetadata(audit.meta?.appOrServiceMetadata)
    if (!parsed?.key) {
      continue
    }
    const existing = latestByKey.get(parsed.key)
    if (!existing || toAuditTimestamp(audit.meta?.createdAt) > toAuditTimestamp(existing.meta?.createdAt)) {
      latestByKey.set(parsed.key, audit)
    }
  }
  return Array.from(latestByKey.values()).sort(
    (left, right) => toAuditTimestamp(right.meta?.createdAt) - toAuditTimestamp(left.meta?.createdAt)
  )
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

function normalizeMetadataString(metadata: unknown): string {
  if (typeof metadata === 'string') {
    return metadata
  }
  if (metadata && typeof metadata === 'object') {
    return JSON.stringify(metadata)
  }
  throw new Error('Invalid audit metadata')
}

function buildAuditSubmitPayload(meta: AuditAuditMetadata, metadataJson: string) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(metadataJson) as Record<string, unknown>
  } catch {
    throw new Error('Invalid audit metadata')
  }
  const targetType = String(parsed.operateType || meta.auditType || '').trim()
  const targetDid = String(parsed.did || '').trim()
  const targetVersion = Number(parsed.version)
  if (!targetType || !targetDid || !Number.isFinite(targetVersion)) {
    throw new Error('Missing audit target fields')
  }
  return {
    auditType: String(meta.auditType || ''),
    targetType,
    targetDid,
    targetVersion,
    applicant: String(meta.applicant || ''),
    approver: String(meta.approver || ''),
    reason: String(meta.reason || ''),
    appOrServiceMetadata: metadataJson
  }
}

class AuditClient {
  async create(meta: AuditAuditMetadata) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const metadataJson = normalizeMetadataString(meta.appOrServiceMetadata)
    const applicant = String(meta.applicant || `${session.actor}::${session.actor}`)
    const body = {
      ...(meta.uid ? { uid: meta.uid } : {}),
      appOrServiceMetadata: metadataJson,
      auditType: String(meta.auditType || ''),
      applicant,
      approver: String(meta.approver || ''),
      reason: String(meta.reason || '')
    }
    const signedBody = await createSignedActionBody({
      action: 'audit_submit',
      actor: session.actor,
      payload: buildAuditSubmitPayload({ ...meta, applicant }, metadataJson),
      body,
      sign: signWithWallet
    })
    const response = await fetch(apiUrl('/api/v1/public/audits'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<AuditAuditDetail>(response, 'Create audit failed')
  }

  async submitPublishRequest(input: { auditType: AuditTargetType; resource: Record<string, unknown> }) {
    const account = getCurrentAccount()
    if (!account) {
      notifyError('❌未查询到当前账户，请登录')
      return
    }
    const actor = normalizeAddress(account)
    return this.create({
      auditType: input.auditType,
      applicant: `${actor}::${actor}`,
      reason: '上架申请',
      appOrServiceMetadata: JSON.stringify({
        ...input.resource,
        operateType: input.auditType
      })
    })
  }

  async submitUsageRequest(input: {
    auditType: AuditTargetType
    resource: Record<string, unknown>
    approver: string
  }) {
    const account = getCurrentAccount()
    if (!account) {
      notifyError('❌未查询到当前账户，请登录')
      return
    }
    const actor = normalizeAddress(account)
    return this.create({
      auditType: input.auditType,
      applicant: `${actor}::${actor}`,
      approver: input.approver,
      reason: '申请使用',
      appOrServiceMetadata: JSON.stringify({
        ...input.resource,
        operateType: input.auditType
      })
    })
  }

  async search(condition: AuditAuditSearchCondition) {
    const result = await this.searchPage({ condition })
    return result?.items || []
  }

  async searchPage(input: {
    condition?: AuditAuditSearchCondition
    page?: number
    pageSize?: number
  }) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl('/api/v1/public/audits/search'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      },
      body: JSON.stringify({
        condition: input.condition || {},
        page: input.page,
        pageSize: input.pageSize
      })
    })
    const data = await parseEnvelope<{
      items?: AuditAuditDetail[]
      page?: AuditSearchPage
    }>(response, 'Search audits failed')
    return {
      items: data.items || [],
      page: data.page || {
        total: 0,
        page: input.page || 1,
        pageSize: input.pageSize || 10
      }
    } satisfies AuditSearchResult
  }

  private async submitDecision(
    decision: 'approve' | 'reject',
    metadata: AuditCommentMetadata
  ) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const auditId = String(metadata.auditId || '').trim()
    if (!auditId) {
      throw new Error('Missing audit id')
    }
    const body = {
      ...(metadata.uid ? { uid: metadata.uid } : {}),
      text: metadata.text || ''
    }
    const signedBody = await createSignedActionBody({
      action: 'audit_decision',
      actor: session.actor,
      payload: {
        auditId,
        decision,
        approver: session.actor,
        text: String(metadata.text || '')
      },
      body,
      sign: signWithWallet
    })
    const response = await fetch(
      apiUrl(`/api/v1/admin/audits/${auditId}/${decision === 'approve' ? 'approve' : 'reject'}`),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${session.token}`,
          accept: 'application/json'
        },
        body: JSON.stringify(signedBody)
      }
    )
    return parseEnvelope<AuditCommentMetadata>(
      response,
      decision === 'approve' ? 'Approve failed' : 'Reject failed'
    )
  }

  async passed(metadata: AuditCommentMetadata) {
    return this.submitDecision('approve', metadata)
  }

  async reject(metadata: AuditCommentMetadata) {
    return this.submitDecision('reject', metadata)
  }

  async detail(uid: string) {
    const token = await requireReadToken()
    if (!token) {
      return
    }
    const response = await fetch(apiUrl(`/api/v1/public/audits/${uid}`), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    })
    return parseEnvelope<AuditAuditDetail>(response, 'Fetch audit failed')
  }

  async cancel(uid: string) {
    const session = await requireWriteSession()
    if (!session) {
      return
    }
    const signedBody = await createSignedActionBody({
      action: 'audit_cancel',
      actor: session.actor,
      payload: {
        auditId: uid
      },
      body: {},
      sign: signWithWallet
    })
    const response = await fetch(apiUrl(`/api/v1/public/audits/${uid}`), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.token}`,
        accept: 'application/json'
      },
      body: JSON.stringify(signedBody)
    })
    return parseEnvelope<{ uid?: string }>(response, 'Cancel audit failed')
  }
}

export default new AuditClient()
