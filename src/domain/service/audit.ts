import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'
import { AuditManager } from '../manager/audit'
import { AuditDetail, AuditMetadata, CommentStatusEnum } from '../../yeying/api/audit/audit';
import { generateUuid, convertAuditMetadataFrom } from '../../application/model/audit'
import { convertAuditMetadataTo, PageResult, QueryCondition } from '../model/audit';
import { CommentManager } from '../manager/comments';
import { convertCommentMetadata, convertCommentStatusTo } from '../model/comments';
import { CommentDO } from '../mapper/entity';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive, isAdminUser } from '../../common/permission';
import { ApplicationManager } from '../manager/application';
import { ServiceManager } from '../manager/service';

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

    private isApproverMatch(approver: string, address: string) {
        if (!approver) return false
        try {
            const parsed = JSON.parse(approver)
            if (Array.isArray(parsed)) {
                return parsed.some((entry) => typeof entry === 'string' && (entry === address || entry.startsWith(`${address}::`) || entry.includes(address)))
            }
        } catch {
            // ignore parse errors
        }
        const candidates = approver.split(',').map((item) => item.trim()).filter(Boolean)
        if (candidates.length > 1) {
            return candidates.some((entry) => entry === address || entry.startsWith(`${address}::`) || entry.includes(address))
        }
        return approver === address || approver.startsWith(`${address}::`) || approver.includes(address)
    }

    private parseAuditTarget(meta: AuditMetadata) {
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

    async detail(id:string) {
        const auditDO = await this.auditManager.queryById(id)
        if (auditDO === undefined || auditDO === null) {
            throw new Error("auditDO is undefined")
        }
        const metadata = convertAuditMetadataTo(auditDO, undefined)
        const comments = await this.commentManager.queryByAuditId(id)

        return AuditDetail.create({
            meta: metadata as AuditMetadata,
            commentMeta: comments.map(item => convertCommentMetadata(item))
        })
    }

    async create(meta: AuditMetadata) {
        const user = getRequestUser()
        if (user?.address && meta.applicant) {
            await ensureUserActive(user.address)
            const applicantDid = meta.applicant.split('::')[0]
            if (applicantDid && applicantDid !== user.address) {
                throw new Error('Applicant mismatch')
            }
        }
        const target = this.parseAuditTarget(meta)
        await this.ensureTargetExists(target)
        if (meta.applicant) {
            const applicantDid = meta.applicant.split('::')[0]
            if (target.owner && applicantDid && target.owner !== applicantDid) {
                throw new Error('Applicant is not owner')
            }
        }
        const hasPending = await this.hasPendingAudit(meta.applicant, target)
        if (hasPending) {
            throw new Error('Duplicate pending audit')
        }
        const auditDO = convertAuditMetadataFrom(meta)
        auditDO.targetType = target.operateType
        auditDO.targetDid = target.did
        auditDO.targetVersion = target.version
        auditDO.targetName = target.name || ''
        auditDO.uid = auditDO.uid || generateUuid()
        const res = await this.auditManager.save(auditDO)
        if (meta.reason && meta.reason.includes('上架')) {
            await this.updateTargetPublishState(target, 'BUSINESS_STATUS_REVIEWING', false)
        }
        return await this.queryById(auditDO.uid)
    }

    async queryById(uid: string) {
        const auditDO = await this.auditManager.queryById(uid)
        if (auditDO === undefined || auditDO === null) {
            throw new Error("auditDO is undefined")
        }
        const userAges = new Map<string, CommentDO[]>();
        const comments = await this.commentManager.queryByAuditId(auditDO.uid)
        userAges.set(auditDO.uid, comments);
        return convertAuditMetadataTo(auditDO, userAges)
    }

    async queryByCondition(queryCondition: QueryCondition): Promise<PageResult> {
        const result = await this.auditManager.queryByCondition(
            queryCondition.approver, queryCondition.applicant, queryCondition.name, queryCondition.startTime, queryCondition.endTime, queryCondition.page, queryCondition.pageSize
        )
        
        const uids = result.data.map((u) => u.uid)
        const userAges = new Map<string, CommentDO[]>();

        for (const id of uids) {
            const comments = await this.commentManager.queryByAuditId(id)
            userAges.set(id, comments);
        }
        return {
            data: result.data.map((s) => {
                const r = convertAuditMetadataTo(s, userAges)
                return r
            }),
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
        if (user?.address) {
            await ensureUserActive(user.address)
            const audit = await this.auditManager.queryById(comment.auditId)
            const isAdmin = await isAdminUser(user.address)
            if (!audit || (!isAdmin && !this.isApproverMatch(audit.approver, user.address))) {
                throw new Error('Approver permission denied')
            }
        }
        const existing = await this.commentManager.queryByAuditId(comment.auditId)
        if (existing && existing.length > 0) {
            throw new Error('Audit already decided')
        }
        comment.uid = generateUuid()
        comment.status = convertCommentStatusTo(CommentStatusEnum.COMMENT_STATUS_AGREE)
        const saved = await this.commentManager.save(comment)
        const audit = await this.auditManager.queryById(comment.auditId)
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
            await this.updateTargetPublishState(target, 'BUSINESS_STATUS_ONLINE', true)
        }
        return saved
    }

    async reject(comment: CommentDO) {
        const user = getRequestUser()
        if (user?.address) {
            await ensureUserActive(user.address)
            const audit = await this.auditManager.queryById(comment.auditId)
            const isAdmin = await isAdminUser(user.address)
            if (!audit || (!isAdmin && !this.isApproverMatch(audit.approver, user.address))) {
                throw new Error('Approver permission denied')
            }
        }
        const existing = await this.commentManager.queryByAuditId(comment.auditId)
        if (existing && existing.length > 0) {
            throw new Error('Audit already decided')
        }
        comment.uid = generateUuid()
        comment.status = convertCommentStatusTo(CommentStatusEnum.COMMENT_STATUS_REJECT)
        const saved = await this.commentManager.save(comment)
        const audit = await this.auditManager.queryById(comment.auditId)
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
