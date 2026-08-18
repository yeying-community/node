// src/server.ts

import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import { AppRuntimeConfig, DatabaseConfig } from './config';
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
    CustodyKeyRecordDO,
    PassportSubjectDO,
    PassportEmailVerificationChallengeDO,
    PassportWalletBindingDO,
    PassportPasskeyCredentialDO,
    PassportWebauthnChallengeDO,
    PassportAuthorizationRequestDO,
    PassportAuthorizationCodeDO,
    PassportAuditLogDO,
    ScopedGrantDO,
    ScopedGrantTokenDO,
    ScopedGrantRevocationDO,
    ScopedGrantAuditLogDO,
    NotificationDO,
    NotificationInboxDO,
    NotificationWebhookDO,
    NotificationDeliveryDO,
    MpcSessionDO,
    MpcSessionParticipantDO,
    MpcMessageDO,
    MpcSignRequestDO,
    MpcAuditLogDO,
    ProjectInstanceDO,
    ProjectAppInstallationDO,
    AppReleaseDO,
    AppRuntimeTaskDO,
    IdentityAccountLinkDO, IdentityAccountLinkChallengeDO, IdentityVerificationTransactionDO, IdentityUsernameDO, IdentityCredentialDO, IdentityAuditLogDO, IdentityAuthorizationRequestDO, IdentityAuthorizationCodeDO
} from './domain/mapper/entity'
import { SingletonDataSource } from './domain/facade/datasource';
import { LoggerConfig, LoggerService } from './infrastructure/logger';
import cors from 'cors';
import { buildCorsOptions } from './security/cors';
import authenticateToken from './middleware/authMiddleware';
import { requireAdmin } from './middleware/accessControl';
import { registerPublicAuthRoutes } from './routes/publicAuth';
import { registerPublicAuthCentralRoutes } from './routes/publicAuthCentral';
import { registerPublicAuthTotpRoutes } from './routes/publicAuthTotp';
import { registerPublicAuthPassportRoutes } from './routes/publicAuthPassport';
import { registerPublicAuthGrantRoutes } from './routes/publicAuthGrants';
import { registerPublicProfileRoute } from './routes/privateProfile';
import { registerPublicApplicationRoutes } from './routes/public/applications';
import { registerPublicAuditRoutes } from './routes/public/audits';
import { registerPublicHealthRoute } from './routes/public/health';
import { registerPublicMpcRoutes } from './routes/public/mpc';
import { registerPublicCustodyRoutes } from './routes/public/custody';
import { registerPublicNotificationRoutes } from './routes/public/notifications';
import { registerPublicIdentityRoutes } from './routes/publicIdentity';
import { registerPublicIdentityAccountLinkRoutes } from './routes/publicIdentityAccountLinks';
import { IdentityEmailService } from './domain/service/identityEmail';
import { registerPublicIdentityEmailRoutes } from './routes/publicIdentityEmail';
import { registerPublicIdentityAuthorizationRoutes } from './routes/publicIdentityAuthorization';
import { deliverPassportEmailVerification } from './domain/service/passportEmailDelivery';
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
import { AddNotificationWebhooksAndDeliveries20260624090000 } from './migrations/20260624090000-add-notification-webhooks-and-deliveries';
import { RepairNotificationDeliveryWebhookColumns20260701130000 } from './migrations/20260701130000-repair-notification-delivery-webhook-columns';
import { AddCustodyKeyRecords20260710090000 } from './migrations/20260710090000-add-custody-key-records';
import { AddProjectAppInstallations20260723100000 } from './migrations/20260723100000-add-project-app-installations';
import { registerPublisherReleaseRoutes } from './routes/publisher/releases';
import { registerAdminReleaseRoutes } from './routes/admin/releases';
import { AddAppReleases20260723110000 } from './migrations/20260723110000-add-app-releases';
import { AddAppRuntimeTasks20260724100000 } from './migrations/20260724100000-add-app-runtime-tasks';
import { AddRuntimeTaskPayload20260726100000 } from './migrations/20260726100000-add-runtime-task-payload';
import { AddPassportIdentity20260803100000 } from './migrations/20260803100000-add-passport-identity';
import { AddPassportSubjectEmailAndScopes20260809090000 } from './migrations/20260809090000-add-passport-subject-email-and-scopes';
import { AddPassportEmailVerificationChallenges20260809093000 } from './migrations/20260809093000-add-passport-email-verification-challenges';
import { AddPassportUsername20260812230000 } from './migrations/20260812230000-add-passport-username';
import { AddWalletIdentityState20260813090000 } from './migrations/20260813090000-add-wallet-identity-state';
import { AddWalletIdentityLinkChallenges20260813100000 } from './migrations/20260813100000-add-wallet-identity-link-challenges';
import { AddIdentityAuthorization20260818120000 } from './migrations/20260818120000-add-identity-authorization';
import { EnforcePassportPasskeyIdentity20260803110000 } from './migrations/20260803110000-enforce-passport-passkey-identity';
import { RepairPassportWebauthnChallenges20260803120000 } from './migrations/20260803120000-repair-passport-webauthn-challenges';
import { AddScopedGrants20260808090000 } from './migrations/20260808090000-add-scoped-grants';
import { getConfig } from './config/runtime';
import { startActionRequestCleanupJobs } from './domain/service/actionRequestCleanup';
import { startMpcCleanupJobs } from './domain/service/mpcCleanup';
import { initMpcEventBus } from './domain/service/mpcEvents';
import { startNotificationDeliveryJobs } from './domain/service/notificationDelivery';
import { SingletonLogger } from './domain/facade/logger';
import { getCentralIssuerStatus } from './auth/ucanIssuer';
import { getTotpAuthStatus } from './auth/totpAuth';
import { getPasskeyAuthStatus } from './auth/passportPasskeyAuth';
import { getRequiredRuntimeSecret, initializeRuntimeSecrets } from './security/secretVault';
import { assertJwtSecretReady } from './auth/siwe';

