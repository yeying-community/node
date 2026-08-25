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

@Entity('custody_key_records')
@Index('idx_custody_key_records_subject', ['subjectType', 'subjectId'])
@Index('uidx_custody_key_records_subject_wallet', ['subjectType', 'subjectId', 'walletId'], { unique: true })
export class CustodyKeyRecordDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 64, name: 'subject_type', default: 'wallet_address' })
    subjectType!: string

    @Column({ length: 128, name: 'subject_id' })
    subjectId!: string

    @Column({ length: 128, name: 'wallet_id' })
    walletId!: string

    @Column({ length: 128, name: 'account_id', default: '' })
    accountId!: string

    @Column({ length: 128, name: 'address', default: '' })
    address!: string

    @Column({ type: 'text', name: 'ciphertext' })
    ciphertext!: string

    @Column({ type: 'text', name: 'metadata_json', default: '{}' })
    metadataJson!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string

    @Column({ length: 64, name: 'last_verified_at', default: '' })
    lastVerifiedAt!: string
}

@Entity('identity_account_links')
@Index('uidx_identity_account_link', ['identityDid', 'chainKey', 'accountId'], { unique: true })
export class IdentityAccountLinkDO {
    @PrimaryGeneratedColumn('uuid') uid!: string
    @Column({ length: 128, name: 'identity_did' }) identityDid!: string
    @Column({ length: 64, name: 'chain_key' }) chainKey!: string
    @Column({ length: 128, name: 'account_id' }) accountId!: string
    @Column({ length: 64, default: 'active' }) status!: string
    @Column({ length: 64, name: 'verified_at' }) verifiedAt!: string
    @Column({ length: 64, name: 'revoked_at', default: '' }) revokedAt!: string
}

@Entity('identity_account_link_challenges')
@Index('idx_identity_link_challenge_expires', ['status', 'expiresAt'])
export class IdentityAccountLinkChallengeDO {
    @PrimaryColumn({ length: 128 }) nonce!: string
    @Column({ length: 128, name: 'identity_did' }) identityDid!: string
    @Column({ length: 64, name: 'chain_key' }) chainKey!: string
    @Column({ length: 128, name: 'account_id' }) accountId!: string
    @Column({ length: 64, name: 'issued_at' }) issuedAt!: string
    @Column({ length: 64, name: 'expires_at' }) expiresAt!: string
    @Column({ length: 32, default: 'pending' }) status!: string
    @Column({ length: 64, name: 'consumed_at', default: '' }) consumedAt!: string
}

@Entity('identity_verification_transactions')
@Index('idx_identity_verification_expires', ['status', 'expiresAt'])
export class IdentityVerificationTransactionDO {
    @PrimaryColumn({ length: 128, name: 'verification_id' }) verificationId!: string
    @Column({ length: 128, name: 'identity_did' }) identityDid!: string
    @Column({ type: 'text', name: 'types_json' }) typesJson!: string
    @Column({ length: 320, default: '' }) email!: string
    @Column({ length: 128, name: 'username', default: '' }) username!: string
    @Column({ length: 128, name: 'email_code_hash', default: '' }) emailCodeHash!: string
    @Column({ type: 'integer', default: 0 }) attempts!: number
    @Column({ length: 32, default: 'pending' }) status!: string
    @Column({ length: 64, name: 'expires_at' }) expiresAt!: string
    @Column({ length: 64, name: 'created_at' }) createdAt!: string
    @Column({ length: 64, name: 'completed_at', default: '' }) completedAt!: string
}

@Entity('identity_usernames')
@Index('uidx_identity_username_namespace_value', ['namespace', 'normalizedUsername'], { unique: true })
export class IdentityUsernameDO {
    @PrimaryGeneratedColumn('uuid') uid!: string
    @Column({ length: 128 }) namespace!: string
    @Column({ length: 32, name: 'normalized_username' }) normalizedUsername!: string
    @Column({ length: 128, name: 'identity_did' }) identityDid!: string
    @Column({ length: 32, default: 'reserved' }) status!: string
    @Column({ length: 64, name: 'reserved_until', default: '' }) reservedUntil!: string
    @Column({ length: 64, name: 'created_at' }) createdAt!: string
    @Column({ length: 64, name: 'updated_at' }) updatedAt!: string
}

