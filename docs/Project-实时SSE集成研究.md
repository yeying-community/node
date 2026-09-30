# Project 与 Node Pusher 实时（SSE）集成研究

> 本文是线 ①（实时 SSE，Project 需要）的调研与集成方案文档，**不含代码改动**。
> 与之并行的线 ②（多渠道通知公共组件：email / 钉钉 / 飞书）已实现，见 [`通知中心.md`](./通知中心.md)。
> 背景设计与接入示例见 [`Node-Pusher设计.md`](./Node-Pusher设计.md)、[`Node-Pusher接入示例.md`](./Node-Pusher接入示例.md)，本文聚焦「Project 视角下要不要接、怎么接、边界在哪」。

## 1. 结论先行

- **Node Pusher 不替换 Project 现有的 Swoole/LaravelS WebSocket + PushTask 在线实时链路。** 页面内的任务/看板/文件/讨论实时同步（`projectTask` / `projectColumn` / `project` / `dialog`）继续走 Project 自己的 WebSocket。
- **Node Pusher 是社区级控制面的「标准实时出口」**：Project 服务端把**跨应用、可回放、需统一通知**的事件用签名 HTTP 发布到 Node；Node 以 Postgres 为事实源持久化，经 Redis Pub/Sub 跨实例 fanout，通过 **SSE** 分发给按权限授权的订阅方，并桥接到通知中心 / Webhook / 邮件 / 钉钉 / 飞书。
- **身份与 ACL 映射刻意留在 Node core 之外**：Project 在自己业务层判断成员关系，把授权结果转成通用 DID / account，写入 Node 的 `pusher_channel_acls`；`identity_account_links` 在订阅时把钱包地址登录与 DID 归一到同一别名集合。

一句话：Project 内部实时「继续用 WebSocket」，跨应用/可回放/统一通知「才需要 Node Pusher SSE」。

## 2. 判定标准：什么时候才需要接 Node Pusher

| 场景 | 走哪条链路 |
| --- | --- |
| Project 自己网页内的在线实时同步（任务变更、看板刷新、文件变更、讨论消息） | **继续 Project WebSocket（PushTask）**，Node 非必需 |
| 外部系统 / 个人端应用 / Node 通知中心需要订阅 Project 事件 | **接 Node Pusher**：Project 服务端 publish，订阅方 SSE 订阅 |
| 需要事件持久化、断线回放（`Last-Event-ID` / `cursor`） | **Node Pusher**（SSE 内建 backlog 回放） |
| 需要一条事件同时落到站内信 / 邮件 / Webhook / 钉钉 / 飞书 | **Node Pusher → 通知中心**（线 ② 能力） |

推荐首批发布的事件（低频、幂等、跨应用有价值），不要把所有高频字段变更都双发：
`project.task.assigned`、`project.task.due_changed`、`project.mention.created`、`project.file.shared`。

## 3. Node Pusher 现状（代码锚点）

- 路由：`src/routes/public/pusher.ts`（公共，`src/server.ts:456` 注册）、admin（`:461`）。
- 服务：`src/domain/service/pusher.ts`（`PusherService`：DB + 签名 + ACL）。
- 事件总线 / fanout：`src/domain/service/pusherEvents.ts`（本地监听 + Redis Pub/Sub，`src/server.ts:413` `initPusherEventBus()`）。
- 实体：`PusherAppDO`（`entity.ts:783`）、`PusherEventDO`（`:824`）、`PusherChannelAclDO`（`:862`）、`IdentityAccountLinkDO`（`:89`）。

### 3.1 HTTP 接口

- **发布**：`POST /api/v1/public/pusher/apps/:appId/events`（`pusher.ts:57`）
  - 请求头：`x-pusher-key`、`x-pusher-timestamp`、`x-pusher-signature`。
- **订阅 / SSE 流**：`GET /api/v1/public/pusher/apps/:appId/stream?channels=a,b`（`pusher.ts:73`）
- 偏好：`GET/PATCH /api/v1/public/pusher/notification-preferences`（`:147` / `:163`）
- Admin（EVM 钱包签名动作）：`apps`、`channel/acls`、`email/templates`（`pusher.ts:190+`）

