import { ResponsePage } from '../../common/page'
import { AuditDO, CommentDO } from '../mapper/entity'
import { CommentMetadata, convertCommentMetadata } from './comments'

export interface PageResult {
    data: AuditDetail[]
    page: ResponsePage
}

export interface Audit {
    uid: string
    appOrServiceMetadata: string
    applicant: string
    approver: string
    reason: string
    createdAt: string
    updatedAt: string
    signature: string
    auditType: string
}

export interface AuditDetail {
    meta: Audit
    commentMeta: CommentMetadata[]
}

export function convertAuditDOFrom(meta: Audit): AuditDO {
    return {
        uid: meta.uid,
        appOrServiceMetadata: meta.appOrServiceMetadata,
        auditType: meta.auditType,
        applicant: meta.applicant,
        approver: meta.approver,
        reason: meta.reason,
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt),
        signature: meta.signature,
        targetType: '',
        targetDid: '',
        targetVersion: 0,
        targetName: ''
    }
}

export function convertAuditMetadataTo(auditDO: AuditDO, comments?: CommentDO[] | null): AuditDetail {
    const meta: Audit = {
        uid: auditDO.uid,
        appOrServiceMetadata: auditDO.appOrServiceMetadata,
        auditType: auditDO.auditType,
        applicant: auditDO.applicant,
        approver: auditDO.approver,
        reason: auditDO.reason,
        createdAt: auditDO.createdAt.toISOString(),
        updatedAt: auditDO.updatedAt.toISOString(),
        signature: auditDO.signature
    }
    return {
        meta,
        commentMeta: (comments || []).map(convertCommentMetadata)
    }
}

export interface QueryCondition {
    approver?: string
    applicant?: string
    name?: string
    startTime?: string
    endTime?: string
    page: number
    pageSize: number
}