@Entity('identity_credentials')
@Index('idx_identity_credential_subject', ['identityDid', 'credentialType'])
export class IdentityCredentialDO {
    @PrimaryColumn({ length: 320, name: 'credential_id' }) credentialId!: string
    @Column({ length: 128, name: 'identity_did' }) identityDid!: string
    @Column({ length: 64, name: 'credential_type' }) credentialType!: string
    @Column({ type: 'text' }) token!: string
    @Column({ length: 32, default: 'active' }) status!: string
    @Column({ length: 64, name: 'issued_at' }) issuedAt!: string
    @Column({ length: 64, name: 'expires_at' }) expiresAt!: string
    @Column({ length: 64, name: 'revoked_at', default: '' }) revokedAt!: string
}

@Entity('identity_credential_reissue_challenges')
@Index('idx_identity_credential_reissue_expires', ['status', 'expiresAt'])
export class IdentityCredentialReissueChallengeDO {
    @PrimaryColumn({ length: 64, name: 'challenge_id' }) challengeId!: string
    @Column({ length: 128, name: 'identity_did' }) identityDid!: string
    @Column({ type: 'text', name: 'types_json' }) typesJson!: string
    @Column({ length: 128 }) nonce!: string
    @Column({ length: 32, default: 'pending' }) status!: string
    @Column({ length: 64, name: 'issued_at' }) issuedAt!: string
    @Column({ length: 64, name: 'expires_at' }) expiresAt!: string
    @Column({ length: 64, name: 'consumed_at', default: '' }) consumedAt!: string
}

@Entity('identity_audit_logs')
@Index('idx_identity_audit_identity_created', ['identityDid', 'createdAt'])
export class IdentityAuditLogDO {
    @PrimaryGeneratedColumn('uuid') uid!: string
    @Column({ length: 128, name: 'identity_did', default: '' }) identityDid!: string
    @Column({ length: 64 }) action!: string
    @Column({ length: 32, default: 'success' }) outcome!: string
    @Column({ type: 'text', name: 'metadata_json', default: '{}' }) metadataJson!: string
    @Column({ length: 64, name: 'created_at' }) createdAt!: string
}

@Entity('identity_passkey_credentials')
@Index('idx_identity_passkey_credentials_identity', ['identityDid'])
export class IdentityPasskeyCredentialDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128, name: 'identity_did' })
    identityDid!: string

    @Column({ type: 'text', name: 'credential_id', unique: true })
    credentialId!: string

    @Column({ type: 'text', name: 'public_key' })
    publicKey!: string

    @Column({ type: 'bigint', name: 'sign_count', default: 0 })
    signCount!: string

    @Column({ length: 128, name: 'aaguid', default: '' })
    aaguid!: string

    @Column({ type: 'text', name: 'transports', default: '' })
    transports!: string

    @Column({ length: 255, name: 'device_name', default: '' })
    deviceName!: string

    @Column({ length: 255, name: 'rp_id', default: '' })
    rpId!: string

    @Column({ type: 'text', name: 'user_handle', default: '' })
    userHandle!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'last_used_at', default: '' })
    lastUsedAt!: string

    @Column({ length: 64, name: 'revoked_at', default: '' })
    revokedAt!: string
}

@Entity('identity_totp_authenticators')
export class IdentityTotpAuthenticatorDO {
    @PrimaryColumn({ length: 128, name: 'identity_did' })
    identityDid!: string

    @Column({ type: 'text', name: 'secret_ciphertext' })
    secretCiphertext!: string

    @Column({ length: 32, default: 'pending' })
    status!: string

    @Column({ length: 255, name: 'device_name', default: '' })
    deviceName!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string

    @Column({ length: 64, name: 'confirmed_at', default: '' })
    confirmedAt!: string

    @Column({ length: 64, name: 'last_used_at', default: '' })
    lastUsedAt!: string

