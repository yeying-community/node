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
}

export interface AuditRuntimeConfig {
    approvers?: string[]
    requiredApprovals?: number
}
