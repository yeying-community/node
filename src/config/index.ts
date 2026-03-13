export interface DatabaseConfig {
    type: 'sqlite' | 'mysql' | 'postgres'
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

export interface UcanRuntimeConfig {
    aud: string
    resource: string
    action: string
    centralIssuerEnabled?: boolean
    centralIssuerDid?: string
}

export interface AuditRuntimeConfig {
    approvers?: string[]
    requiredApprovals?: number
}

export interface MpcRuntimeConfig {
    messageRetentionDays?: number
    auditRetentionDays?: number
    cleanupIntervalMs?: number
    ucanResource?: string
    ucanAction?: string
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
