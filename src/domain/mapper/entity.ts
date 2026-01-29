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

@Entity('services')
export class ServiceDO {
    @PrimaryGeneratedColumn("uuid")
    uid!: string

    @Column({ length: 128, nullable: false })
    did!: string

    @Column()
    version!: number

    @Column({ length: 128 })
    owner!: string

    @Column({ length: 128 ,name: 'owner_name'})
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

    @Column({type: 'text', name: "api_codes", default: ""})
    apiCodes!: string

    @Column({ length: 256 })
    proxy!: string

    @Column({ length: 256 })
    grpc!: string

    @Column('text')
    avatar!: string

    @Column({ length: 64, name: 'created_at', default: new Date().toISOString() })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: new Date().toISOString() })
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

@Entity('service_configs')
@Index('idx_service_config_owner', ['serviceUid', 'applicant'], { unique: true })
export class ServiceConfigDO {
    @PrimaryGeneratedColumn("uuid")
    uid!: string

    @Column({ length: 64, name: 'service_uid' })
    serviceUid!: string

    @Column({ length: 128, name: 'service_did' })
    serviceDid!: string

    @Column({ name: 'service_version' })
    serviceVersion!: number

    @Column({ length: 128 })
    applicant!: string

    @Column({ type: 'text', name: 'config_json', default: '' })
    configJson!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string
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
    @Column('text')
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
     * 审批类型，application/service
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

}
