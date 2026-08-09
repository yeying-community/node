# YeYing Node

YeYing Node 是社区控制面，面向社区应用、钱包与 Agent Runtime 提供身份、授权、应用目录和治理能力。它不是 Project 的业务后端，也不负责 Agent Runtime 的安装、升级、回滚、任务调度或运行状态。

## 提供什么

- Passport：SIWE、JWT、UCAN、Passkey、TOTP、应用授权码和 PKCE 登录交换。
- 授权控制：应用授权策略、中心化 UCAN 签发、Scoped Grant、撤销与审计。
- 应用中心：应用登记、发布审核、release artifact 与开发者目录。
- 社区能力：通知、Webhook 投递、MPC 协调、钱包加密快照控制面。

前端位于 `web/`，采用 Vue 3 + Vite；后端位于 `src/`，采用 Express + TypeScript + TypeORM。生产环境使用 PostgreSQL migration；MySQL 仅使用实体同步模式。

## 本地开发

### 前置条件

- Node.js 24。
- npm。
- PostgreSQL 16+，本地建议使用 Docker。

Node 依赖 PostgreSQL 或 MySQL，开发环境推荐 PostgreSQL。以下示例使用本地 PostgreSQL 和默认端口：后端 `8100`，前端 `8991`。

### 1. 启动数据库

使用一个可访问的 PostgreSQL 数据库，并创建 `node` 数据库和对应用户。若使用社区 deployer：

```bash
git clone git@github.com:yeying-community/deployer.git
cd deployer/middleware/postgresql
cp .env.template .env
docker compose up -d
./database.sh create-db -d node -u node_user
```

### 2. 启动后端

在项目根目录执行：

```bash
cp config.js.template config.js
npm install
```

编辑 `config.js` 的 `database`，填入本地数据库连接信息；开发环境至少需要设置：

```js
database: {
  type: 'postgres',
  host: '127.0.0.1',
  port: 5432,
  database: 'node',
  username: 'node_user',
  password: '<local-password>',
  schema: 'node',
  synchronize: false
}
```

通过环境变量提供本地 JWT 密钥后启动热更新服务：

```bash
JWT_SECRET="$(openssl rand -hex 32)" npm run dev
```

后端地址：<http://localhost:8100>。健康检查：<http://localhost:8100/api/v1/public/health>。

需要模拟生产的加密密钥启动方式时，先执行 `npm run secrets:init`，然后使用：

```bash
npm run dev:secure
```

### 3. 启动前端

另开一个终端：

```bash
cd web
cp .env.template .env
npm install
npm run dev -- --port 8991
```

确认 `web/.env` 至少包含：

```dotenv
VITE_NODE_API_ENDPOINT=http://localhost:8100
```

访问 <http://localhost:8991>。Vite 会将 `/api` 请求代理至后端，常规前后端开发不需要额外配置 Nginx。

## 常用命令

```bash
npm test                         # 后端测试
npm run build                    # 编译后端到 dist/
npm run build:web                # 构建前端到 web/dist/
npm run build:all                # 构建前后端
npm run openapi:check            # 校验 OpenAPI 生成文件
npm audit --omit=dev --audit-level=high
```

`dist/` 是后端 TypeScript 编译产物，使用 `node dist/server.js` 运行；`web/dist/` 是 Vite 生成的浏览器静态资源。两者都属于生产发布包，不能相互替代。

## 文档

- [文档总览](./docs/README.md)
- [生产环境部署手册](./docs/生产环境部署手册.md)
- [运行配置](./docs/运行配置.md)
- [节点架构 V1](./docs/节点架构V1.md) 与 [节点架构 V2](./docs/节点架构V2.md)
- [Node 使用指南](./docs/Node使用指南.md)
- [OpenAPI 3.1](./docs/openapi/node.openapi.yaml)

## 生产发布

生产部署不要直接执行开发模式。使用发布包、`scripts/starter.sh`、加密密钥文件和反向代理；完整步骤、Nginx 配置、升级与回滚说明见[生产环境部署手册](./docs/生产环境部署手册.md)。
