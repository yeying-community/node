// src/server.ts

import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response } from 'express';
import { DatabaseConfig } from './config';
import { DataSourceBuilder } from './infrastructure/db';
import {
    ActionRequestDO,
    ApplicationDO,
    ServiceDO,
    UserDO,
    UserStateDO,
    AuditDO,
    CommentDO,
    ServiceConfigDO,
    ApplicationConfigDO,
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
import { registerPublicAuthMobileRoutes } from './routes/publicAuthMobile';
import { registerPublicProfileRoute } from './routes/privateProfile';
import { registerPublicApplicationRoutes } from './routes/public/applications';
import { registerPublicServiceRoutes } from './routes/public/services';
import { registerPublicAuditRoutes } from './routes/public/audits';
import { registerPublicHealthRoute } from './routes/public/health';
import { registerPublicMpcRoutes } from './routes/public/mpc';
import { registerAdminAuditRoutes } from './routes/admin/audits';
import { registerAdminUserRoutes } from './routes/admin/users';
import { InitSchema20260126120000 } from './migrations/20260126120000-init-schema';
import { AddServiceConfig20260128194500 } from './migrations/20260128194500-add-service-config';
import { AddApplicationConfig20260128195500 } from './migrations/20260128195500-add-application-config';
import { AddMpcCoordinator20260205120000 } from './migrations/20260205120000-add-mpc-coordinator';
import { AddAuditPreviousStateColumns20260402110000 } from './migrations/20260402110000-add-audit-previous-state-columns';
import { AddActionRequestDedup20260402170000 } from './migrations/20260402170000-add-action-request-dedup';
import { getConfig } from './config/runtime';
import { startActionRequestCleanupJobs } from './domain/service/actionRequestCleanup';
import { startMpcCleanupJobs } from './domain/service/mpcCleanup';
import { initMpcEventBus } from './domain/service/mpcEvents';
import { SingletonLogger } from './domain/facade/logger';

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

// 初始化数据库
const databaseConfig: DatabaseConfig = getConfig<DatabaseConfig>('database')
const shouldSynchronizeSchema =
    (databaseConfig.type === 'sqlite' || databaseConfig.type === 'better-sqlite3') &&
    Boolean(databaseConfig.synchronize)
const builder = new DataSourceBuilder({ ...databaseConfig, synchronize: shouldSynchronizeSchema })
builder.entities([
    ActionRequestDO,
    UserStateDO,
    UserDO,
    ServiceDO,
    ApplicationDO,
    AuditDO,
    CommentDO,
    ServiceConfigDO,
    ApplicationConfigDO,
    MpcSessionDO,
    MpcSessionParticipantDO,
    MpcMessageDO,
    MpcSignRequestDO,
    MpcAuditLogDO
])
builder.migrations([
    InitSchema20260126120000,
    AddServiceConfig20260128194500,
    AddApplicationConfig20260128195500,
    AddMpcCoordinator20260205120000,
    AddAuditPreviousStateColumns20260402110000,
    AddActionRequestDedup20260402170000
])

builder.build().initialize().then(async (conn) => {
    // 注册数据库连接
    SingletonDataSource.set(conn)
    if (!shouldSynchronizeSchema) {
        if (conn.options.type === 'postgres') {
            const schema = (conn.options.schema as string) || 'public'
            const schemaRef = `"${schema.replace(/"/g, '""')}"`
            await conn.query(`CREATE SCHEMA IF NOT EXISTS ${schemaRef}`)
        }
        await conn.runMigrations()
    } else {
        console.log('Local sqlite synchronize mode enabled, skipping migrations.')
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
    registerPublicAuthMobileRoutes(app);
    registerPublicHealthRoute(app);
    registerPublicProfileRoute(app);
    registerPublicApplicationRoutes(app);
    registerPublicServiceRoutes(app);
    registerPublicAuditRoutes(app);
    registerPublicMpcRoutes(app);
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
