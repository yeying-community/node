export interface DatabaseConfig {
    type: 'mysql' | 'postgres'
    database: string
    username?: string
    password?: string
    host?: string
    port?: number
    logging?: boolean
    schema?: string
    synchronize?: boolean
}

export interface AppRuntimeConfig {
    env: string
    port: number
    corsAllowedOrigins?: string[]
}

export interface MailRuntimeConfig {
    host?: string
    port?: number
    secure?: boolean
    from?: string
    replyTo?: string
}

export interface SecretsRuntimeConfig {
    file?: string
    passwordFile?: string
}

export interface AuthRuntimeConfig {
    accessTtlMs: number
    refreshTtlMs: number
    challengeTtlMs: number
    cookieSameSite?: 'lax' | 'strict' | 'none'
    cookieSecure?: boolean
    refreshCookieName?: string
}

export interface IdempotencyRuntimeConfig {
    responseRetentionDays?: number
    successRetentionDays?: number
    failureRetentionDays?: number
    pendingTimeoutMs?: number
    cleanupIntervalMs?: number
}

export interface UcanRuntimeConfig {
    aud: string
    with?: string
    can?: string
}

export type UcanIssuerMode = 'verify' | 'issue' | 'hybrid'

export interface UcanIssuerCapabilityConfig {
    with: string
    can: string
}

export interface UcanIssuerRuntimeConfig {
    enabled?: boolean
    mode?: UcanIssuerMode
    sessionTtlMs?: number
    tokenTtlMs?: number
    defaultAudience?: string
    defaultCapabilities?: UcanIssuerCapabilityConfig[]
}

export interface IdentityPasskeyRuntimeConfig {
    enabled?: boolean
    rpId?: string
    rpName?: string
    origin?: string
    timeoutMs?: number
    challengeTtlMs?: number
}

export interface IdentityTotpRuntimeConfig {
    issuerName?: string
}

export interface IdentityRuntimeConfig {
    publicBaseUrl?: string
    webauthn?: IdentityPasskeyRuntimeConfig
    totp?: IdentityTotpRuntimeConfig
}

export interface IdentityIssuerRuntimeConfig {
    enabled?: boolean
    usernameNamespace?: string
}

export interface AuditRuntimeConfig {
    approvers?: string[]
    requiredApprovals?: number
}

export interface MpcRuntimeConfig {
    messageRetentionDays?: number
    auditRetentionDays?: number
    cleanupIntervalMs?: number
    ucanWith?: string
    ucanCan?: string
}

export interface NotificationRuntimeConfig {
    webhookDeliveryEnabled?: boolean
    webhookDeliveryIntervalMs?: number
    webhookDeliveryBatchSize?: number
    webhookDeliveryTimeoutMs?: number
    webhookClaimTimeoutMs?: number
    webhookMaxAttempts?: number
    webhookRetryBaseDelayMs?: number
    webhookRetryMaxDelayMs?: number
    emailDeliveryEnabled?: boolean
    emailDeliveryIntervalMs?: number
    emailDeliveryBatchSize?: number
    emailMaxAttempts?: number
    emailRetryBaseDelayMs?: number
    emailRetryMaxDelayMs?: number
}

export interface RedisRuntimeConfig {
    enabled?: boolean
    host?: string
    port?: number
    username?: string
    db?: number
    keyPrefix?: string
    channel?: string
    pusherChannel?: string
    tls?: boolean
    instanceId?: string
    streamEnabled?: boolean
    streamOnly?: boolean
    streamKeyPrefix?: string
    streamMaxLen?: number
    streamApprox?: boolean
}

export interface ProjectAdapterRuntimeConfig {
    defaultInstanceId?: string
    requestTimeoutMs?: number
}

export interface AppStorePublisherKeyConfig {
    owner: string
    publicKey: string
}

export interface AppStoreReleaseRuntimeConfig {
    artifactDir?: string
    maxBundleBytes?: number
    publisherKeys?: Record<string, AppStorePublisherKeyConfig>
}

export interface AppStoreAgentInstanceConfig {
    tokenSha256: string
    leaseSeconds?: number
}

export interface AppStoreAgentRuntimeConfig {
    instances?: Record<string, AppStoreAgentInstanceConfig>
}
