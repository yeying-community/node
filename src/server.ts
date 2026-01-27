// src/server.ts

import express, { Request, Response } from 'express';
import api from './index'; // 导入你提供的路由注册函数
import { ApiImplementation } from './types'; // 假设 types.ts 中导出了 ApiImplementation 接口
// 导入你的实现
import application from './impl/application'
import archive from './impl/archive'
import asset from './impl/asset'
import assignment from './impl/assignment'
import audit from './impl/audit'
import block from './impl/block'
import bulletin from './impl/bulletin'
import certificate from './impl/certificate'
import config from './impl/config'
import content from './impl/content'
import context from './impl/context'
import event from './impl/event'
import experience from './impl/experience'
import group from './impl/group'
import homework from './impl/homework'
import identity from './impl/identity'
import invitation from './impl/invitation'
import knowledge from './impl/knowledge'
import link from './impl/link'
import llm from './impl/llm'
import mail from './impl/mail'
import message from './impl/message'
import minio from './impl/minio'
import mistakes from './impl/mistakes'
import namespace from './impl/namespace'
import network from './impl/network'
import node from './impl/node'
import provider from './impl/provider'
import recycle from './impl/recycle'
import room from './impl/room'
import service from './impl/service'
import session from './impl/session'
import social from './impl/social'
import spider from './impl/spider'
import support from './impl/support'
import task from './impl/task'
import taskTag from './impl/taskTag'
import topic from './impl/topic'
import user from './impl/user'
import vector from './impl/vector'
import wallet from './impl/wallet'
import warehouse from './impl/warehouse'
import swaggerUi from 'swagger-ui-express'
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseConfig, ServerConfig } from './config';
import { DataSourceBuilder } from './infrastructure/db';
import {
    ApplicationDO,
    CardDO,
    CertificateDO,
    EventDO,
    InvitationDO,
    ServiceDO,
    SolutionDO,
    SupportDO,
    UserDO,
    UserStateDO,
    AuditDO,
    CommentDO
} from './domain/mapper/entity'
import config2 from 'config'
import { SingletonDataSource } from './domain/facade/datasource';
import { LoggerConfig, LoggerService } from './infrastructure/logger';
import cors from 'cors';
import authenticateToken from './middleware/authMiddleware';
import { requireAdmin, requireInternal } from './middleware/accessControl';
import { registerPublicAuthRoutes } from './routes/publicAuth';
import { registerPrivateProfileRoute } from './routes/privateProfile';
import { registerPublishRoutes } from './routes/publish';
import { registerAdminUserRoleRoute } from './routes/adminUserRole';
import { InitSchema20260126120000 } from './migrations/20260126120000-init-schema';

// 初始化日志
new LoggerService(config2.get<LoggerConfig>('logger')).initialize()

const serverConfig: ServerConfig = config2.get<ServerConfig>('server')
let port = 8001
if (process.env.APP_PORT) {
    port = Number(process.env.APP_PORT)
}

// 初始化数据库
const databaseConfig: DatabaseConfig = config2.get<DatabaseConfig>('database')
const builder = new DataSourceBuilder({ ...databaseConfig, synchronize: false })
builder.entities([
    UserStateDO,
    UserDO,
    ServiceDO,
    ApplicationDO,
    SupportDO,
    SolutionDO,
    EventDO,
    CertificateDO,
    InvitationDO,
    CardDO,
    AuditDO,
    CommentDO
])
builder.migrations([InitSchema20260126120000])

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
    // 创建 Express 应用
    const app = express();
    app.use(cors({ origin: true, credentials: true }));

    // 设置 JSON 解析中间件
    app.use(express.json());

    // ✅ 将鉴权中间件应用到所有 API 路由（公共认证/健康检查除外）
    app.use('/api', authenticateToken);
    // ✅ 管理员与内部接口前缀控制
    app.use('/api/v1/admin', requireAdmin);
    app.use('/api/v1/internal', requireInternal);


    const impl: ApiImplementation = {
        application:application,
        archive:archive,
        asset:asset,
        assignment:assignment,
        audit:audit,
        block:block,
        bulletin:bulletin,
        certificate:certificate,
        config:config,
        content:content,
        context:context,
        event:event,
        experience:experience,
        group:group,
        homework:homework,
        identity:identity,
        invitation:invitation,
        knowledge:knowledge,
        link:link,
        llm:llm,
        mail:mail,
        message:message,
        minio:minio,
        mistakes:mistakes,
        namespace:namespace,
        network:network,
        node:node,
        provider:provider,
        recycle:recycle,
        room:room,
        service:service,
        session:session,
        social:social,
        spider:spider,
        support:support,
        task:task,
        taskTag:taskTag,
        topic:topic,
        user:user,
        vector:vector,
        wallet:wallet,
        warehouse:warehouse,
    };

    const envValue = process.env.APP_ENV
    if (envValue === "dev") {
        // 🌟 注册 Swagger UI
        // 读取你已有的 openapi.json 文件
        const openapiPath = path.join(__dirname, '../openapi.json');
        const openapiDocument = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
        // 挂载 Swagger UI，使用你自己的 openapi.json
        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
    }
    // 注册公共认证路由（SIWE）
    registerPublicAuthRoutes(app);
    // 示例私有接口（支持 JWT / UCAN）
    registerPrivateProfileRoute(app);
    // 上架/下架接口
    registerPublishRoutes(app);
    // 管理员角色更新
    registerAdminUserRoleRoute(app);
    // 注册所有路由
    api(app, impl);

    // 启动服务器
    app.listen(port, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://localhost:${port}`);
    });

}).catch(error => console.log("Database connection failed", error))
