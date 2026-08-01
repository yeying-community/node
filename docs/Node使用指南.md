# YeYing Node 使用指南

YeYing Node 是社区产品体系中的协调枢纽。它不只是一个应用市场后端，还统一承担身份授权、能力令牌校验、应用发布审核、MPC 消息协调、钱包密钥托管、通知分发和部署 Agent 调度。

## 1. 能力地图

| 能力 | 主要职责 | API 前缀 |
| --- | --- | --- |
| 身份与授权 | SIWE 登录、JWT 会话、钱包 UCAN、中心化 UCAN、TOTP、Passkey | `/api/v1/public/auth` |
| 应用中心 | 应用元数据、用户配置、搜索、发布和下架 | `/api/v1/public/applications` |
| 审核治理 | 申请、审批、驳回、撤销和管理员用户治理 | `/api/v1/public/audits`、`/api/v1/admin` |
| MPC 协调 | 会话、参与者、消息中继、SSE 和 Redis Streams 续传 | `/api/v1/public/mpc` |
| 钱包托管 | Passkey 门禁、客户端加密快照保存和删除 | `/api/v1/public/custody` |
| 通知中心 | 收件箱、未读状态、SSE、Webhook 和投递重试 | `/api/v1/public/notifications` |
| AppStore | 发布包校验、审核、安装目录和生命周期任务 | `/api/v1/publisher`、`/api/v1/internal` |
| Runtime Agent | 任务领取、租约、心跳、结果上报和制品获取 | `/api/v1/runtime` |

Node 不保存钱包明文密钥。托管接口只接受客户端加密后的 `ciphertext`。WebDAV 文件存储也由客户端直连，不通过 Node 转发。

## 2. 环境要求

- Node.js 22 或更高版本；生产环境建议固定 LTS 版本。
- PostgreSQL 作为推荐数据库。PostgreSQL 使用 migration；MySQL 依赖 TypeORM synchronize，功能覆盖需要自行验证。
- Redis 为可选组件。多实例 MPC、SSE 续传和事件重放建议启用 Redis Streams。
- Passkey 生产环境必须使用 HTTPS，并保证 `passkeyAuth.rpId` 与访问域名一致。

## 3. 本地启动

```bash
cp config.js.template config.js
npm ci
JWT_SECRET=$(openssl rand -hex 32) npm run dev
```

默认地址：

```text
http://localhost:8100
```

验证服务：

```bash
curl http://localhost:8100/api/v1/public/health
```

前端单独启动：

```bash
npm --prefix web ci
npm --prefix web run dev
```

## 4. 数据库与迁移

PostgreSQL 配置示例：

```js
database: {
  type: 'postgres',
  host: '127.0.0.1',
  port: 5432,
  database: 'node',
  username: 'node_user',
  password: '<password>',
  schema: 'node',
  synchronize: false
}
```

服务启动时会自动执行已注册的 PostgreSQL migration。生产部署前应先备份数据库，并在预发布环境验证 migration 的 `up` 和服务启动流程。

## 5. 生产配置重点

### JWT 与 UCAN

```js
ucan: {
  aud: 'did:web:node.example.com',
  with: 'app:all:node.example.com',
  can: 'invoke'
},
ucanIssuer: {
  enabled: true,
  mode: 'hybrid',
  defaultAudience: 'did:web:node.example.com'
}
```

`aud` 必须与客户端生成 UCAN 时使用的 audience 一致。路由专用 capability 会覆盖全局 capability：

```js
mpc: { ucanWith: 'mpc', ucanCan: 'coordinate' },
custody: { enabled: true, ucanWith: 'custody', ucanCan: 'write' }
```

### Passkey

```js
passkeyAuth: {
  enabled: true,
  rpId: 'node.example.com',
  rpName: 'YeYing Node',
  origin: 'https://node.example.com',
  timeoutMs: 60 * 1000,
  challengeTtlMs: 2 * 60 * 1000
}
```

`rpId` 只能是当前域名或其可注册父域，`origin` 必须包含协议且与浏览器实际来源完全一致。

### 生产密钥

不要把 JWT、UCAN issuer、TOTP 或 Webhook 主密钥直接提交到 `config.js`。推荐使用加密密钥文件：

```bash
npm run secrets:init
SECRETS_FILE=run/secrets.enc.json bash scripts/starter.sh restart
```

自动化部署可使用受权限保护的密码文件：

```bash
SECRETS_PASSWORD_FILE=/secure/node-secrets-password \
SECRETS_FILE=run/secrets.enc.json \
bash scripts/starter.sh restart
```

## 6. 鉴权模型

### SIWE JWT