// 初始化日志
new LoggerService(getConfig<LoggerConfig>('logger')).initialize()
const logger = SingletonLogger.get()

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

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function registerAppStoreDeveloperManualPage(app: Express) {
    app.get('/development/manual', (_req: Request, res: Response) => {
        const manualPath = path.resolve(
            process.cwd(),
            'docs/YeYing-AppStore-Developer-Manual.md'
        )
        if (!fs.existsSync(manualPath)) {
            res.status(404).type('text/plain').send('Developer manual is unavailable')
            return
        }

        const markdown = fs.readFileSync(manualPath, 'utf8')
        res.type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YeYing AppStore 开发手册</title><style>body{max-width:960px;margin:32px auto;padding:0 20px;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#182230}pre{white-space:pre-wrap;word-break:break-word}</style></head><body><pre>${escapeHtml(markdown)}</pre></body></html>`)
    })
}

function registerWebStaticRoutes(app: Express, webDistDir: string) {
    if (!webDistDir) {
        return
    }

    app.use(express.static(webDistDir, {
        index: false,
        setHeaders(res, filePath) {
            if (path.basename(filePath) === 'index.html') {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
                return
            }
            if (filePath.includes(`${path.sep}static${path.sep}`)) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
            }
        }
    }))
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
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
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
            `中心化 UCAN 签发未就绪: ${issuerStatus.error || '缺少有效 ISSUER_PRIVATE_KEY'}`
        )
    }

    const totpStatus = getTotpAuthStatus()
    if (totpStatus.enabled && !totpStatus.ready) {
        errors.push(
            `TOTP 授权未就绪: ${totpStatus.error || '缺少有效 NODE_KEY_DERIVATION_SECRET'}`
        )
    }
    const passkeyStatus = getPasskeyAuthStatus()
    if (passkeyStatus.enabled && !passkeyStatus.ready) {
        errors.push(
            `Passport Passkey 授权未就绪: ${passkeyStatus.error || '缺少有效 passportAuth.passkey.rpId/origin 配置'}`
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
    username: getRequiredRuntimeSecret('DATABASE_USERNAME'),
    password: getRequiredRuntimeSecret('DATABASE_PASSWORD'),
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
    CustodyKeyRecordDO,
    PassportSubjectDO,
    PassportEmailVerificationChallengeDO,
    PassportWalletBindingDO,
    PassportPasskeyCredentialDO,
    PassportWebauthnChallengeDO,
    PassportAuthorizationRequestDO,
    PassportAuthorizationCodeDO,
    PassportAuditLogDO,
    ScopedGrantDO,
    ScopedGrantTokenDO,
    ScopedGrantRevocationDO,
    ScopedGrantAuditLogDO,
    NotificationDO,
    NotificationInboxDO,
    NotificationWebhookDO,
    NotificationDeliveryDO,
    MpcSessionDO,
    MpcSessionParticipantDO,
    MpcMessageDO,
    MpcSignRequestDO,
    MpcAuditLogDO,
    ProjectInstanceDO,
    ProjectAppInstallationDO,
    AppReleaseDO,
    AppRuntimeTaskDO,
    IdentityAccountLinkDO,
    IdentityAccountLinkChallengeDO,
    IdentityVerificationTransactionDO,
    IdentityUsernameDO,
    IdentityCredentialDO,
    IdentityAuditLogDO,
    IdentityAuthorizationRequestDO,
    IdentityAuthorizationCodeDO
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
    AddNotifications20260429110000,
    AddNotificationWebhooksAndDeliveries20260624090000,
    RepairNotificationDeliveryWebhookColumns20260701130000,
    AddCustodyKeyRecords20260710090000,
    AddProjectAppInstallations20260723100000,
    AddAppReleases20260723110000,
    AddAppRuntimeTasks20260724100000,
    AddRuntimeTaskPayload20260726100000,
    AddPassportIdentity20260803100000,
    EnforcePassportPasskeyIdentity20260803110000,
    RepairPassportWebauthnChallenges20260803120000,
    AddScopedGrants20260808090000,
    AddPassportSubjectEmailAndScopes20260809090000,
    AddPassportEmailVerificationChallenges20260809093000,
    AddPassportUsername20260812230000,
    AddWalletIdentityState20260813090000,
    AddWalletIdentityLinkChallenges20260813100000,
    AddIdentityAuthorization20260818120000
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
        logger.info('mysql mode enabled, using synchronize schema initialization (no postgres migrations)')
    }
    logger.info('database initialized')
    initMpcEventBus()
    startActionRequestCleanupJobs()
    startMpcCleanupJobs()
    startNotificationDeliveryJobs()
    // 创建 Express 应用
    const app = express();
    const webDistDir = resolveWebDistDir()
    app.use(cors(buildCorsOptions(getConfig<AppRuntimeConfig>('app'))));

    // 设置 JSON 解析中间件
    app.use(express.json());
    registerApiRequestLogger(app);

    // Agent Runtime owns Project install/upgrade/uninstall and runtime task APIs.
    // Node only keeps registry, release publishing and authorization endpoints.
    registerAppStoreDeveloperManualPage(app);

    // ✅ 将鉴权中间件应用到所有 API 路由（公共认证/健康检查除外）
    app.use('/api/v1', authenticateToken);
    // ✅ 管理员接口前缀控制
    app.use('/api/v1/admin', requireAdmin);


    registerPublicAuthRoutes(app);
    registerPublicIdentityRoutes(app);
    registerPublicIdentityAccountLinkRoutes(app);
    registerPublicIdentityEmailRoutes(app, new IdentityEmailService(async ({ email, code, expiresAt }) => {
        await deliverPassportEmailVerification({ email, code, verificationId: `identity-${Date.now()}`, expiresAt });
    }));
    registerPublicIdentityAuthorizationRoutes(app);
    registerPublicAuthCentralRoutes(app);
    registerPublicAuthTotpRoutes(app);
    registerPublicAuthPassportRoutes(app);
    registerPublicAuthGrantRoutes(app);
    registerPublicHealthRoute(app);
    registerPublicProfileRoute(app);
    registerPublicApplicationRoutes(app);
    registerPublisherReleaseRoutes(app);
    registerPublicAuditRoutes(app);
    registerPublicMpcRoutes(app);
    registerPublicCustodyRoutes(app);
    registerPublicNotificationRoutes(app);
    registerAdminAuditRoutes(app);
    registerAdminUserRoutes(app);
    registerAdminReleaseRoutes(app);
    registerWebStaticRoutes(app, webDistDir);

    // 启动服务器
    app.listen(port, '0.0.0.0', () => {
        if (webDistDir) {
            logger.info('serving frontend assets', { webDistDir })
        }
        logger.info('server started', {
            host: '0.0.0.0',
            port,
            url: `http://localhost:${port}`,
        })
    });

}).catch(error => {
    logger.error('database connection failed', {
        error: error instanceof Error ? error.message : String(error),
    })
})
