import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'
import { AuditManager } from '../manager/audit'
import {
    Audit,
    AuditDecisionSummary,
    AuditDetail,
    convertAuditDOFrom,
    convertAuditMetadataTo,
    PageResult,
    QueryCondition
} from '../model/audit'
import { CommentManager } from '../manager/comments';
import { COMMENT_STATUS_AGREE, COMMENT_STATUS_REJECT } from '../model/comments'
import { AuditDO, CommentDO } from '../mapper/entity';
import { getRequestUser } from '../../common/requestContext';
import {
    ensureUserActive,
    ensureUserCanApproveAudit,
    ensureUserCanSubmitAudit,
    ensureUserCanWriteBusinessData,
    isAdminUser
} from '../../common/permission';
import { ApplicationManager } from '../manager/application';
import { getConfig } from '../../config/runtime';
import { AuditRuntimeConfig } from '../../config';
import { v4 as uuidv4 } from 'uuid'
import { isApproverMatch, normalizeAuditAddress } from '../../common/auditAccess';
import { createResponsePage } from '../../common/page';
import { NotificationService, safelyRunNotificationTask } from './notification';

export class AuditService {
    private logger: Logger = SingletonLogger.get()
    private auditManager: AuditManager
    private commentManager: CommentManager
    private applicationManager: ApplicationManager
    private notificationService: NotificationService

