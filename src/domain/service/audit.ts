import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'
import { AuditManager } from '../manager/audit'
import { Audit, AuditDetail, convertAuditDOFrom, convertAuditMetadataTo, PageResult, QueryCondition } from '../model/audit'
import { CommentManager } from '../manager/comments';
import { COMMENT_STATUS_AGREE, COMMENT_STATUS_REJECT } from '../model/comments'
import { CommentDO } from '../mapper/entity';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive, isAdminUser } from '../../common/permission';
import { ApplicationManager } from '../manager/application';
import { ServiceManager } from '../manager/service';
import { getConfig } from '../../config/runtime';
import { AuditRuntimeConfig } from '../../config';
import { v4 as uuidv4 } from 'uuid'

export class AuditService {
    private logger: Logger = SingletonLogger.get()
    private auditManager: AuditManager
    private commentManager: CommentManager
    private applicationManager: ApplicationManager
    private serviceManager: ServiceManager

    constructor() {
        this.auditManager = new AuditManager()
        this.commentManager = new CommentManager()
        this.applicationManager = new ApplicationManager()
        this.serviceManager = new ServiceManager()
    }

    private getAuditConfig(): AuditRuntimeConfig {
        const config = getConfig<AuditRuntimeConfig>('audit')
        return config || {}
    }

    private normalizeApproverList(input: unknown): string[] {
        if (!input) return []
        if (Array.isArray(input)) {
            return input.map((entry) => String(entry).trim()).filter(Boolean)
        }
        if (typeof input === 'string') {
            const trimmed = input.trim()
            if (!trimmed) return []
            try {
                const parsed = JSON.parse(trimmed)
                return this.normalizeApproverList(parsed)
            } catch {
                return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
            }
        }
        if (typeof input === 'object') {
            const obj = input as any
            if (Array.isArray(obj.approvers)) {
                return this.normalizeApproverList(obj.approvers)
            }
        }
        return []
    }

    private normalizeRequiredApprovals(value: unknown, maxApprovers: number) {
        const numeric = typeof value === 'number' ? value : Number(value)
        let required = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1
        if (maxApprovers > 0) {
            required = Math.min(required, maxApprovers)
        }
        return required
    }

    private buildApproverPolicy(approvers: string[], requiredApprovals: number) {
        return JSON.stringify({ approvers, requiredApprovals })
    }