### 3.2 SSE 流格式（`pusher.ts:91-134`）

- 响应头：`Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`，`flushHeaders()`。
- 事件帧：`id: <id>\n` + `event: <type>\n` + `data: <JSON>\n\n`。
- 连接建立先发 `ready` 事件 `{appId, channels, timestamp}`。
- **断线回放**：cursor 来自 `Last-Event-ID` 头或 `cursor` 查询参数；存在则 `service.listBacklog({appId, channels, cursor, limit:200})` 先补发历史再接实时。
- **心跳**：每 15s 发注释 ping `: ping <ts>\n\n`。
- 事件 id = `encodeURIComponent(createdAt)|encodeURIComponent(uid)`（`service/pusher.ts:278`）。

## 4. 认证与签名（Project 发布方必须实现）

发布签名（`service/pusher.ts:201-208`，与 `Node-Pusher接入示例.md:147-170` 一致）：

1. `payload = ${timestamp}.${canonicalJson(body)}`，其中 `canonicalJson` **递归按键名排序**（`:187-199`）。
2. `signature = "sha256=" + HMAC_SHA256(secret, payload)`（hex）。
3. 请求头带 `x-pusher-key = app.key`、`x-pusher-timestamp`、`x-pusher-signature`。

服务端校验（`publish`，`service/pusher.ts:666+`）：

- app 必须 `status==='active'`；`x-pusher-key` 必须等于 `app.key`。
- 时间戳偏差 ≤ 5 分钟（`DEFAULT_SIGNATURE_SKEW_MS`，`:14`）。
- payload ≤ 64 KiB（`DEFAULT_MAX_PAYLOAD_BYTES`，`:15`）；单次 ≤ 20 channel（`:699`）。
- 签名用 `timingSafeEqualString` 定长比较（`:687`）。
- **app secret 加密存库**：`ps_<base64url(32B)>` 生成后以 AES-256-GCM 存 `secret_ciphertext`，主密钥派生自 `getDerivedRuntimeSecret('pusher-app')`（依赖 `secrets.enc.json` 里的 `NODE_KEY_DERIVATION_SECRET`），校验时解密。

> 关键陷阱：**签名前后的 body 结构必须一致**。Project 侧序列化要和 `canonicalJson` 语义对齐（键排序、无多余空白），否则签名不匹配。

> Project 作为「机器调用」用**服务密钥**签名发布，不弹个人钱包（`docs/权限与签名.md:58`）。一期原生 HTTP publish 不依赖 Laravel `BROADCAST_DRIVER=pusher`，Project 可保持 `BROADCAST_DRIVER=log`（`Node-Pusher接入示例.md:114`）。

## 5. 频道与身份映射（订阅授权）

### 5.1 频道命名与校验

- app 默认 channel 模式：`['public-*', 'private-user.*']`（`service/pusher.ts:456`）。发布与订阅都按 app 的 `channelPatterns`（glob→regex）校验。
- 约定：`private-user.<account-or-did>`（仅本人）、`private-*`（ACL 授权）、`public-*`（公开）。

### 5.2 订阅授权（`assertCanSubscribe`，`service/pusher.ts:860-891`）

- 需已认证用户，subject = 小写 `getRequestUser().address`，且 `ensureUserActive`。
- Origin 校验（若 app 配了 `allowedOrigins`）。
- channel 必须匹配 app 模式；再按类别：
  - `private-user.<alias>`：仅当等于 subject 别名之一。
  - 其它 `private-*`：需存在匹配的 `pusher_channel_acls` 行。
  - 公开频道：模式匹配即可。

### 5.3 身份归一（`resolveSubjectAliases`，`service/pusher.ts:812-843`）

- subject 是 `did:yeying:...` → 查 `IdentityAccountLinkDO`（`identityDid=subject, status='active', revokedAt=''`）加入其 `accountId`；反之钱包地址 → 找到其 `identityDid` 加入。
- `canSubscribeByChannelAcl`：取 app 的活跃 ACL，保留 `subject ∈ 别名集合`、channel glob 命中、未过期的行。

