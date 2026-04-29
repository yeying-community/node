// src/server.ts

import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import { DatabaseConfig } from './config';
import { DataSourceBuilder } from './infrastructure/db';
import {
    ActionRequestDO,
    ApplicationDO,
    UserDO,
    UserStateDO,
    AuditDO,
    CommentDO,
    ApplicationConfigDO,
    TotpSubjectSecretDO,
    NotificationDO,
    NotificationInboxDO,
    MpcSessionDO,
    MpcSessionParticipantDO,
    MpcMessageDO,
    MpcSignRequestDO,
    MpcAuditLogDO
} from './domain/mapper/entity'
import { SingletonDataSource } from './domain/facade/datasource';
import { LoggerConfig, LoggerService } from './infrastructure/logger';
import cors from 'cors';
import authenticateToken from './middleware/authMiddleware';
import { requireAdmin } from './middleware/accessControl';
import { registerPublicAuthRoutes } from './routes/publicAuth';
import { registerPublicAuthCentralRoutes } from './routes/publicAuthCentral';
import { registerPublicAuthTotpRoutes } from './routes/publicAuthTotp';
import { registerPublicProfileRoute } from './routes/privateProfile';
import { registerPublicApplicationRoutes } from './routes/public/applications';
import { registerPublicAuditRoutes } from './routes/public/audits';
import { registerPublicHealthRoute } from './routes/public/health';
import { registerPublicMpcRoutes } from './routes/public/mpc';
import { registerPublicNotificationRoutes } from './routes/public/notifications';
import { registerAdminAuditRoutes } from './routes/admin/audits';
import { registerAdminUserRoutes } from './routes/admin/users';
import { InitSchema20260126120000 } from './migrations/20260126120000-init-schema';
import { AddApplicationConfig20260128195500 } from './migrations/20260128195500-add-application-config';
import { AddMpcCoordinator20260205120000 } from './migrations/20260205120000-add-mpc-coordinator';
import { AddAuditPreviousStateColumns20260402110000 } from './migrations/20260402110000-add-audit-previous-state-columns';
import { AddActionRequestDedup20260402170000 } from './migrations/20260402170000-add-action-request-dedup';
import { DropServiceTables20260423103000 } from './migrations/20260423103000-drop-service-tables';
import { AddApplicationRedirectUris20260423121000 } from './migrations/20260423121000-add-application-redirect-uris';
import { AddTotpSubjectSecrets20260423182000 } from './migrations/20260423182000-add-totp-subject-secrets';
import { AddApplicationUcanPolicy20260423193000 } from './migrations/20260423193000-add-application-ucan-policy';
import { BackfillApplicationUcanPolicy20260424110000 } from './migrations/20260424110000-backfill-application-ucan-policy';
import { FixApplicationUcanPolicyRouterPriority20260424123000 } from './migrations/20260424123000-fix-application-ucan-policy-router-priority';
import { AddNotifications20260429110000 } from './migrations/20260429110000-add-notifications';
import { getConfig } from './config/runtime';
import { startActionRequestCleanupJobs } from './domain/service/actionRequestCleanup';
import { startMpcCleanupJobs } from './domain/service/mpcCleanup';
import { initMpcEventBus } from './domain/service/mpcEvents';
import { SingletonLogger } from './domain/facade/logger';
import { getCentralIssuerStatus } from './auth/ucanIssuer';
import { getTotpAuthStatus } from './auth/totpAuth';
import { initializeRuntimeSecrets } from './security/secretVault';
import { assertJwtSecretReady } from './auth/siwe';

// 初始化日志
new LoggerService(getConfig<LoggerConfig>('logger')).initialize()

function resolveWebDistDir() {
    const candidates: string[] = []
    const envDir = process.env.WEB_DIST_DIR?.trim()
    if (envDir) {
        candidates.push(path.resolve(envDir))
    }
    candidates.push(path.resolve(process.cwd(), 'web/dist'))
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'index.html'))) {
            return candidate
        }
    }
    return ''
}

function registerWebStaticRoutes(app: Express, webDistDir: string) {
    if (!webDistDir) {
        return
    }

    app.use(express.static(webDistDir, { index: false }))
    app.use((req: Request, res: Response, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            next()
            return
        }
        if (req.path === '/api' || req.path.startsWith('/api/')) {
            next()
            return
        }
        if (path.extname(req.path)) {
            next()
            return
        }
        res.sendFile(path.join(webDistDir, 'index.html'), (error) => {
            if (error) {
                next(error)
            }
        })
    })
}

function resolveClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for']
    if (Array.isArray(forwarded) && forwarded.length > 0) {
        return forwarded[0]
    }
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim()
    }
    return req.socket.remoteAddress || ''
}

function registerApiRequestLogger(app: Express) {
    app.use((req: Request, res: Response, next) => {
        const startAt = Date.now()
        res.on('finish', () => {
            if (!req.originalUrl.startsWith('/api/')) {
                return
            }
            const durationMs = Date.now() - startAt
            SingletonLogger.get().info('request completed', {
                method: req.method,
                path: req.originalUrl,
                status: res.statusCode,
                durationMs,
                ip: resolveClientIp(req)
            })
        })
        next()
    })
}