    private parseApproverPolicyRaw(raw: string | undefined) {
        if (!raw || !raw.trim()) {
            return { approvers: [], requiredApprovals: undefined }
        }
        try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
                return { approvers: this.normalizeApproverList(parsed), requiredApprovals: undefined }
            }
            if (parsed && typeof parsed === 'object') {
                const approvers = this.normalizeApproverList((parsed as any).approvers)
                const requiredRaw = (parsed as any).requiredApprovals
                const required = typeof requiredRaw === 'number' ? requiredRaw : Number(requiredRaw)
                return { approvers, requiredApprovals: Number.isFinite(required) ? required : undefined }
            }
        } catch {
            // ignore parse errors
        }
        return { approvers: this.normalizeApproverList(raw), requiredApprovals: undefined }
    }

    private resolveApproverPolicy(metaApprover?: string, reason?: string) {
        const config = this.getAuditConfig()
        const configuredApprovers = this.normalizeApproverList(config?.approvers)
        const metaPolicy = this.parseApproverPolicyRaw(metaApprover)
        const metaApprovers = metaPolicy.approvers
        const isPublish = !!reason && reason.includes('上架')
        const useConfig = (isPublish || metaApprovers.length === 0) && configuredApprovers.length > 0
        const approvers = useConfig ? configuredApprovers : metaApprovers
        if (approvers.length === 0) {
            return { approvers: [], requiredApprovals: 1, raw: metaApprover || '' }
        }
        const requiredBase = useConfig ? config?.requiredApprovals : (metaPolicy.requiredApprovals ?? 1)
        const requiredApprovals = this.normalizeRequiredApprovals(requiredBase, approvers.length)
        const raw = this.buildApproverPolicy(approvers, requiredApprovals)
        return { approvers, requiredApprovals, raw }
    }

    private parseApproverPolicy(raw: string | undefined) {
        const config = this.getAuditConfig()
        const rawPolicy = this.parseApproverPolicyRaw(raw)
        const fallbackApprovers = this.normalizeApproverList(config?.approvers)
        const approvers = rawPolicy.approvers.length > 0 ? rawPolicy.approvers : fallbackApprovers
        const requiredBase = rawPolicy.requiredApprovals ?? config?.requiredApprovals
        const requiredApprovals = this.normalizeRequiredApprovals(requiredBase, approvers.length)
        return { approvers, requiredApprovals }
    }

    private getCommentActor(comment: CommentDO) {
        const signature = (comment.signature || '').trim()
        return signature ? signature.toLowerCase() : ''
    }

    private summarizeDecision(comments: CommentDO[], requiredApprovals: number) {
        const agreeStatus = COMMENT_STATUS_AGREE
        const rejectStatus = COMMENT_STATUS_REJECT
        const approvals = new Set<string>()
        const rejections = new Set<string>()
        for (const comment of comments) {
            const actor = this.getCommentActor(comment) || comment.uid
            if (comment.status === agreeStatus) {
                approvals.add(actor)
            }
            if (comment.status === rejectStatus) {
                rejections.add(actor)
            }
        }
        return {
            approvals,
            rejections,
            approvalCount: approvals.size,
            rejectionCount: rejections.size,
            requiredApprovals
        }
    }

    private isApproverMatch(approver: string, address: string) {
        if (!approver) return false
        const normalizedAddress = address.trim().toLowerCase()
        const matchEntry = (entry: string) => {
            const normalizedEntry = entry.trim().toLowerCase()
            return normalizedEntry === normalizedAddress || normalizedEntry.startsWith(`${normalizedAddress}::`) || normalizedEntry.includes(normalizedAddress)
        }
        try {
            const parsed = JSON.parse(approver)
            if (Array.isArray(parsed)) {
                return parsed.some((entry) => typeof entry === 'string' && matchEntry(entry))
            }
            if (parsed && typeof parsed === 'object') {
                const list = Array.isArray((parsed as any).approvers) ? (parsed as any).approvers : []
                return list.some((entry: unknown) => typeof entry === 'string' && matchEntry(entry))
            }
        } catch {
            // ignore parse errors
        }
        const candidates = approver.split(',').map((item) => item.trim()).filter(Boolean)
        if (candidates.length > 1) {
            return candidates.some((entry) => matchEntry(entry))
        }
        return matchEntry(approver)
    }

    private parseAuditTarget(meta: Audit) {
        if (!meta.appOrServiceMetadata) {
            throw new Error('appOrServiceMetadata is required')
        }
        let parsed: any
        try {
            parsed = JSON.parse(meta.appOrServiceMetadata)
        } catch (error) {
            throw new Error('Invalid appOrServiceMetadata JSON')
        }

        const operateType = parsed.operateType || meta.auditType
        if (!operateType || (operateType !== 'application' && operateType !== 'service')) {
            throw new Error('Invalid auditType')
        }
        if (parsed.operateType && meta.auditType && parsed.operateType !== meta.auditType) {
            throw new Error('auditType mismatch')
        }

        const did = parsed.did
        const version = parsed.version !== undefined ? Number(parsed.version) : undefined
        if (!did || Number.isNaN(version) || version === undefined) {
            throw new Error('Missing did/version in metadata')
        }

        return {
            operateType,
            did,
            version,
            owner: parsed.owner,
            name: parsed.name
        }
    }

    private async ensureTargetExists(target: { operateType: string; did: string; version: number }) {
        if (target.operateType === 'application') {
            const app = await this.applicationManager.query(target.did, target.version)
            if (!app) {
                throw new Error('Target application not found')
            }
            return app
        }
        const service = await this.serviceManager.query(target.did, target.version)
        if (!service) {
            throw new Error('Target service not found')
        }
        return service
    }

    private async hasPendingAudit(applicant: string, target: { operateType: string; did: string; version: number }) {
        const audits = await this.auditManager.queryByTarget(target.operateType, target.did, target.version)
        if (!audits || audits.length === 0) {
            return false
        }
        for (const audit of audits) {
            if (applicant && audit.applicant !== applicant) {
                continue
            }
            const comments = await this.commentManager.queryByAuditId(audit.uid)
            if (!comments || comments.length === 0) {
                return true
            }
            const policy = this.parseApproverPolicy(audit.approver)
            const decision = this.summarizeDecision(comments, policy.requiredApprovals)
            if (decision.rejectionCount === 0 && decision.approvalCount < policy.requiredApprovals) {
                return true
            }
        }
        return false
    }

    private async updateTargetPublishState(target: { operateType: string; did: string; version: number }, status: string, isOnline: boolean) {
        if (target.operateType === 'application') {
            await this.applicationManager.updatePublishState(target.did, target.version, status, isOnline)
            return
        }
        await this.serviceManager.updatePublishState(target.did, target.version, status, isOnline)
    }

    async detail(id: string): Promise<AuditDetail> {
        const auditDO = await this.auditManager.queryById(id)
        if (auditDO === undefined || auditDO === null) {
            throw new Error("auditDO is undefined")
        }
        const comments = await this.commentManager.queryByAuditId(id)
        return convertAuditMetadataTo(auditDO, comments)
    }

    async create(meta: Audit) {
        const user = getRequestUser()
        if (user?.address && meta.applicant) {
            await ensureUserActive(user.address)
            const applicantDid = meta.applicant.split('::')[0]
            const normalizedApplicant = applicantDid?.trim().toLowerCase()
            const normalizedUser = user.address.trim().toLowerCase()
            if (normalizedApplicant && normalizedApplicant !== normalizedUser) {
                throw new Error('Applicant mismatch')
            }
        }
        const target = this.parseAuditTarget(meta)
        await this.ensureTargetExists(target)
        if (meta.applicant) {
            const applicantDid = meta.applicant.split('::')[0]
            const normalizedApplicant = applicantDid?.trim().toLowerCase()
            const normalizedOwner = target.owner?.trim().toLowerCase()
            if (normalizedOwner && normalizedApplicant && normalizedOwner !== normalizedApplicant) {
                throw new Error('Applicant is not owner')
            }
        }
        const approverPolicy = this.resolveApproverPolicy(meta.approver, meta.reason)
        if (approverPolicy.approvers.length === 0) {
            throw new Error('Approver is required')
        }
        meta.approver = approverPolicy.raw
        const hasPending = await this.hasPendingAudit(meta.applicant, target)
        if (hasPending) {
            throw new Error('Duplicate pending audit')
        }
        const auditDO = convertAuditDOFrom(meta)
        auditDO.targetType = target.operateType
        auditDO.targetDid = target.did
        auditDO.targetVersion = target.version
        auditDO.targetName = target.name || ''
        auditDO.uid = auditDO.uid || uuidv4()
        const res = await this.auditManager.save(auditDO)
        if (meta.reason && meta.reason.includes('上架')) {
            await this.updateTargetPublishState(target, 'BUSINESS_STATUS_REVIEWING', false)
        }
        return await this.queryById(auditDO.uid)
    }

    async queryById(uid: string): Promise<AuditDetail> {
        const auditDO = await this.auditManager.queryById(uid)
        if (auditDO === undefined || auditDO === null) {
            throw new Error("auditDO is undefined")
        }
        const comments = await this.commentManager.queryByAuditId(auditDO.uid)
        return convertAuditMetadataTo(auditDO, comments)
    }

    async queryByCondition(queryCondition: QueryCondition): Promise<PageResult> {
        const result = await this.auditManager.queryByCondition(
            queryCondition.approver, queryCondition.applicant, queryCondition.name, queryCondition.startTime, queryCondition.endTime, queryCondition.page, queryCondition.pageSize
        )
        
        const uids = result.data.map((u) => u.uid)
        const commentsByAudit = new Map<string, CommentDO[]>()
        for (const id of uids) {
            const comments = await this.commentManager.queryByAuditId(id)
            commentsByAudit.set(id, comments)
        }
        return {
            data: result.data.map((s) => convertAuditMetadataTo(s, commentsByAudit.get(s.uid))),
            page: result.page
        }
    }

    async cancel(uid: string) {
        const comments: CommentDO[] = await this.commentManager.queryByAuditId(uid)
        const audit = await this.auditManager.queryById(uid)
        for (let i = 0; i < comments.length; i++) {
            await this.commentManager.delete(comments[i].uid)
        }
        if (audit?.reason && audit.reason.includes('上架') && audit.appOrServiceMetadata) {
            const target = this.parseAuditTarget({
                uid: audit.uid,
                appOrServiceMetadata: audit.appOrServiceMetadata,
                auditType: audit.auditType,
                applicant: audit.applicant,
                approver: audit.approver,
                reason: audit.reason,
                createdAt: audit.createdAt.toISOString(),
                updatedAt: audit.updatedAt.toISOString(),
                signature: audit.signature,
            })
            await this.updateTargetPublishState(target, 'BUSINESS_STATUS_PENDING', false)
        }
        return await this.auditManager.delete(uid)
    }

    async approve(comment: CommentDO) {
        const user = getRequestUser()
        let audit = await this.auditManager.queryById(comment.auditId)
        let actor = ''
        if (user?.address) {
            await ensureUserActive(user.address)
            const isAdmin = await isAdminUser(user.address)
            if (!audit || (!isAdmin && !this.isApproverMatch(audit.approver, user.address))) {
                throw new Error('Approver permission denied')
            }
            actor = user.address.trim().toLowerCase()
            comment.signature = actor
        }
        const policy = this.parseApproverPolicy(audit?.approver || '')
        const existing = await this.commentManager.queryByAuditId(comment.auditId)
        const decision = this.summarizeDecision(existing, policy.requiredApprovals)
        if (decision.rejectionCount > 0 || decision.approvalCount >= policy.requiredApprovals) {
            throw new Error('Audit already decided')
        }
        if (actor && (decision.approvals.has(actor) || decision.rejections.has(actor))) {
            throw new Error('Approver already submitted')
        }
        comment.uid = comment.uid || uuidv4()
        comment.status = COMMENT_STATUS_AGREE
        const saved = await this.commentManager.save(comment)
        if (!audit) {
            audit = await this.auditManager.queryById(comment.auditId)
        }
        if (audit) {
            const updated = await this.commentManager.queryByAuditId(comment.auditId)
            const updatedDecision = this.summarizeDecision(updated, policy.requiredApprovals)
            if (updatedDecision.approvalCount >= policy.requiredApprovals) {
                const target = this.parseAuditTarget({
                    uid: audit.uid,
                    appOrServiceMetadata: audit.appOrServiceMetadata,
                    auditType: audit.auditType,
                    applicant: audit.applicant,
                    approver: audit.approver,
                    reason: audit.reason,
                    createdAt: audit.createdAt.toISOString(),
                    updatedAt: audit.updatedAt.toISOString(),
                    signature: audit.signature,
                })
                await this.updateTargetPublishState(target, 'BUSINESS_STATUS_ONLINE', true)
            }
        }
        return saved
    }

    async reject(comment: CommentDO) {
        const user = getRequestUser()
        let audit = await this.auditManager.queryById(comment.auditId)
        let actor = ''
        if (user?.address) {
            await ensureUserActive(user.address)
            const isAdmin = await isAdminUser(user.address)
            if (!audit || (!isAdmin && !this.isApproverMatch(audit.approver, user.address))) {
                throw new Error('Approver permission denied')
            }
            actor = user.address.trim().toLowerCase()
            comment.signature = actor
        }
        const policy = this.parseApproverPolicy(audit?.approver || '')
        const existing = await this.commentManager.queryByAuditId(comment.auditId)
        const decision = this.summarizeDecision(existing, policy.requiredApprovals)
        if (decision.rejectionCount > 0 || decision.approvalCount >= policy.requiredApprovals) {
            throw new Error('Audit already decided')
        }
        if (actor && (decision.approvals.has(actor) || decision.rejections.has(actor))) {
            throw new Error('Approver already submitted')
        }
        comment.uid = comment.uid || uuidv4()
        comment.status = COMMENT_STATUS_REJECT
        const saved = await this.commentManager.save(comment)
        if (!audit) {
            audit = await this.auditManager.queryById(comment.auditId)
        }
        if (audit) {
            const target = this.parseAuditTarget({
                uid: audit.uid,
                appOrServiceMetadata: audit.appOrServiceMetadata,
                auditType: audit.auditType,
                applicant: audit.applicant,
                approver: audit.approver,
                reason: audit.reason,
                createdAt: audit.createdAt.toISOString(),
                updatedAt: audit.updatedAt.toISOString(),
                signature: audit.signature,
            })
            await this.updateTargetPublishState(target, 'BUSINESS_STATUS_REJECTED', false)
        }
        return saved
    }
    
}
