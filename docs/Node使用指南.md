# YeYing Node 使用指南

YeYing Node 是社区产品体系中的协调枢纽。它不只是一个应用市场后端，还统一承担身份授权、能力令牌校验、应用发布审核、MPC 消息协调、钱包密钥托管、通知分发和 release artifact 管理。

## 1. 能力地图

| 能力 | 主要职责 | API 前缀 |
| --- | --- | --- |
| 身份与授权 | SIWE 登录、JWT 会话、钱包身份凭证、钱包身份授权码、钱包 UCAN、中心化 UCAN、TOTP、Passkey | `/api/v1/public/auth`、`/api/v1/public/identity` |
| 应用中心 | 应用元数据、用户配置、搜索、发布和下架 | `/api/v1/public/applications` |
| 审核治理 | 申请、审批、驳回、撤销和管理员用户治理 | `/api/v1/public/audits`、`/api/v1/admin` |
| MPC 协调 | 会话、参与者、消息中继、SSE 和 Redis Streams 续传 | `/api/v1/public/mpc` |
| 钱包托管 | Passkey 门禁、客户端加密快照保存和删除 | `/api/v1/public/custody` |
| 通知中心 | 收件箱、未读状态、SSE、Webhook 和投递重试 | `/api/v1/public/notifications` |
| AppStore / Registry | 发布包校验、审核、发布目录和 release artifact | `/api/v1/publisher`、`/api/v1/admin/releases` |
| Agent Runtime | Project 安装、升级、失败回滚、卸载和健康检查 | 由 `agent` 仓库提供，不在 Node 暴露 |

Node 不保存钱包明文密钥。托管接口只接受客户端加密后的 `ciphertext`。WebDAV 文件存储也由客户端直连，不通过 Node 转发。

## 2. 环境要求

- Node.js 22 或更高版本；生产环境建议固定 LTS 版本。
- PostgreSQL 作为推荐数据库。PostgreSQL 使用 migration；MySQL 依赖 TypeORM synchronize，功能覆盖需要自行验证。
- Redis 为可选组件。多实例 MPC、SSE 续传和事件重放建议启用 Redis Streams。
- Passkey 生产环境必须使用 HTTPS，并保证 `identity.webauthn.rpId` 与访问域名一致。Passkey 在新钱包身份流程中只是认证器，不是外部身份主键。

## 3. 本地启动

```bash
cp config.js.template config.js
npm ci
npm run secrets:init
npm run dev:secure
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
issuer: {
  ucan: {
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

### 钱包身份与 Passkey

Node 的新身份契约不再创建或返回 `subjectId`。正式外部主键是 `did:yeying:wid_*`；钱包地址是已验证账户关联，邮箱和用户名是 Node 签发的 JWT-VC。

配置使用 `identity.webauthn` 的 RP 参数：

```js
identity: {
  publicBaseUrl: 'https://node.example.com',
  webauthn: {
    enabled: true,
    rpId: 'node.example.com',
    rpName: 'YeYing Node',
    origin: 'https://node.example.com',
    timeoutMs: 60 * 1000,
    challengeTtlMs: 2 * 60 * 1000
  }
}
```

`rpId` 只能是当前域名或其可注册父域。`origin` 是 Node 自己承载钱包身份授权页的浏览器来源，必须包含协议且与实际来源完全一致，例如生产环境 `https://node.example.com` 或本地 `http://localhost:8100`。

Wallet 插件设置页注册身份 Passkey 时，WebAuthn 响应 origin 是 `chrome-extension://<wallet-extension-id>`。这个 origin 不写入 Node 运行时配置；应把钱包插件作为应用发布到 Node 应用中心，并把插件 origin 加入该应用的 `redirectUris`。Node 在确认 Passkey 注册时只接受两类来源：`identity.webauthn.origin` 表示的 Node 授权页，以及已发布应用 `redirectUris` 解析出的来源。

Node 自身的应用中心登录是钱包签名 / UCAN 自举登录，不依赖在应用中心先发布一个 Node 应用；`identity.webauthn` 只负责钱包身份 WebAuthn 认证器注册和无插件授权页。Router 等外部 Web3 应用才需要在 Node 应用中心发布应用并配置 `redirectUris`。

