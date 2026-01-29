import { CommentDO } from '../mapper/entity'

export type CommentStatus = 'COMMENT_STATUS_AGREE' | 'COMMENT_STATUS_REJECT'

export interface CommentMetadata {
    uid: string
    auditId: string
    text: string
    status: CommentStatus
    createdAt: string
    updatedAt: string
    signature: string
}

export const COMMENT_STATUS_AGREE: CommentStatus = 'COMMENT_STATUS_AGREE'
export const COMMENT_STATUS_REJECT: CommentStatus = 'COMMENT_STATUS_REJECT'

export function convertCommentMetadata(comment: CommentDO): CommentMetadata {
    return {
        uid: comment.uid,
        auditId: comment.auditId,
        text: comment.text,
        status: (comment.status as CommentStatus) || COMMENT_STATUS_AGREE,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        signature: comment.signature
    }
}