function assertSecurityPreflight(): void {
    const errors: string[] = []
    try {
        assertJwtSecretReady()
    } catch (error) {
        errors.push(error instanceof Error ? error.message : 'JWT secret is not ready')
    }
    const issuerStatus = getCentralIssuerStatus()
    const issueModeEnabled =
        issuerStatus.mode === 'issue' || issuerStatus.mode === 'hybrid'
    if (issuerStatus.enabled && issueModeEnabled && !issuerStatus.ready) {
        errors.push(
            `中心化 UCAN 签发未就绪: ${issuerStatus.error || '缺少有效 UCAN_ISSUER_PRIVATE_KEY/UCAN_ISSUER_DID'}`
        )
    }

    const totpStatus = getTotpAuthStatus()
    if (totpStatus.enabled && !totpStatus.ready) {
        errors.push(
            `TOTP 授权未就绪: ${totpStatus.error || '缺少有效 TOTP_AUTH_TOTP_MASTER_KEY'}`
        )
    }

    if (errors.length > 0) {
        throw new Error(`安全启动检查失败:\n- ${errors.join('\n- ')}`)
    }
}

let port = 8100
const configPort = getConfig<number>('app.port')
if (typeof configPort === 'number' && Number.isFinite(configPort)) {
    port = configPort
}
if (process.env.APP_PORT) {
    const envPort = Number(process.env.APP_PORT)
    if (Number.isFinite(envPort) && envPort > 0) {
        port = envPort
    }
}

initializeRuntimeSecrets()
assertSecurityPreflight()

// 初始化数据库
const databaseConfig: DatabaseConfig = getConfig<DatabaseConfig>('database')
if (databaseConfig.type !== 'postgres' && databaseConfig.type !== 'mysql') {
    throw new Error(`Only postgres/mysql is supported, got: ${databaseConfig.type}`)
}
const usePostgresMigrations = databaseConfig.type === 'postgres'
const builder = new DataSourceBuilder({
    ...databaseConfig,
    synchronize: usePostgresMigrations ? false : Boolean(databaseConfig.synchronize ?? true)
})
builder.entities([
    ActionRequestDO,
    UserStateDO,
    UserDO,
    ApplicationDO,
    AuditDO,
    CommentDO,
    ApplicationConfigDO,
    TotpSubjectSecretDO,
    NotificationDO,
    NotificationInboxDO,
    MpcSessionDO,
    MpcSessionParticipantDO,
    MpcMessageDO,
    MpcSignRequestDO,
    MpcAuditLogDO
])
builder.migrations([
    InitSchema20260126120000,
    AddApplicationConfig20260128195500,
    AddMpcCoordinator20260205120000,
    AddAuditPreviousStateColumns20260402110000,
    AddActionRequestDedup20260402170000,
    DropServiceTables20260423103000,
    AddApplicationRedirectUris20260423121000,
    AddTotpSubjectSecrets20260423182000,
    AddApplicationUcanPolicy20260423193000,
    BackfillApplicationUcanPolicy20260424110000,
    FixApplicationUcanPolicyRouterPriority20260424123000,
    AddNotifications20260429110000
])

builder.build().initialize().then(async (conn) => {
    // 注册数据库连接
    SingletonDataSource.set(conn)
    if (usePostgresMigrations) {
        const schema = (conn.options as { schema?: string }).schema || 'public'
        const schemaRef = `"${schema.replace(/"/g, '""')}"`
        await conn.query(`CREATE SCHEMA IF NOT EXISTS ${schemaRef}`)
        await conn.runMigrations()
    } else {
        console.log('MySQL mode enabled, using synchronize schema initialization (no postgres migrations).')
    }
    console.log('The database has been initialized.')
    initMpcEventBus()
    startActionRequestCleanupJobs()
    startMpcCleanupJobs()
    // 创建 Express 应用
    const app = express();
    const webDistDir = resolveWebDistDir()
    app.use(cors({ origin: true, credentials: true }));
    app.use((req, res, next) => {
        const origin = req.headers.origin as string | undefined;
        if (origin) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Vary', 'Origin');
            res.header('Access-Control-Allow-Credentials', 'true');
        } else {
            res.header('Access-Control-Allow-Origin', '*');
        }
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }
        next();
    });

    // 设置 JSON 解析中间件
    app.use(express.json());
    registerApiRequestLogger(app);

    // ✅ 将鉴权中间件应用到所有 API 路由（公共认证/健康检查除外）
    app.use('/api/v1', authenticateToken);
    // ✅ 管理员接口前缀控制
    app.use('/api/v1/admin', requireAdmin);


    registerPublicAuthRoutes(app);
    registerPublicAuthCentralRoutes(app);
    registerPublicAuthTotpRoutes(app);
    registerPublicHealthRoute(app);
    registerPublicProfileRoute(app);
    registerPublicApplicationRoutes(app);
    registerPublicAuditRoutes(app);
    registerPublicMpcRoutes(app);
    registerPublicNotificationRoutes(app);
    registerAdminAuditRoutes(app);
    registerAdminUserRoutes(app);
    registerWebStaticRoutes(app, webDistDir);

    // 启动服务器
    app.listen(port, '0.0.0.0', () => {
        if (webDistDir) {
            console.log(`📦 Serving frontend assets from ${webDistDir}`)
        }
        console.log(`🚀 Server is running on http://localhost:${port}`);
    });

}).catch(error => console.log("Database connection failed", error))
