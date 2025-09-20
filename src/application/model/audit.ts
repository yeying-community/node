import { Authenticate } from "../../common/authenticate";
import { AuditDO, CommentDO } from "../../domain/mapper/entity";
import { Audit, PageResult } from "../../domain/model/audit";
import { convertCommentStatusFrom } from "../../domain/model/comments";
import { AuditApproveResponse, AuditApproveResponseBody, AuditCancelResponse, AuditCancelResponseBody, AuditCreateResponse, AuditCreateResponseBody, AuditDetail, AuditDetailResponse, AuditDetailResponseBody, AuditMetadata, AuditRejectResponse, AuditRejectResponseBody, AuditSearchResponse, AuditSearchResponseBody, CommentMetadata} from "../../yeying/api/audit/audit";
import { ResponseStatus } from "../../yeying/api/common/message";


export function generateUuid() {
    // 创建一个 16 字节的随机数组缓冲区
    const buffer = new Uint8Array(16)
    crypto.getRandomValues(buffer)

    // 将缓冲区转换为 UUID 的格式
    buffer[6] &= 0x0f
    buffer[6] |= 0x40
    buffer[8] &= 0x3f
    buffer[8] |= 0x80

    const hex = Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}


export function convertAuditMetadataTo(audit: Audit): AuditMetadata {
    return AuditMetadata.create({
        uid: audit.uid,
        appOrServiceMetadata: audit.appOrServiceMetadata,
        applicant: audit.applicant,
        approver: audit.approver,
        reason: audit.reason,
        createdAt: audit.createdAt,
        updatedAt: audit.updatedAt,
        signature: audit.signature
    })
}

export function convertAuditMetadataFrom(audit: AuditMetadata): AuditDO {
    return {
        uid: audit.uid,
        appOrServiceMetadata: audit.appOrServiceMetadata,
        applicant: audit.applicant,
        approver: audit.approver,
        reason: audit.reason,
        createdAt: new Date(audit.createdAt),
        updatedAt: new Date(audit.updatedAt),
        signature: audit.signature
    }
}

export function convertCommentMeta(c: CommentDO) {
    return {
        uid: c.uid,
        auditId: c.auditId,
        text: c.text,
        status: convertCommentStatusFrom(c.status),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        signature: c.signature
    } as CommentMetadata
}


export async function createAuditSearchResponse(authenticate: Authenticate, status: ResponseStatus, result?: PageResult) {
    const body = AuditSearchResponseBody.create({
        status: status,
        detail: result?.data.map(item => {
            return AuditDetail.create({
                meta: convertAuditMetadataTo(item),
                commentMeta: item.commonsMetadatas?.map((s) => convertCommentMeta(s))
            })
        }),
        page: result?.page
    })

    return AuditSearchResponse.create({
        header: await authenticate.createHeader(AuditSearchResponseBody.encode(body).finish()),
        body: body
    })
}

export async function rejectResponse(authenticate: Authenticate, status: ResponseStatus, meta?: CommentMetadata): Promise<AuditRejectResponse> {
    const body = AuditRejectResponseBody.create({
        status: status,
        metadata: meta
    })

    return AuditRejectResponse.create({
        header: await authenticate.createHeader(AuditRejectResponseBody.encode(body).finish()),
        body: body
    })
}
export async function approveResponse(authenticate: Authenticate, status: ResponseStatus, meta?: CommentMetadata) {
    const body = AuditApproveResponseBody.create({
        status: status,
        metadata: meta
    })

    return AuditApproveResponse.create({
        header: await authenticate.createHeader(AuditApproveResponseBody.encode(body).finish()),
        body: body
    })
}

export async function cancelResponse(authenticate: Authenticate, status: ResponseStatus, meta?: AuditMetadata) {
    const body = AuditCancelResponseBody.create({
        status: status,
        meta: meta
    })

    return AuditCancelResponse.create({
        header: await authenticate.createHeader(AuditCancelResponseBody.encode(body).finish()),
        body: body
    })
}

export async function createAuditResponse(authenticate: Authenticate, status: ResponseStatus, meta?: AuditMetadata) {
    const body = AuditCreateResponseBody.create({
        status: status,
        meta: meta,
    })

    return AuditCreateResponse.create({
        header: await authenticate.createHeader(AuditCreateResponseBody.encode(body).finish()),
        body: body
    })
}


export async function auditDetailResponse(authenticate: Authenticate, status: ResponseStatus, detail?: AuditDetail) {
    const body = AuditDetailResponseBody.create({
        status: status,
        detail: detail,
    })

    return AuditDetailResponse.create({
        header: await authenticate.createHeader(AuditDetailResponseBody.encode(body).finish()),
        body: body
    })
}