    @Column({ length: 64, name: 'revoked_at', default: '' })
    revokedAt!: string
}

@Entity('identity_webauthn_challenges')
@Index('idx_identity_webauthn_challenge_expires_at', ['expiresAt'])
export class IdentityWebauthnChallengeDO {
    @PrimaryColumn({ length: 128, name: 'challenge_id' })
    challengeId!: string

    @Column({ length: 32, name: 'challenge_type' })
    challengeType!: string

    @Column({ length: 128, name: 'identity_did', default: '' })
    identityDid!: string

    @Column({ length: 128, name: 'request_id', default: '' })
    requestId!: string

    @Column({ type: 'text' })
    challenge!: string

    @Column({ type: 'text', name: 'allowed_credential_ids', default: '[]' })
    allowedCredentialIds!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'expires_at', default: '' })
    expiresAt!: string

    @Column({ type: 'boolean', default: false })
    used!: boolean
}

@Entity('identity_authorization_requests')
@Index('idx_identity_authorization_request_status_expires', ['status', 'expiresAt'])
export class IdentityAuthorizationRequestDO {
    @PrimaryColumn({ length: 128, name: 'request_id' }) requestId!: string
    @Column({ length: 128, name: 'app_id' }) appId!: string
    @Column({ type: 'text', name: 'redirect_uri' }) redirectUri!: string
    @Column({ length: 256, default: '' }) state!: string
    @Column({ length: 256, name: 'code_challenge' }) codeChallenge!: string
    @Column({ length: 16, name: 'code_challenge_method', default: 'S256' }) codeChallengeMethod!: string
    @Column({ type: 'text', name: 'scopes_json' }) scopesJson!: string
    @Column({ length: 128 }) nonce!: string
    @Column({ length: 128, name: 'identity_did', default: '' }) identityDid!: string
    @Column({ length: 32, default: 'pending' }) status!: string
    @Column({ length: 64, name: 'created_at' }) createdAt!: string
    @Column({ length: 64, name: 'updated_at' }) updatedAt!: string
    @Column({ length: 64, name: 'expires_at' }) expiresAt!: string
    @Column({ length: 64, name: 'approved_at', default: '' }) approvedAt!: string
}

@Entity('identity_authorization_codes')
@Index('idx_identity_authorization_code_request', ['requestId'])
export class IdentityAuthorizationCodeDO {
    @PrimaryColumn({ length: 128, name: 'code' }) code!: string
    @Column({ length: 128, name: 'request_id' }) requestId!: string
    @Column({ length: 128, name: 'app_id' }) appId!: string
    @Column({ type: 'text', name: 'redirect_uri' }) redirectUri!: string
    @Column({ length: 256, default: '' }) state!: string
    @Column({ length: 256, name: 'code_challenge' }) codeChallenge!: string
    @Column({ type: 'text', name: 'scopes_json' }) scopesJson!: string
    @Column({ length: 128, name: 'identity_did' }) identityDid!: string
    @Column({ length: 64, name: 'issued_at' }) issuedAt!: string
    @Column({ length: 64, name: 'expires_at' }) expiresAt!: string
    @Column({ type: 'boolean', default: false }) used!: boolean
    @Column({ length: 64, name: 'used_at', default: '' }) usedAt!: string
}

@Entity('scoped_grants')
@Index('idx_scoped_grants_subject_status', ['subjectId', 'status'])
@Index('idx_scoped_grants_app_status', ['appId', 'status'])
export class ScopedGrantDO {
    @PrimaryColumn({ length: 128, name: 'grant_id' })
    grantId!: string

    @Column({ length: 128, name: 'subject_id' })
    subjectId!: string

    @Column({ length: 128, name: 'app_id' })
    appId!: string

    @Column({ length: 512 })
    audience!: string

    @Column({ type: 'text', name: 'capabilities_json', default: '[]' })
    capabilitiesJson!: string

    @Column({ length: 64, default: 'active' })
    status!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string

    @Column({ length: 64, name: 'expires_at', default: '' })
    expiresAt!: string

