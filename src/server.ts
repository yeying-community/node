// src/server.ts

import express, { Request, Response } from 'express';
import { DatabaseConfig } from './config';
import { DataSourceBuilder } from './infrastructure/db';
import {
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
import { requireAdmin, requireInternal } from './middleware/accessControl';
import { registerPublicAuthRoutes } from './routes/publicAuth';
import { registerPublicCentralUcanRoutes } from './routes/public/centralUcan';
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
import { getConfig } from './config/runtime';
import { startMpcCleanupJobs } from './domain/service/mpcCleanup';
import { initMpcEventBus } from './domain/service/mpcEvents';

// 初始化日志
new LoggerService(getConfig<LoggerConfig>('logger')).initialize()

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
const builder = new DataSourceBuilder({ ...databaseConfig, synchronize: false })
builder.entities([
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
    AddMpcCoordinator20260205120000
])

builder.build().initialize().then(async (conn) => {
    // 注册数据库连接
    SingletonDataSource.set(conn)
    if (conn.options.type === 'postgres') {
        const schema = (conn.options.schema as string) || 'public'
        const schemaRef = `"${schema.replace(/"/g, '""')}"`
        await conn.query(`CREATE SCHEMA IF NOT EXISTS ${schemaRef}`)
    }
    await conn.runMigrations()
    console.log('The database has been initialized.')
    initMpcEventBus()
    startMpcCleanupJobs()
    // 创建 Express 应用
    const app = express();
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

    // ✅ 将鉴权中间件应用到所有 API 路由（公共认证/健康检查除外）
    app.use('/api/v1', authenticateToken);
    // ✅ 管理员与内部接口前缀控制
    app.use('/api/v1/admin', requireAdmin);
    app.use('/api/v1/internal', requireInternal);


    registerPublicAuthRoutes(app);
    registerPublicCentralUcanRoutes(app);
    registerPublicHealthRoute(app);
    registerPublicProfileRoute(app);
    registerPublicApplicationRoutes(app);
    registerPublicServiceRoutes(app);
    registerPublicAuditRoutes(app);
    registerPublicMpcRoutes(app);
    registerAdminAuditRoutes(app);
    registerAdminUserRoutes(app);

    // 启动服务器
    app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${port}`);
    });

}).catch(error => console.log("Database connection failed", error))
