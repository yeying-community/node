import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn
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
    @PrimaryColumn({ length: 128, nullable: false })
    did!: string

    @PrimaryColumn()
    version!: number

    @Column({ length: 128 })
    owner!: string

    @Column({ length: 128 , default: null, name: 'owner_name'})
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

    // 用于存储上架标记, 用于后端过滤，前端不感知
    @Column({ type: "boolean", name: "is_online", default: false })
    isOnline!: boolean
}

@Entity('applications')
export class ApplicationDO {
    @PrimaryColumn({ length: 128, nullable: false })
    did!: string

    @PrimaryColumn()
    version!: number

    @Column({ length: 128 })
    owner!: string

    @Column({ length: 128 , default: null, name: 'owner_name'})
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

    @Column({ length: 128 })
    hash!: string

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

    // 用于存储上架标记, 用于后端过滤，前端不感知
    @Column({ type: "boolean", name: "is_online", default: false })
    isOnline!: boolean
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

@Entity('events')
export class EventDO {
    @PrimaryColumn({ length: 128, nullable: false, unique: true })
    uid!: string

    @Column({ length: 64 })
    type!: string

    @Column('text')
    producers!: string

    @Column('text')
    consumers!: string

    @Column('text')
    signatures!: string

    @Column('text')
    content!: string

    @Column('text')
    opinions!: string

    @Column('text')
    extend!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'processed_at' })
    processedAt!: string
}

@Entity('invitations')
export class InvitationDO {
    @PrimaryColumn({ length: 64, nullable: false, unique: true })
    code!: string

    @Column({ length: 64 })
    scene!: string

    @Column({ length: 128 })
    inviter!: string

    @Column({ length: 128, nullable: true })
    invitee!: string

    @Column({ length: 64, name: 'expired_at' })
    expiredAt!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 192 })
    signature!: string
}

@Entity('certificates')
export class CertificateDO {
    @PrimaryColumn({ length: 256, nullable: false, unique: true })
    domain!: string

    @Column({ length: 128, name: 'service_did' })
    serviceDid!: string

    @Column('text')
    cert!: string

    @Column('text')
    csr!: string

    @Column({ length: 64 })
    expired!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at' })
    updatedAt!: string
}

@Entity('supports')
export class SupportDO {
    @PrimaryGeneratedColumn()
    id!: number

    @Column({ length: 128 })
    did!: string

    @Column({ length: 256 })
    email!: string

    @Column({ length: 64 })
    type!: string

    @Column('text')
    description!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @Column({ length: 192 })
    signature!: string

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date
}

@Entity('solutions')
export class SolutionDO {
    @PrimaryColumn({ length: 64, nullable: false, unique: true })
    uid!: string

    @Column({ length: 128 })
    publisher!: string

    @Column({ length: 128 })
    name!: string

    @Column({ length: 64 })
    language!: string

    @Column('text')
    description!: string

    @Column({ length: 192 })
    signature!: string

    @Column({ length: 64, name: 'created_at' })
    createdAt!: string

    @OneToMany(() => CardDO, (card) => card.solution, {
        cascade: true
    })
    cards!: CardDO[]
}

@Entity('cards')
export class CardDO {
    @PrimaryGeneratedColumn()
    id!: number

    @Column({ length: 128 })
    name!: string

    @Column({ length: 64 })
    price!: string

    @Column('text')
    variables!: string

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date

    @ManyToOne(() => SolutionDO, (solution) => solution.cards, {
        onDelete: 'CASCADE'
    })
    @JoinColumn({ name: 'solution_id', referencedColumnName: 'uid' })
    solution!: SolutionDO
}

/**
 * 申请工单
 */
@Entity('audits')
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

}
