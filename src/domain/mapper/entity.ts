import {
    Column,
    Entity,
    Index,
    PrimaryColumn,
    PrimaryGeneratedColumn
} from 'typeorm'

@Entity('users')
export class UserDO {
    @PrimaryColumn({ length: 128, nullable: false, unique: true })
    did!: string

    @Column({ length: 128 })
    name!: string

    @Column('text')
    avatar!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string

    @Column({ length: 192 })
    signature!: string
}

@Entity('user_state')
export class UserStateDO {
    @PrimaryColumn({ length: 128, nullable: false, unique: true })
    did!: string

    @Column({ length: 64 })
    role!: string

    @Column({ length: 64 })
    status!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string

    @Column({ length: 192 })
    signature!: string
}

@Entity('totp_subject_secrets')
export class TotpSubjectSecretDO {
    @PrimaryColumn({ length: 128, nullable: false, unique: true })
    subject!: string

    @Column({ type: 'text', name: 'secret_ciphertext' })
    secretCiphertext!: string

    @Column({ type: 'boolean', name: 'is_bound', default: false })
    isBound!: boolean

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string

    @Column({ length: 64, name: 'bound_at', default: '' })
    boundAt!: string
}

@Entity('notifications')
@Index('idx_notification_type_created_at', ['type', 'createdAt'])
export class NotificationDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128 })
    type!: string

    @Column({ length: 64 })
    source!: string

    @Column({ length: 64, name: 'subject_type' })
    subjectType!: string

    @Column({ length: 128, name: 'subject_id' })
    subjectId!: string

    @Column({ length: 128, default: '' })
    actor!: string

    @Column({ length: 64, name: 'audience_type', default: 'user' })
    audienceType!: string

    @Column({ type: 'text', name: 'audience_ids', default: '' })
    audienceIds!: string

    @Column({ length: 32, default: 'info' })
    level!: string

    @Column({ length: 256 })
    title!: string

    @Column({ type: 'text', default: '' })
    body!: string

    @Column({ type: 'text', default: '' })
    payload!: string

    @Column({ length: 32, default: 'delivered' })
    status!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string

    @Column({ length: 64, name: 'expires_at', default: '' })
    expiresAt!: string
}

@Entity('notification_inboxes')
@Index('idx_notification_inbox_recipient_created_at', ['recipient', 'createdAt'])
@Index('idx_notification_inbox_notification_uid', ['notificationUid'])
export class NotificationInboxDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 64, name: 'notification_uid' })
    notificationUid!: string

    @Column({ length: 128 })
    recipient!: string

    @Column({ length: 32, name: 'recipient_type', default: 'user' })
    recipientType!: string

    @Column({ type: 'boolean', name: 'is_read', default: false })
    isRead!: boolean

    @Column({ length: 64, name: 'read_at', default: '' })
    readAt!: string

    @Column({ length: 64, name: 'delivered_at', default: '' })
    deliveredAt!: string

    @Column({ length: 64, name: 'archived_at', default: '' })
    archivedAt!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string
}

@Entity('action_requests')
@Index('idx_action_request_dedup', ['actor', 'requestId'], { unique: true })
export class ActionRequestDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128 })
    actor!: string

    @Column({ length: 64 })
    action!: string

    @Column({ length: 128, name: 'request_id' })
    requestId!: string

    @Column({ length: 64, name: 'payload_hash' })
    payloadHash!: string

    @Column({ length: 64, name: 'signed_at' })
    signedAt!: string

    @Column({ length: 192 })
    signature!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 32, default: 'pending' })
    status!: string

    @Column({ type: 'int', name: 'response_code', default: 0 })
    responseCode!: number

    @Column({ type: 'text', name: 'response_body', default: '' })
    responseBody!: string

    @Column({ length: 64, name: 'completed_at', default: '' })
    completedAt!: string
}

@Entity('applications')
export class ApplicationDO {
    @PrimaryGeneratedColumn("uuid")
    uid!: string

