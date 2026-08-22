# YeYing Node

YeYing Node 是社区控制面，面向社区应用、钱包与 Agent Runtime 提供身份、授权、应用目录和治理能力。它不是 Project 的业务后端，也不负责 Agent Runtime 的安装、升级、回滚、任务调度或运行状态。

## 提供什么

- 身份与登录：SIWE、JWT、钱包身份 DID、身份 Passkey、TOTP、应用授权码和 PKCE 登录交换。
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
  schema: 'node',
  synchronize: false
}
```

初始化本地密钥仓后启动热更新服务：

```bash
npm run secrets:init
npm run dev:secure
```

后端地址：<http://localhost:8100>。健康检查：<http://localhost:8100/api/v1/public/health>。

使用 `npm run secrets:set DATABASE_USERNAME`、`npm run secrets:set DATABASE_PASSWORD` 写入本地数据库凭据。

### 密钥仓运维

后端只有两类配置来源：`config.js` 保存非敏感运行参数，`secrets.enc.json` 保存全部敏感凭据。密钥仓使用 `AES-256-GCM + PBKDF2` 加密，文件权限固定为 `0600`；任何运维脚本均通过交互终端读取口令，不接收环境变量、命令行参数或标准输出中的明文密钥。

`config.js` 需要明确密钥仓位置和启动时一次性口令文件位置：

```js
secrets: {
  file: 'run/secrets.enc.json',
  passwordFile: 'run/.secrets-password'
}
```

初始化只应执行一次。它生成统一 Issuer 私钥 `ISSUER_PRIVATE_KEY` 和内部派生根 `NODE_KEY_DERIVATION_SECRET`，不会擅自生成数据库、Redis 或 SMTP 的外部凭据：

```bash
npm run secrets:init
```

将外部凭据逐项交互写入或轮换。每次更新都会先解密、以新的随机 salt/iv 重新加密，然后原子替换密钥仓文件：

```bash
npm run secrets:set DATABASE_USERNAME
npm run secrets:set DATABASE_PASSWORD
npm run secrets:set ISSUER_PRIVATE_KEY
npm run secrets:set NODE_KEY_DERIVATION_SECRET
npm run secrets:set REDIS_USERNAME
npm run secrets:set REDIS_PASSWORD
npm run secrets:set MAIL_SMTP_USER
npm run secrets:set MAIL_SMTP_PASSWORD
npm run secrets:remove LEGACY_KEY
```

若是从旧版 `config.js` 迁移，不要手工复制或输出密码，使用下列命令将其中的数据库、Redis 和 SMTP 凭据写入 vault，成功后自动从 `config.js` 删除。Issuer 私钥和派生根不支持从配置文件迁移，必须使用 `secrets:set` 写入 vault：

```bash
npm run secrets:migrate-config
```

将旧 vault 一次迁移到统一 Issuer 和派生根，并重加密已有的 TOTP 与 Webhook 密文：

```bash
npm run secrets:migrate
```

该命令会先创建带时间戳的 vault 备份；JWT、TOTP 密文和 Webhook 密文会按新派生根重新处理，用户可能需要重新登录。生产执行前仍应完成数据库备份并停止服务。

启动前执行安全检查。该命令只显示密钥名和校验结果，绝不显示密钥值：

```bash
npm run secrets:verify
npm run secrets:unlock
```

`secrets:verify` 会按当前 `config.js` 检查数据库、统一 Issuer 和派生根，以及已启用功能所需的外部凭据。`secrets:unlock` 仅用于确认 vault 可解密并列出键名。不要使用重定向、截图或日志记录这些命令的交互过程。

清理旧密钥前先备份 `secrets.enc.json`，确认新版本已使用 `ISSUER_PRIVATE_KEY` 和 `NODE_KEY_DERIVATION_SECRET` 正常运行，再逐项执行 `npm run secrets:remove KEY`。命令会要求再次输入键名确认，并且不会显示密钥值。不要删除仍用于历史数据解密或历史凭证验证的密钥，除非已经完成数据迁移或确认全部过期。

新配置下，JWT、TOTP 存储和 Webhook 加密密钥都从 `NODE_KEY_DERIVATION_SECRET` 按用途派生。`ISSUER_PRIVATE_KEY` 的公钥自动生成 Issuer `kid`，Issuer DID 从 `issuer.baseUrl` 派生。

生产更新顺序：备份现有 `secrets.enc.json` 到受保护的主机级备份系统，停止服务或在维护窗口中执行 `secrets:set` / `secrets:remove`，执行 `secrets:verify`，然后通过 `bash scripts/starter.sh restart` 重启。不得重新执行 `secrets:init --force` 覆盖生产 vault。

### 3. 启动前端

另开一个终端：

```bash
cd web
npm install
npm run dev -- --port 8991
```

前端默认代理到 `http://localhost:8100`。只有需要覆盖 Vite 的公开构建参数时，才在 `web/.env` 设置：

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
- [配置模板](./config.js.template)
- [节点架构 V1](./docs/节点架构V1.md) 与 [节点架构 V2](./docs/节点架构V2.md)
- [Node 使用指南](./docs/Node使用指南.md)
- [OpenAPI 3.1](./docs/openapi/node.openapi.yaml)

## 生产发布

生产部署不要直接执行开发模式。使用发布包、`scripts/starter.sh`、加密密钥文件和反向代理；完整步骤、Nginx 配置、升级与回滚说明见[生产环境部署手册](./docs/生产环境部署手册.md)。
