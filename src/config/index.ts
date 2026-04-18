export interface DatabaseConfig {
    type: 'sqlite' | 'better-sqlite3' | 'mysql' | 'postgres'
    database: string
    username?: string
    password?: string
    host?: string
    port?: number
    synchronize?: boolean
    logging?: boolean
}

export interface AppRuntimeConfig {
    env: string
    port: number
}

export interface AuthRuntimeConfig {
    jwtSecret: string
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
    did?: string
    privateKey?: string
    sessionTtlMs?: number
    tokenTtlMs?: number
    defaultAudience?: string
    defaultCapabilities?: UcanIssuerCapabilityConfig[]
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

export interface RedisRuntimeConfig {
    enabled?: boolean
    host?: string
    port?: number
    username?: string
    password?: string
    db?: number
    keyPrefix?: string
    channel?: string
    tls?: boolean
    instanceId?: string
    streamEnabled?: boolean
    streamOnly?: boolean
    streamKeyPrefix?: string
    streamMaxLen?: number
    streamApprox?: boolean
}