    constructor() {
        this.auditManager = new AuditManager()
        this.commentManager = new CommentManager()
        this.applicationManager = new ApplicationManager()
        this.notificationService = new NotificationService()
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

    private normalizeApproverActors(approvers: string[]) {
        return Array.from(
            new Set(
                approvers
                    .map((entry) => this.normalizeActor(entry))
                    .filter(Boolean)
            )
        )
    }

    private getCommentActor(comment: CommentDO) {
        return this.normalizeActor(comment.signature || '')
    }

    private summarizeDecision(comments: CommentDO[], requiredApprovals: number) {
        const agreeStatus = COMMENT_STATUS_AGREE
        const rejectStatus = COMMENT_STATUS_REJECT
        const approvals = new Set<string>()
        const rejections = new Set<string>()
        for (const comment of comments) {
            const actor = this.getCommentActor(comment) || String(comment.uid || '').trim().toLowerCase()
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

    private buildDecisionSummary(comments: CommentDO[], approverRaw?: string): AuditDecisionSummary {
        const policy = this.parseApproverPolicy(approverRaw)
        const decision = this.summarizeDecision(comments || [], policy.requiredApprovals)
        const approvers = this.normalizeApproverActors(policy.approvers)
        const approvedBy = Array.from(decision.approvals)
        const rejectedBy = Array.from(decision.rejections)
        const pendingApprovers = approvers.filter(
            (actor) => !decision.approvals.has(actor) && !decision.rejections.has(actor)
        )
        let state: AuditDecisionSummary['state'] = '待审批'
        if (decision.rejectionCount > 0) {
            state = '审批驳回'
        } else if (decision.approvalCount >= policy.requiredApprovals) {
            state = '审批通过'
        }
        return {
            state,
            approvers,
            requiredApprovals: decision.requiredApprovals,
            approvalCount: decision.approvalCount,
            rejectionCount: decision.rejectionCount,
            approvedBy,
            rejectedBy,
            pendingApprovers,
            isDecided: state !== '待审批'
        }
    }

    private resolveAuditState(comments: CommentDO[], approverRaw?: string) {
        return this.buildDecisionSummary(comments || [], approverRaw).state
    }

    private toAuditDetail(auditDO: AuditDO, comments: CommentDO[]) {
        return convertAuditMetadataTo(
            auditDO,
            comments,
            this.buildDecisionSummary(comments || [], auditDO?.approver)
        )
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
        if (!operateType || operateType !== 'application') {
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

    private normalizeActor(value: string) {
        return normalizeAuditAddress(value)
    }

    private extractApplicantAddress(applicant: string) {
        return this.normalizeActor((applicant || '').split('::')[0] || '')
    }

    private notifyAuditDecision(input: {
        type: 'approved' | 'rejected'
        audit?: AuditDO | null
        actor?: string
    }) {
        const audit = input.audit
        if (!audit) {
            return
        }
        const applicant = this.extractApplicantAddress(audit.applicant)
        if (!applicant) {
            return
        }
        const targetName = String(audit.targetName || '').trim()
        let targetUid = ''
        try {
            const parsed = JSON.parse(String(audit.appOrServiceMetadata || ''))
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                targetUid = String((parsed as Record<string, unknown>).uid || '').trim()
            }
        } catch {
            targetUid = ''
        }
        void safelyRunNotificationTask(async () => {
            if (input.type === 'approved') {
                await this.notificationService.notifyAuditApproved({
                    auditId: audit.uid,
                    applicant,
                    actor: input.actor,
                    targetName,
                    auditType: audit.auditType,
                    targetUid,
                    targetDid: audit.targetDid,
                    targetVersion: audit.targetVersion,
                })
                return
            }
            await this.notificationService.notifyAuditRejected({
                auditId: audit.uid,
                applicant,
                actor: input.actor,
                targetName,
                auditType: audit.auditType,
                targetUid,
                targetDid: audit.targetDid,
                targetVersion: audit.targetVersion,
            })
        })
    }

    private notifyAuditCreated(input: {
        audit: AuditDO
        actor?: string
        applicant?: string
    }) {
        const audit = input.audit
        if (!audit) {
            return
        }
        const policy = this.parseApproverPolicy(audit.approver)
        const recipients = this.normalizeApproverActors(policy.approvers)
        if (recipients.length === 0) {
            return
        }
        let targetUid = ''
        try {
            const parsed = JSON.parse(String(audit.appOrServiceMetadata || ''))
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                targetUid = String((parsed as Record<string, unknown>).uid || '').trim()
            }
        } catch {
            targetUid = ''
        }
        void safelyRunNotificationTask(async () => {
            await this.notificationService.notifyAuditCreated({
                auditId: audit.uid,
                recipients,
                actor: input.actor,
                applicant: input.applicant,
                targetName: String(audit.targetName || '').trim(),
                auditType: audit.auditType,
                targetUid,
                targetDid: audit.targetDid,
                targetVersion: audit.targetVersion,
            })
        })
    }

    private enrichAuditMetadata(
        metadataRaw: string,
        target: { operateType: string; did: string; version: number },
        existingTarget: any
    ) {
        let parsed: Record<string, unknown> = {}
        try {
            const value = JSON.parse(metadataRaw)
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                parsed = value as Record<string, unknown>
            }
        } catch {
            // keep validated raw content unchanged on parse failure
        }
        const enriched: Record<string, unknown> = {
            ...parsed,
            operateType: target.operateType,
            did: target.did,
            version: target.version
        }
        if (!enriched.owner && existingTarget?.owner) {
            enriched.owner = existingTarget.owner
        }
        if (!enriched.name && existingTarget?.name) {
            enriched.name = existingTarget.name
        }
        return JSON.stringify(enriched)
    }

    private resolvePreviousTargetState(audit: { previousTargetStatus?: string; previousTargetIsOnline?: boolean }) {
        const status =
            typeof audit.previousTargetStatus === 'string' && audit.previousTargetStatus.trim() !== ''
                ? audit.previousTargetStatus.trim()
                : 'BUSINESS_STATUS_PENDING'
        return {
            status,
            isOnline: Boolean(audit.previousTargetIsOnline)
        }
    }

    private isPublishReason(reason?: string) {
        return !!reason && reason.includes('上架')
    }

    private isDuplicatePendingAudit(
        existing: { reason?: string; applicant?: string },
        incoming: { reason?: string; applicant?: string }
    ) {
        const existingPublish = this.isPublishReason(existing.reason)
        const incomingPublish = this.isPublishReason(incoming.reason)
        if (existingPublish || incomingPublish) {
            return existingPublish && incomingPublish
        }
        return (
            String(existing.reason || '').trim() === String(incoming.reason || '').trim() &&
            this.extractApplicantAddress(String(existing.applicant || '')) ===
                this.extractApplicantAddress(String(incoming.applicant || ''))
        )
    }

    private async ensureTargetExists(target: { operateType: string; did: string; version: number }) {
        const app = await this.applicationManager.query(target.did, target.version)
        if (!app) {
            throw new Error('Target application not found')
        }
        return app
    }

    private async hasPendingAudit(
        target: { operateType: string; did: string; version: number },
        current: { reason?: string; applicant?: string }
    ) {
        const audits = await this.auditManager.queryByTarget(target.operateType, target.did, target.version)
        if (!audits || audits.length === 0) {
            return false
        }
        for (const audit of audits) {
            if (!this.isDuplicatePendingAudit(audit, current)) {
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
        await this.applicationManager.updatePublishState(target.did, target.version, status, isOnline)
    }

    async detail(id: string): Promise<AuditDetail> {
        const auditDO = await this.auditManager.queryById(id)
        if (auditDO === undefined || auditDO === null) {
            throw new Error('Audit not found')
        }
        const comments = await this.commentManager.queryByAuditId(id)
        return this.toAuditDetail(auditDO, comments)
    }

    async create(meta: Audit) {
        const user = getRequestUser()
        if (user?.address && meta.applicant) {
            await ensureUserActive(user.address)
            await ensureUserCanSubmitAudit(user.address)
            const applicantDid = meta.applicant.split('::')[0]
            const normalizedApplicant = applicantDid?.trim().toLowerCase()
            const normalizedUser = this.normalizeActor(user.address)
            if (normalizedApplicant && normalizedApplicant !== normalizedUser) {
                throw new Error('Applicant mismatch')
            }
        }
        const target = this.parseAuditTarget(meta)
        const targetRecord = await this.ensureTargetExists(target)
        const isPublishRequest = this.isPublishReason(meta.reason)
        if (isPublishRequest && meta.applicant) {
            const applicantDid = meta.applicant.split('::')[0]
            const normalizedApplicant = applicantDid?.trim().toLowerCase()
            const normalizedOwner = targetRecord.owner?.trim().toLowerCase()
            if (normalizedOwner && normalizedApplicant && normalizedOwner !== normalizedApplicant) {
                throw new Error('Applicant is not owner')
            }
        }
        const approverPolicy = this.resolveApproverPolicy(meta.approver, meta.reason)
        if (approverPolicy.approvers.length === 0) {
            throw new Error('Approver is required')
        }
        meta.approver = approverPolicy.raw
        meta.appOrServiceMetadata = this.enrichAuditMetadata(meta.appOrServiceMetadata, target, targetRecord)
        const hasPending = await this.hasPendingAudit(target, {
            reason: meta.reason,
            applicant: meta.applicant
        })
        if (hasPending) {
            throw new Error('Duplicate pending audit')
        }
        const auditDO = convertAuditDOFrom(meta)
        auditDO.targetType = target.operateType
        auditDO.targetDid = target.did
        auditDO.targetVersion = target.version
        auditDO.targetName = targetRecord.name || target.name || ''
        auditDO.previousTargetStatus = targetRecord.status || 'BUSINESS_STATUS_PENDING'
        auditDO.previousTargetIsOnline = Boolean(targetRecord.isOnline)
        auditDO.uid = auditDO.uid || uuidv4()
        await this.auditManager.save(auditDO)
        if (isPublishRequest) {
            await this.updateTargetPublishState(target, 'BUSINESS_STATUS_REVIEWING', false)
        }
        this.notifyAuditCreated({
            audit: auditDO,
            actor: user?.address,
            applicant: meta.applicant,
        })
        return await this.queryById(auditDO.uid)
    }

    async queryById(uid: string): Promise<AuditDetail> {
        const auditDO = await this.auditManager.queryById(uid)
        if (auditDO === undefined || auditDO === null) {
            throw new Error('Audit not found')
        }
        const comments = await this.commentManager.queryByAuditId(auditDO.uid)
        return this.toAuditDetail(auditDO, comments)
    }

    async queryByCondition(queryCondition: QueryCondition): Promise<PageResult> {
        const condition = {
            approver: queryCondition.approver,
            applicant: queryCondition.applicant,
            name: queryCondition.name,
            auditType: queryCondition.auditType,
            startTime: queryCondition.startTime,
            endTime: queryCondition.endTime
        }
        const states = Array.isArray(queryCondition.states)
            ? queryCondition.states.map((item) => String(item).trim()).filter(Boolean)
            : []

        if (states.length === 0) {
            const result = await this.auditManager.queryByCondition(
                condition,
                queryCondition.page,
                queryCondition.pageSize
            )
            const commentsByAudit = new Map<string, CommentDO[]>()
            for (const item of result.data) {
                const comments = await this.commentManager.queryByAuditId(item.uid)
                commentsByAudit.set(item.uid, comments)
            }
            return {
                data: result.data.map((item) => this.toAuditDetail(item, commentsByAudit.get(item.uid) || [])),
                page: result.page
            }
        }

        const audits = await this.auditManager.queryByConditionAll(condition)
        const commentsByAudit = new Map<string, CommentDO[]>()
        for (const item of audits) {
            const comments = await this.commentManager.queryByAuditId(item.uid)
            commentsByAudit.set(item.uid, comments)
        }
        const filtered = audits.filter((item) =>
            states.includes(this.resolveAuditState(commentsByAudit.get(item.uid) || [], item.approver))
        )
        const start = Math.max(0, (queryCondition.page - 1) * queryCondition.pageSize)
        const paged = filtered.slice(start, start + queryCondition.pageSize)
        return {
            data: paged.map((item) => this.toAuditDetail(item, commentsByAudit.get(item.uid) || [])),
            page: createResponsePage(filtered.length, queryCondition.page, queryCondition.pageSize)
        }
    }

    async cancel(uid: string) {
        const user = getRequestUser()
        const audit = await this.auditManager.queryById(uid)
        if (!audit) {
            throw new Error('Audit not found')
        }
        if (user?.address) {
            await ensureUserActive(user.address)
            const isAdmin = await isAdminUser(user.address)
            if (!isAdmin) {
                await ensureUserCanWriteBusinessData(user.address)
            }
            const applicantAddress = this.extractApplicantAddress(audit.applicant)
            if (!isAdmin && applicantAddress !== this.normalizeActor(user.address)) {
                throw new Error('Applicant permission denied')
            }
        }
        const comments: CommentDO[] = await this.commentManager.queryByAuditId(uid)
        const policy = this.parseApproverPolicy(audit.approver)
        const decision = this.summarizeDecision(comments, policy.requiredApprovals)
        if (decision.rejectionCount > 0 || decision.approvalCount >= policy.requiredApprovals) {
            throw new Error('Audit already decided')
        }
        if (this.isPublishReason(audit.reason) && audit.appOrServiceMetadata) {
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
            const previousState = this.resolvePreviousTargetState(audit)
            await this.updateTargetPublishState(target, previousState.status, previousState.isOnline)
        }
        for (let i = 0; i < comments.length; i++) {
            await this.commentManager.delete(comments[i].uid)
        }
        return await this.auditManager.delete(uid)
    }

    async approve(comment: CommentDO) {
        const user = getRequestUser()
        let audit = await this.auditManager.queryById(comment.auditId)
        let actor = ''
        if (user?.address) {
            await ensureUserActive(user.address)
            await ensureUserCanApproveAudit(user.address)
            const isAdmin = await isAdminUser(user.address)
            if (!audit || (!isAdmin && !isApproverMatch(audit.approver, user.address))) {
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
        if (audit && this.isPublishReason(audit.reason)) {
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
                this.notifyAuditDecision({
                    type: 'approved',
                    audit,
                    actor,
                })
            }
        } else if (audit) {
            const updated = await this.commentManager.queryByAuditId(comment.auditId)
            const updatedDecision = this.summarizeDecision(updated, policy.requiredApprovals)
            if (updatedDecision.approvalCount >= policy.requiredApprovals) {
                this.notifyAuditDecision({
                    type: 'approved',
                    audit,
                    actor,
                })
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
            await ensureUserCanApproveAudit(user.address)
            const isAdmin = await isAdminUser(user.address)
            if (!audit || (!isAdmin && !isApproverMatch(audit.approver, user.address))) {
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
        if (audit && this.isPublishReason(audit.reason)) {
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
        this.notifyAuditDecision({
            type: 'rejected',
            audit,
            actor,
        })
        return saved
    }
    
}