```text
POST /auth/challenge
→ 钱包签名 challenge
→ POST /auth/verify
→ 获取短期 JWT，刷新令牌写入 HttpOnly Cookie
```

JWT 适合 Node 自身的用户会话和管理页面。

### 钱包 UCAN

钱包 UCAN 通过 SIWE root proof 绑定钱包地址，再由临时 Ed25519 DID 签发 invocation。第三方请求使用：

```http
Authorization: Bearer <ucan>
```

服务端校验：

- token 签名和有效期；
- audience；
- capability；
- proof chain；
- 钱包签名恢复出的地址；
- 用户状态和业务角色。

### 中心化 UCAN

Passkey/TOTP 等无钱包登录可先获得 JWT，再通过 central issuer 获取目标 audience/capability 的 UCAN。下游服务必须信任 Node 当前的 issuer DID。

## 7. 业务写签名与幂等

应用、审核、MPC 等共享业务写入通常还要求：

```json
{
  "requestId": "unique-request-id",
  "timestamp": 1785000000000,
  "signature": "0x..."
}
```

签名消息绑定 `Action + Actor + Timestamp + RequestId + PayloadHash`。`requestId` 会持久化消费：相同请求返回首次结果，内容不一致或仍在处理中返回 `409`。

Bearer 鉴权不能替代业务写签名，两者承担不同职责：Bearer 证明会话/能力，业务签名证明本次写操作的明确授权并提供防重放。

## 8. 第三方接入流程

1. 确定调用身份：钱包 UCAN、JWT、中心化 UCAN 或 Runtime Agent token。
2. 根据目标接口确定 audience 和 capability。
3. 从 [openapi/node.openapi.yaml](./openapi/node.openapi.yaml) 导入 Postman、Insomnia、Swagger UI 或代码生成工具。
4. 对业务写接口实现 canonical payload、签名和稳定 `requestId`。
5. 对 `401` 区分 token 过期、audience 不匹配和 capability denied。
6. 对 `409` 按幂等语义查询或重放，不要无条件生成新请求。
7. SSE 客户端实现断线重连，并保留 `Last-Event-ID` 或 cursor。

生成或校验 OpenAPI：

```bash
npm run openapi:generate
npm run openapi:check
```

## 9. MPC 接入注意事项

- 默认 capability 为 `mpc/coordinate`。
- 创建、加入、发送消息属于业务写操作，需要钱包签名和幂等字段。
- 消息必须提供稳定 `id`。
- 多实例部署应启用 Redis；需要断点续传时启用 Streams。
- `/api/v1/public/mpc/ws` 实际为 SSE，不是 WebSocket。

## 10. 钱包托管注意事项

- 默认 capability 为 `custody/write`。
- 开启托管前，当前 UCAN 对应的钱包地址必须绑定至少一个有效 Passkey。
- Node 只保存客户端密文；密钥提取、加密和恢复校验必须在钱包客户端执行。
- 修改钱包密码、增加账户或删除账户后，客户端应重新上传快照。
- 当前接口允许读取密文，第三方恢复客户端必须额外做好短期授权、错误密码处理和原子导入。

## 11. Runtime Agent

Agent 使用独立 Bearer token，不使用用户 JWT/UCAN。`config.js` 只保存 token 的 SHA-256：

```js
appStoreAgent: {
  instances: {
    'project-instance-id': {
      tokenSha256: '<64 lowercase hex>',
      leaseSeconds: 300
    }
  }
}
```

Agent 应循环执行：领取任务、执行、心跳续租、上报结果；无法继续执行时主动 release。任务 revision 用于防止旧 Agent 覆盖新租约。

## 12. 构建、测试和发布

```bash
npm test
npm run build
npm run build:web
npm run check:api-prefixes
npm run openapi:check
```

生产构建与启动：

```bash
npm run build:all
bash scripts/starter.sh restart
```

发布包：

```bash
npm run package:release -- v1.0.0
```

## 13. 运维检查

- `/api/v1/public/health` 是否返回成功；
- 数据库 migration 是否完成；
- Passkey/TOTP/UCAN issuer 状态接口是否 `enabled` 且 `ready`；
- Node 日志是否出现 `audience mismatch`、`capability denied` 或数据库连接错误；
- Redis Streams 长度、消费者延迟和 SSE 重连率；
- Webhook 失败数、重试数和最终失败数；
- Runtime Agent 租约冲突和长期未完成任务；
- 托管密文数量、Passkey 撤销和异常下载行为。

生产日志不得记录完整 Bearer token、钱包私钥、助记词、托管密文、数据库密码或 Webhook 明文密钥。