    @Column({ length: 64, name: 'revoked_at', default: '' })
    revokedAt!: string
}

@Entity('scoped_grant_tokens')
@Index('idx_scoped_grant_tokens_grant', ['grantId'])
@Index('idx_scoped_grant_tokens_status_expires', ['status', 'expiresAt'])
export class ScopedGrantTokenDO {
    @PrimaryColumn({ length: 128, name: 'token_id' })
    tokenId!: string

    @Column({ length: 128, name: 'grant_id' })
    grantId!: string

    @Column({ length: 128, name: 'token_hash' })
    tokenHash!: string

    @Column({ length: 512 })
    audience!: string

    @Column({ type: 'text', name: 'capabilities_json', default: '[]' })
    capabilitiesJson!: string

    @Column({ length: 64, default: 'active' })
    status!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'expires_at', default: '' })
    expiresAt!: string

    @Column({ length: 64, name: 'revoked_at', default: '' })
    revokedAt!: string
}

@Entity('scoped_grant_revocations')
@Index('idx_scoped_grant_revocations_grant', ['grantId'])
export class ScopedGrantRevocationDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128, name: 'grant_id' })
    grantId!: string

    @Column({ length: 128, name: 'token_id', default: '' })
    tokenId!: string

    @Column({ length: 128, name: 'actor_subject_id', default: '' })
    actorSubjectId!: string

    @Column({ length: 64, name: 'revoked_at', default: '' })
    revokedAt!: string

    @Column({ type: 'text', name: 'reason', default: '' })
    reason!: string
}

@Entity('scoped_grant_audit_logs')
@Index('idx_scoped_grant_audit_grant_created', ['grantId', 'createdAt'])
@Index('idx_scoped_grant_audit_subject_created', ['subjectId', 'createdAt'])
export class ScopedGrantAuditLogDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128, name: 'grant_id', default: '' })
    grantId!: string

    @Column({ length: 128, name: 'token_id', default: '' })
    tokenId!: string

    @Column({ length: 128, name: 'subject_id', default: '' })
    subjectId!: string

    @Column({ length: 128, name: 'app_id', default: '' })
    appId!: string

    @Column({ length: 64 })
    action!: string

    @Column({ type: 'text', name: 'metadata_json', default: '{}' })
    metadataJson!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string
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

@Entity('notification_webhooks')
@Index('idx_notification_webhook_owner_application', ['owner', 'applicationUid'])
export class NotificationWebhookDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128, name: 'owner' })
    owner!: string

    @Column({ length: 64, name: 'application_uid', default: '' })
    applicationUid!: string

    @Column({ type: 'text', name: 'events_json', default: '[]' })
    eventsJson!: string

    @Column({ type: 'text', name: 'target_url' })
    targetUrl!: string

    @Column({ length: 128, name: 'secret_masked', default: '' })
    secretMasked!: string

    @Column({ type: 'text', name: 'secret_ciphertext', default: '' })
    secretCiphertext!: string

    @Column({ type: 'boolean', default: true })
    enabled!: boolean

    @Column({ length: 64, name: 'last_triggered_at', default: '' })
    lastTriggeredAt!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string
}

@Entity('notification_deliveries')
@Index('idx_notification_delivery_notification_uid', ['notificationUid'])
@Index('idx_notification_delivery_channel_status', ['channel', 'status'])
export class NotificationDeliveryDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 64, name: 'webhook_uid', default: '' })
    webhookUid!: string

    @Column({ length: 64, name: 'notification_uid' })
    notificationUid!: string

    @Column({ length: 64, default: 'inbox' })
    channel!: string

    @Column({ type: 'text', default: '' })
    target!: string

    @Column({ length: 32, default: 'pending' })
    status!: string

    @Column({ length: 128, name: 'lock_token', default: '' })
    lockToken!: string

    @Column({ length: 64, name: 'locked_at', default: '' })
    lockedAt!: string

    @Column({ type: 'int', name: 'attempt_count', default: 0 })
    attemptCount!: number

    @Column({ type: 'text', name: 'last_error', default: '' })
    lastError!: string

    @Column({ length: 64, name: 'delivered_at', default: '' })
    deliveredAt!: string

    @Column({ length: 64, name: 'next_retry_at', default: '' })
    nextRetryAt!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
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

