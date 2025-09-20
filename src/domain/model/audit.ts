import { ResponsePage } from "../../yeying/api/common/message"
import { AuditDO, CommentDO } from "../mapper/entity"


export interface PageResult {
    data: Audit[]
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
    commonsMetadatas?: CommentDO[]
}

export function convertAuditDOFrom(meta: Audit): AuditDO {
    return {
        uid: meta.uid,
        appOrServiceMetadata: meta.appOrServiceMetadata,
        applicant: meta.applicant,
        approver: meta.approver,
        reason: meta.reason,
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt),
        signature: meta.signature
    }
}

export function convertAuditMetadataTo(auditDO: AuditDO, userAges?: Map<string, CommentDO[]>) {
    if (userAges === undefined || userAges === null) {
        return {
            uid: auditDO.uid,
            appOrServiceMetadata: auditDO.appOrServiceMetadata,
            applicant: auditDO.applicant,
            approver: auditDO.approver,
            reason: auditDO.reason,
            createdAt: auditDO.createdAt.toISOString(),
            updatedAt: auditDO.updatedAt.toISOString(),
            signature: auditDO.signature
        }
    } else {
        return {
            uid: auditDO.uid,
            appOrServiceMetadata: auditDO.appOrServiceMetadata,
            applicant: auditDO.applicant,
            approver: auditDO.approver,
            reason: auditDO.reason,
            createdAt: auditDO.createdAt.toISOString(),
            updatedAt: auditDO.updatedAt.toISOString(),
            signature: auditDO.signature,
            commonsMetadatas: userAges.get(auditDO.uid)
        }
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