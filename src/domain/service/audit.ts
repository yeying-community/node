import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'
import { AuditManager } from '../manager/audit'
import { AuditDetail, AuditMetadata, CommentStatusEnum } from '../../yeying/api/audit/audit';
import { generateUuid, convertAuditMetadataFrom } from '../../application/model/audit'
import { convertAuditMetadataTo, PageResult, QueryCondition } from '../model/audit';
import { CommentManager } from '../manager/comments';
import { convertCommentMetadata, convertCommentStatusTo } from '../model/comments';
import { CommentDO } from '../mapper/entity';

export class AuditService {
    private logger: Logger = SingletonLogger.get()
    private auditManager: AuditManager
    private commentManager: CommentManager

    constructor() {
        this.auditManager = new AuditManager()
        this.commentManager = new CommentManager()
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
        const auditDO = convertAuditMetadataFrom(meta)
        auditDO.uid = generateUuid()
        const res = await this.auditManager.save(auditDO)
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
        return await this.auditManager.delete(uid)
    }

    async approve(comment: CommentDO) {
        comment.uid = generateUuid()
        comment.status = convertCommentStatusTo(CommentStatusEnum.COMMENT_STATUS_AGREE)
        return await this.commentManager.save(comment)
    }

    async reject(comment: CommentDO) {
        comment.uid = generateUuid()
        comment.status = convertCommentStatusTo(CommentStatusEnum.COMMENT_STATUS_REJECT)
        return await this.commentManager.save(comment)
    }
    
}