/** A YeYing Project deployment registered with the AppStore adapter. */
@Entity('project_instances')
export class ProjectInstanceDO {
    @PrimaryColumn({ length: 128, name: 'instance_id' })
    instanceId!: string

    @Column({ type: 'text', name: 'project_api_url' })
    projectApiUrl!: string

    @Column({ length: 64, default: 'active' })
    status!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string
}

/** Runtime installation state for one application in one YeYing Project instance. */
@Entity('project_app_installations')
@Index('idx_project_app_installation', ['instanceId', 'appId'], { unique: true })
export class ProjectAppInstallationDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128, name: 'instance_id' })
    instanceId!: string

    @Column({ length: 128, name: 'app_id' })
    appId!: string

    @Column({ length: 64, name: 'install_version' })
    installVersion!: string

    @Column({ length: 32, default: 'pending' })
    status!: string

    @Column({ type: 'text', name: 'menu_items_json', default: '[]' })
    menuItemsJson!: string

    @Column({ type: 'text', name: 'runtime_config_json', default: '{}' })
    runtimeConfigJson!: string

    @Column({ length: 64, name: 'install_at', default: '' })
    installAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string
}

@Entity('app_releases')
@Index('idx_app_release_version', ['appId', 'version'], { unique: true })
export class AppReleaseDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128, name: 'app_id' })
    appId!: string

    @Column({ length: 64 })
    version!: string

    @Column({ length: 128 })
    publisher!: string

    @Column({ length: 128, name: 'publisher_key_id' })
    publisherKeyId!: string

    @Column({ length: 71, name: 'release_digest' })
    releaseDigest!: string

    @Column({ type: 'text' })
    image!: string

    @Column({ length: 32, default: 'submitted' })
    status!: string

    @Column({ type: 'text', name: 'artifact_path' })
    artifactPath!: string

    @Column({ type: 'text', name: 'validation_json', default: '{}' })
    validationJson!: string

    @Column({ length: 64, name: 'created_at', default: '' })
    createdAt!: string

    @Column({ length: 64, name: 'updated_at', default: '' })
    updatedAt!: string
}

@Entity('app_runtime_tasks')
@Index('idx_app_runtime_task_queue', ['instanceId', 'status', 'createdAt'])
export class AppRuntimeTaskDO {
    @PrimaryGeneratedColumn('uuid')
    uid!: string

    @Column({ length: 128, name: 'instance_id' })
    instanceId!: string

    @Column({ length: 128, name: 'app_id' })
    appId!: string

    @Column({ length: 32 })
    operation!: string

    @Column({ length: 64, name: 'target_version' })
    targetVersion!: string

    @Column({ length: 71, name: 'release_digest' })
    releaseDigest!: string

    @Column({ length: 32, default: 'pending' })
    status!: string

    @Column({ length: 128, name: 'claimed_by', default: '' })
    claimedBy!: string

    @Column({ length: 64, name: 'lease_expires_at', default: '' })
    leaseExpiresAt!: string

    @Column({ type: 'int', default: 1 })
    revision!: number

    @Column({ type: 'text', name: 'result_json', default: '{}' })
    resultJson!: string

    @Column({ type: 'text', name: 'payload_json', default: '{}' })
    payloadJson!: string

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

    @Column({ length: 128, default: '' })
    name!: string

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

    @Column({ type: 'text', name: 'result_json', default: '{}' })
    resultJson!: string

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

    @Column('text', { name: 'payload_json', default: '{}' })
    payloadJson!: string

    @Column({ type: 'int', name: 'chain_id', default: 0 })
    chainId!: number

    @Column({ length: 32 })
    status!: string

    @Column('text')
    approvals!: string

    @Column('text', { default: '' })
    signature!: string

    @Column('text', { name: 'result_json', default: '{}' })
    resultJson!: string

    @Column({ length: 64, name: 'completed_at', default: '' })
    completedAt!: string

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