    @Column({ length: 128, nullable: false })
    did!: string

    @Column()
    version!: number

    @Column({ length: 128 })
    owner!: string

    @Column({ length: 128 , name: 'owner_name'})
    ownerName!: string

    @Column({ length: 64 })
    network!: string

    @Column({ length: 128 })
    address!: string

    @Column({ length: 64 })
    name!: string

    @Column('text')
    description!: string

    @Column({ length: 64 })
    code!: string

    @Column('text')
    location!: string

    @Column({ type: 'text', name: 'service_codes' })
    serviceCodes!: string

    @Column({ type: 'text', name: 'redirect_uris', default: '' })
    redirectUris!: string

    @Column({ type: 'text', name: 'ucan_audience', default: '' })
    ucanAudience!: string

    @Column({ type: 'text', name: 'ucan_capabilities', default: '' })
    ucanCapabilities!: string

    @Column('text')
    avatar!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string

    @Column({ length: 192 })
    signature!: string

    @Column({ type: 'text', name: 'code_package_path', default: ''})
    codePackagePath!: string

    @Column({ length: 64, default: 'BUSINESS_STATUS_PENDING' })
    status!: string

    // 用于存储上架标记, 用于后端过滤，前端不感知
    @Column({ type: "boolean", name: "is_online", default: false })
    isOnline!: boolean
}

@Entity('application_configs')
@Index('idx_application_config_owner', ['applicationUid', 'applicant'], { unique: true })
export class ApplicationConfigDO {
    @PrimaryGeneratedColumn("uuid")
    uid!: string

    @Column({ length: 64, name: 'application_uid' })
    applicationUid!: string

    @Column({ length: 128, name: 'application_did' })
    applicationDid!: string

    @Column({ name: 'application_version' })
    applicationVersion!: number

    @Column({ length: 128 })
    applicant!: string

    @Column({ type: 'text', name: 'config_json', default: '' })
    configJson!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string
}

/**
 * 审批注释，确认通过/确认拒绝
 */
@Entity('comments')
export class CommentDO {
    @PrimaryGeneratedColumn("uuid")
    uid!: string
    @Column({ type: 'text', name: 'audit_id' })
    auditId!: string
    @Column('text')
    text!: string
    @Column('text')
    status!: string
    @Column({ length: 64, name: 'created_at' })
    createdAt!: string
    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string
    @Column({ length: 192 })
    signature!: string
}

/**
 * 申请工单
 */
@Entity('audits')
@Index('idx_audit_target', ['targetType', 'targetDid', 'targetVersion'])
export class AuditDO {
    /**
     * 主键uid
     */
    @PrimaryGeneratedColumn("uuid")
    uid!: string

  /**
   * 应用元数据 / 服务元数据序例化 json 字符串
   *
   */
    @Column({type: 'text', name:'app_or_service_metadata', default:null})
    appOrServiceMetadata!: string

    /**
     * 审批类型，当前为 application（预留 contract）
     */
    @Column({type: 'text', name:'audit_type', default:null})
    auditType!: string

  /**
   * 申请人身份，存字符串，使用 :: 拼接
   * 拼接格式 did::name
   */
    @Column({type:'text',default:""})
    applicant!: string

  /**
   * 审批人身份：可能有多个人审批人，使用 list json
   * 拼接格式 did::name
   *
   */
    @Column({type:'text',default:""})
    approver!: string

    /**
     * 申请原因
     */
    @Column({type:'text',default:""})
    reason!: string

    /**
     * 创建时间
     */
    @Column({ name: 'created_at'})
    createdAt!: Date

    /**
     * 修改时间
     */
    @Column({ name: 'updated_at'})
    updatedAt!: Date
    /**
     * 签名
     */
     @Column({ length: 192, default:null })
    signature!: string

    /**
     * 审核目标字段（用于索引查询）
     */
    @Column({ length: 32, name: 'target_type', default: '' })
    targetType!: string