钱包身份相关公共接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/v1/public/identity/account-links/challenge` | 创建钱包身份与链账户关联 challenge |
| POST | `/api/v1/public/identity/account-links/verify` | 校验身份控制器签名和账户签名，保存账户关联 |
| POST | `/api/v1/public/identity/verifications/request` | 请求邮箱/用户名/头像验证事务 |
| POST | `/api/v1/public/identity/verifications/confirm` | 确认验证码并签发 `EmailCredential` / `UsernameCredential` / `AvatarCredential` |
| POST | `/api/v1/public/identity/credentials/reissue/challenge` | 为已验证邮箱/用户名/头像凭证创建自动续签 challenge |
| POST | `/api/v1/public/identity/credentials/reissue/confirm` | 校验 identity controller proof 并重签短期 JWT-VC |
| POST | `/api/v1/public/identity/passkeys/register/request` | 使用签名身份文档创建身份级 Passkey 注册请求 |
| POST | `/api/v1/public/identity/passkeys/register/confirm` | 确认 WebAuthn registration 并保存到该钱包身份 |
| GET | `/api/v1/public/identity/totp/status` | 查询钱包身份 TOTP 服务状态 |
| POST | `/api/v1/public/identity/totp/get` | 查询钱包身份 TOTP 认证器状态 |
| POST | `/api/v1/public/identity/totp/setup` | 使用签名身份文档创建 TOTP secret |
| POST | `/api/v1/public/identity/totp/confirm` | 使用验证码确认并启用 TOTP |
| POST | `/api/v1/public/identity/totp/verify` | 校验已启用 TOTP 验证码 |
| POST | `/api/v1/public/identity/totp/revoke` | 使用签名身份文档撤销 TOTP |
| POST | `/api/v1/public/identity/authorize/request` | 为 Web3 应用创建授权码请求，返回 `verifyUrl` |
| GET | `/api/v1/public/identity/authorize/request/:requestId` | 查询授权请求 |
| POST | `/api/v1/public/identity/authorize/challenge` | 创建无钱包登录 Passkey challenge |
| POST | `/api/v1/public/identity/authorize/approve` | 用 Passkey assertion 或 Wallet presentation 批准授权 |
| POST | `/api/v1/public/identity/authorize/exchange` | 应用后端用 PKCE verifier 换取 DID、钱包地址和凭证 |

`/identity/authorize?requestId=...` 是 Node 内置的轻量授权页，供 Router 等 Web3 应用展示二维码或跳转。授权页只使用 Passkey 证明钱包身份控制关系；exchange 结果不包含 Passport assertion 或 `subjectId`。


旧 Passport subject 接口已移除。新 Router / web3-bs 集成只使用 `/api/v1/public/identity/*`。

### 生产密钥

不要把 JWT、UCAN issuer、TOTP 或 Webhook 主密钥直接提交到 `config.js`。推荐使用加密密钥文件：

```bash
npm run secrets:init
bash scripts/starter.sh restart
```

自动化部署可使用受权限保护的密码文件：

```bash
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

## 11. Agent Runtime 边界

Project 安装、升级、失败回滚、卸载和健康检查已经迁移到 `agent` 仓库。Node 不再注册 `/api/v1/internal/*` 安装接口，也不再注册 `/api/v1/runtime/*` 任务接口。

Node 在这条链路中的职责是 Registry：接收发布者提交的 release bundle，校验签名、digest、Compose 策略和发布者身份，审核后提供已发布 release artifact。Agent Runtime 根据 Project 请求查询 Node Registry，再在部署机执行受控运行时流程。

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
- Passkey、钱包身份 TOTP、UCAN issuer 状态接口是否符合预期；钱包身份 TOTP 随身份服务启用，必须 `ready=true`；
- Node 日志是否出现 `audience mismatch`、`capability denied` 或数据库连接错误；
- Redis Streams 长度、消费者延迟和 SSE 重连率；
- Webhook 失败数、重试数和最终失败数；
- Agent Runtime 与 Node Registry 的 release 查询、签名校验和下载错误；
- 托管密文数量、Passkey 撤销和异常下载行为。

生产日志不得记录完整 Bearer token、钱包私钥、助记词、托管密文、数据库密码或 Webhook 明文密钥。