### 5.4 `project_identity_mappings` 已废弃（已确认）

迁移 `src/migrations/20260909130000-add-pusher-channel-acls.ts`：

- 新建 `pusher_channel_acls`（`uid, app_id, channel, subject, subject_type, metadata_json, status, created_at, updated_at, expires_at`，唯一键 `(app_id, channel, subject)`）。
- **DROP TABLE `project_identity_mappings`** 及其索引（`:46-49`），Postgres-only。

**替代方案**：`pusher_channel_acls`（显式 per-(app, channel, subject) 授权）+ `identity_account_links`（DID ↔ account 归一）。代码中已无 `project_identity_mappings` 实体，仅作为 DROP 目标出现。

> 集成要点（`Node-Pusher接入示例.md:120`）：**Node core 不维护 Project user id 等应用专用映射**。Project 在业务层判断成员关系，把授权结果转成通用 DID / account，通过 `POST /api/v1/admin/pusher/channel/acls`（`subjectType: "identity"`, `subject: "did:yeying:..."`）写入 ACL。

## 6. 多实例 fanout 与事实源（`pusherEvents.ts`）

- **事实源 = Postgres**：`publish()` 先持久化 `PusherEventDO`（`service/pusher.ts:739-751`）再 `publishPusherEvent`。回放 `listBacklog`（`:779-810`）读 DB，不读 Redis。
- **本地投递**：`listenersByChannel: Map<channel, Set<Listener>>`，`deliverLocal` 去重后触发各 channel 的 SSE 监听。
- **Redis Pub/Sub**：`ensureRedisPubSub` 建独立 `pub`/`sub` 客户端，订阅 `redis.pusherChannel`（默认 `'pusher_events'`）。发布消息带 `origin: instanceId`；接收端丢弃 `origin === 自身 instanceId` 的回环。Redis 不可用时退化为本地投递。

## 7. 配置

- **无独立顶层 `pusher` 配置块**：per-app 的 key/secret/origins/channel 模式都在 DB（`pusher_apps`）。
- app secret 加密依赖 `secrets.enc.json` 的 `NODE_KEY_DERIVATION_SECRET`。
- `config.js.template` 的 `redis` 块（`:238-263`）：`pusherChannel: 'pusher_events'`、`enabled`、`host/port/db/keyPrefix`、`instanceId`；Redis 凭据从 `secrets.enc.json` 取 `REDIS_USERNAME` / `REDIS_PASSWORD`。
- `ProjectAdapterRuntimeConfig`（`src/config/index.ts:170`）是 Node→Project 适配器（`defaultInstanceId`、`requestTimeoutMs`），**与 pusher 发布路径无关**，勿混淆。

## 8. Project 集成落地建议（分步，无 Node 代码改动）

1. **注册 app**：管理员通过 admin 接口创建 Project 对应的 `pusher_apps`（拿到 `app_id` / `key` / 一次性 `secret`）。
2. **服务端发布器**：Project 服务端实现 canonical-JSON 签名的 HTTP publish（服务密钥），先接首批低频事件（§2）。
3. **写 ACL**：Project 业务层把成员授权转为 DID/account，`POST /admin/pusher/channel/acls` 写入 `private-*` 频道授权。
4. **订阅端**：外部/个人端应用用 SSE 订阅 `GET /pusher/apps/:appId/stream?channels=...`，实现 `Last-Event-ID` 断线续传。
5. **可选桥接**：需要落站内信/邮件/钉钉/飞书时，发布事件携带 `notification`，复用通知中心（线 ②）多渠道出口。
6. **保持并存**：Project 现有 Swoole WebSocket + PushTask 不动，仅新增「向 Node 发布跨应用事件」。

## 9. 已知边界（一期）

- SSE 单向、不兼容 Laravel Echo / pusher-js、无 presence 频道（`Node-Pusher设计.md:427+`）。需要这些时才考虑 Pusher 兼容 WebSocket 出口（`:462+`）。
- 同实例回环由 `origin` 过滤，跨实例实时依赖 Redis；Redis 关闭时仅本实例实时可用，历史仍可由 DB 回放。