    @Column({ length: 128, name: 'target_did', default: '' })
    targetDid!: string

    @Column({ type: 'int', name: 'target_version', default: 0 })
    targetVersion!: number

    @Column({ length: 128, name: 'target_name', default: '' })
    targetName!: string

    @Column({ length: 64, name: 'previous_target_status', default: 'BUSINESS_STATUS_PENDING' })
    previousTargetStatus!: string

    @Column({ type: 'boolean', name: 'previous_target_is_online', default: false })
    previousTargetIsOnline!: boolean

}

@Entity('mpc_sessions')
export class MpcSessionDO {
    @PrimaryColumn({ length: 64, nullable: false, unique: true })
    id!: string

    @Column({ length: 16 })
    type!: string

    @Column({ length: 128, name: 'wallet_id' })
    walletId!: string

    @Column({ type: 'int' })
    threshold!: number

    @Column('text')
    participants!: string

    @Column({ length: 32 })
    status!: string

    @Column({ type: 'int' })
    round!: number

    @Column({ length: 32 })
    curve!: string

    @Column({ type: 'int', name: 'key_version' })
    keyVersion!: number

    @Column({ type: 'int', name: 'share_version' })
    shareVersion!: number

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'expires_at' })
    expiresAt!: string
}

@Entity('mpc_session_participants')
export class MpcSessionParticipantDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 64, name: 'session_id' })
    sessionId!: string

    @Column({ length: 64, name: 'participant_id' })
    participantId!: string

    @Column({ length: 128, name: 'device_id' })
    deviceId!: string

    @Column({ length: 256 })
    identity!: string

    @Column({ type: 'text', name: 'e2e_public_key' })
    e2ePublicKey!: string

    @Column({ type: 'text', name: 'signing_public_key', default: '' })
    signingPublicKey!: string

    @Column({ length: 32, default: 'active' })
    status!: string

    @Column({ length: 64, name: 'joined_at' })
    joinedAt!: string
}

@Entity('mpc_messages')
export class MpcMessageDO {
    @PrimaryColumn({ length: 64, nullable: false, unique: true })
    id!: string

    @Column({ length: 64, name: 'session_id' })
    sessionId!: string

    @Column({ length: 64, name: 'sender' })
    sender!: string

    @Column({ length: 64, name: 'receiver', default: '' })
    receiver!: string

    @Column({ type: 'int', default: 0 })
    round!: number

    @Column({ length: 64 })
    type!: string

    @Column({ type: 'int', default: 0 })
    seq!: number

    @Column('text')
    envelope!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string
}

@Entity('mpc_sign_requests')
export class MpcSignRequestDO {
    @PrimaryColumn({ length: 64, nullable: false, unique: true })
    id!: string

    @Column({ length: 128, name: 'wallet_id' })
    walletId!: string

    @Column({ length: 64, name: 'session_id' })
    sessionId!: string

    @Column({ length: 64 })
    initiator!: string

    @Column({ length: 32, name: 'payload_type' })
    payloadType!: string

    @Column({ length: 256, name: 'payload_hash' })
    payloadHash!: string

    @Column({ type: 'int', name: 'chain_id', default: 0 })
    chainId!: number

    @Column({ length: 32 })
    status!: string

    @Column('text')
    approvals!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string
}

@Entity('mpc_audit_logs')
export class MpcAuditLogDO {
    @PrimaryColumn({ length: 64, nullable: false, unique: true })
    id!: string

    @Column({ length: 128, name: 'wallet_id' })
    walletId!: string

    @Column({ length: 64, name: 'session_id' })
    sessionId!: string

    @Column({ length: 16 })
    level!: string

    @Column({ length: 64 })
    action!: string

    @Column({ length: 64 })
    actor!: string

    @Column('text')
    message!: string

    @Column({ length: 64 })
    time!: string

    @Column('text')
    metadata!: string
}
