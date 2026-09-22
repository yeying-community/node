# UCAN签发模式（长期维护）

本文档用于沉淀 Node 服务的 **UCAN 签发模式**（服务端 Issuer 模式）设计、实现进度与运维规范。  
目标是让 Node 在保留“UCAN 校验模式”的同时，提供“中心化签发 UCAN”能力，用于移动端无钱包插件场景。


## 1. 文档目标
- 明确 UCAN 双模式边界：校验模式 vs 签发模式。
- 统一签发接口、配置项、校验逻辑与安全基线。
- 记录实现里程碑、回滚策略、已知风险，作为长期维护入口。

## 2. 当前状态（截至 2026-09-21）
- 已实现：
  - SIWE/JWT 登录接口：`/api/v1/public/auth/challenge|verify|refresh|logout`
  - UCAN 校验模式：`Authorization: Bearer <UCAN>`，服务端验证 `aud/cap/proof`
  - 中心化签发接口：`/api/v1/public/auth/central/issuer|session|issue|revoke`
  - 中心化 UCAN 校验分支：支持 Node 统一 Issuer 信任 + `mode` 分支（`verify|issue|hybrid`）
  - 第三方应用多后端签发：`authorize/exchange` 后可通过 `central/session|issue` 按后端动态签发 UCAN
  - Issuer key ring：`active/next/previous` 三个角色，JWKS 发布 `kid`，验证窗口信任旧 key
  - session、UCAN `jti` 的数据库持久化，以及 session/scoped grant 撤销到 UCAN 黑名单的联动
  - UCAN 签发与撤销审计日志（仅保存 subject、issuer、audience、capabilities、token id、session hash 等元数据）
- 未实现（后续阶段）：
  - 外部 KMS/HSM 托管接入
  - 面向下游独立资源服务的统一 token introspection/revocation API

## 3. 双模式定义

### 3.1 校验模式（默认）
- Token 由前端/钱包侧生成。
- 服务端仅做 UCAN 验证（proof chain + capability + audience）。
- 适合浏览器插件钱包、可注入 EIP-1193 的场景。

### 3.2 签发模式（中心化 Issuer）
- Token 由 Node 直接签发。
- 前端通过中心化会话换取 UCAN，再访问业务接口。
- 适合移动端无插件、无法稳定使用钱包 UCAN 能力的场景。

## 4. 接口定义（签发模式）

接口前缀：`/api/v1/public/auth/central`

- `GET /issuer`
  - 返回 Issuer DID、默认 audience/capabilities、模式与就绪状态
- `POST /session`
  - Header：`Authorization: Bearer <JWT access token>`
  - 输入：`subject`（必须与 JWT 地址一致）、`sessionTtlMs`（可选）
  - 输出：`sessionToken`（短期）、`allowedAudiences`、`allowedCapabilitiesByAudience`
- `POST /issue`
  - Header：`Authorization: Bearer <sessionToken>`
  - 输入：`audience`、`capabilities`、`expiresInMs`（或 `ttlMs`）
  - 输出：`ucan`；`audience` 必须属于 session 允许集合，`capabilities` 必须是对应策略的子集
- `POST /revoke`
  - Header：`Authorization: Bearer <sessionToken>`
  - 输出：`revoked`

`/issue` 的 token 有效期不能超过 session 剩余有效期。未传 `expiresInMs` 时服务端自动取 token TTL、session 剩余 TTL 和服务端上限的最小值；显式请求超过 session 剩余时间会返回 403。

### 4.0.1 多后端签发推荐顺序
用于需要访问多个后端（不同 `audience`）的第三方应用：
2. `POST /api/v1/public/auth/central/session`（Bearer JWT）获取 `sessionToken`。服务端配置的 `allowedAudiences` 和 `allowedCapabilitiesByAudience` 必须覆盖这些目标后端。
3. 按目标后端循环调用 `POST /api/v1/public/auth/central/issue`，分别签发不超过 session 策略的 UCAN。
4. 客户端按 `audience + capabilities` 缓存 UCAN，过期后重新签发。

## 4.1 接口定义（手机桥接签发）


- `GET /status`
  - 返回 totp auth 是否启用、是否就绪、TOTP 参数与错误状态
- `GET /totp/provision`
  - Header：`Authorization: Bearer <JWT access token | UCAN token>`
  - 输出：`otpauthUri`、`secret`、`issuer`、`period`、`digits`
- `POST /bind/request`
  - Header：`Authorization: Bearer <JWT access token | UCAN token>`
  - 输入：`audience`、`capabilities`、`requestTtlMs`、`appName`（可选）
  - 输出：`requestId`、`verifyUrl`（手机跳转地址）
- `GET /bind/request/:requestId`
  - 输出：绑定请求状态（`pending|used|expired|revoked`）与摘要
- `POST /bind/approve`
  - 输入：`requestId`、`code`（认证器验证码）
  - 输出：`JWT access token` + `sessionToken` + `UCAN`



- `POST /request`
  - 输入：`address`、`appId`、`redirectUri`、`state`（可选）
  - 建议：`appId` 直接使用应用市场 `AppId`（`applications.uid`）
  - 输出：`requestId`、`verifyUrl`
- `GET /request/:requestId`
  - 输出：授权请求状态与摘要
- `POST /approve`
  - 输入：`requestId`、`code`
  - 输出：`authorizationCode` + `redirectTo`
- `POST /exchange`
  - 输入：`code`、`appId`、`redirectUri`
  - 输出：`JWT access token` + `UCAN`

前端承载页（Node Web）：
- `GET /market/my-config`（钱包登录后管理页，支持加载 TOTP 配置与二维码、配置/调试 totp authorize）
- 页面行为：查询请求、输入 TOTP、调用 `authorize/approve` 后自动按 `redirectTo` 回跳。

## 5. 配置项

`config.js` / 环境变量：

- `issuer.ucan.enabled` / `UCAN_ISSUER_ENABLED`
- `issuer.ucan.mode` / `UCAN_ISSUER_MODE`
  - `verify`（仅校验，默认）
  - `issue`（仅签发路径与中心化校验）
  - `hybrid`（钱包校验 + 中心化签发/校验）
- `issuer.baseUrl`（用于派生统一 Node Issuer DID）
- `ISSUER_PRIVATE_KEY`（统一 Node Issuer 私钥，从 `secrets.enc.json` 读取）
- `ISSUER_PRIVATE_KEY_NEXT`（可选；轮换期间发布并信任，不用于当前签发）
- `ISSUER_PRIVATE_KEY_PREVIOUS`（可选；轮换期间验证旧 JWT/UCAN）
- `NODE_KEY_DERIVATION_SECRET`（从 `secrets.enc.json` 读取，用于派生业务密钥）
- `issuer.ucan.sessionTtlMs` / `UCAN_ISSUER_SESSION_TTL_MS`
- `issuer.ucan.tokenTtlMs` / `UCAN_ISSUER_TOKEN_TTL_MS`
- `issuer.ucan.defaultAudience` / `UCAN_ISSUER_DEFAULT_AUDIENCE`
- `issuer.ucan.defaultCapabilities` / `UCAN_ISSUER_DEFAULT_CAPABILITIES`
- `issuer.ucan.allowedAudiences`
- `issuer.ucan.allowedCapabilitiesByAudience`
- 应用发布字段：`redirectUris`
  - `appId` 必须为应用市场 `AppId`（`applications.uid`），`redirectUri` 必须精确命中该字段中的一项；可同时登记 Web、浏览器扩展和桌面自定义协议回调

说明：
- `mode=issue|hybrid` 时，必须配置 `ISSUER_PRIVATE_KEY`；Issuer DID 从 `issuer.baseUrl` 派生。
- 中心化 issue session 创建时会固化允许的 audience 和 capability；未显式配置时，使用 `defaultAudience + defaultCapabilities` 作为全局上限。
- 身份授权应用如果登记了 `ucanAudience/ucanCapabilities`，其 session 策略必须是全局上限的子集；`/central/issue` 不能请求其它 audience、扩大资源范围或扩大动作。
- UCAN token 的有效期不能超过 issue session 剩余有效期；session 过期前不足一个最小 token TTL 时停止签发。
- 显式配置 `allowedAudiences` 或 `allowedCapabilitiesByAudience` 时，必须为每个允许的 audience 提供 capability；配置不完整会让中心化 issuer 保持 `ready=false`，不会回退到默认权限。
- Router 等消费中心化 UCAN 的下游服务必须把 Node 当前 issuer DID 配为 trusted issuer。
- `ISSUER_PRIVATE_KEY_NEXT/PREVIOUS` 不属于必填密钥；`scripts/verify-secrets.cjs` 只要求 active key。

### 5.1 Issuer 密钥轮换顺序

Issuer 轮换必须按以下顺序进行，所有 Node 实例使用同一组 active/next/previous 密钥：

1. 生成新的 Ed25519 seed，写入 `ISSUER_PRIVATE_KEY_NEXT`，部署并确认 `/api/v1/public/auth/central/issuer` 的 `issuerKeys` 同时包含 `active` 与 `next`。
2. 在维护窗口内将旧 `ISSUER_PRIVATE_KEY` 写入 `ISSUER_PRIVATE_KEY_PREVIOUS`，将新的 next seed 提升为 `ISSUER_PRIVATE_KEY`，然后滚动重启所有实例。
3. 部署后确认新的 active `kid` 用于新签发，旧 active 的 `kid` 仍在 JWKS 和本地 verifier 的信任窗口中。
4. 至少保留 `previous` 到最大 UCAN/JWT 有效期、时钟偏差和下游 JWKS 缓存刷新时间之和之后，再删除 `ISSUER_PRIVATE_KEY_PREVIOUS`。
5. 下一轮轮换前清理过期的 `NEXT` 值，避免同一公钥被误识别为多个角色。

`next` 不会被当前 Node 用来签发；它的作用是让下游先拿到公钥并完成配置。删除 `previous` 前必须确认旧 token 已过期，不能只依据应用重启时间判断。

## 6. 服务端验证逻辑（第三方无感）

`src/auth/ucan.ts` 的 UCAN 校验入口保持统一，业务接口无须区分钱包签发或中心化签发：
- `aud` 必须匹配 `UCAN_AUD`
- capability 必须满足 required `with/can`
- `exp` 必须存在且有效，`nbf`（如果存在）必须满足时间窗
- 钱包模式要求 `prf` 证明链可验证

补充说明：
- Node 作为 Issuer 新增签发接口是为了“签发模式”能力，不改变业务服务的 UCAN 校验入口。
- 第三方服务在验 token 时无须新增分支：仍按统一 UCAN 规则校验 `aud/cap/exp/nbf/signature` 即可。
- Node 自身验证中心化 UCAN 时要求 token 带 `jti` 并读取撤销表；session revoke 会撤销该 session 已签发的所有 UCAN，scoped grant 的 token/grant revoke 也会写入同一黑名单。
- 签发记录保存 token hash 和 UCAN 元数据，不保存明文 UCAN；审计记录同样不保存 bearer token。

模式分派：
- 钱包模式：`Root(SIWE) -> Delegation -> Invocation`
- 中心化模式：信任 Node 统一 Issuer DID，校验 `aud/cap/exp/nbf/sub`

## 7. 安全与风控基线

- Issuer 私钥不得写入仓库，必须通过环境注入或 KMS 托管。
- 必须使用 key ring 完成 active/next/previous 轮换，不能直接覆盖 active 私钥。
- `sessionToken` 与 `ucan` 都采用短期有效策略。
- 所有签发行为写审计日志：谁、何时、签发给谁、能力范围、过期时间。
- session/token revoke 必须同时更新持久化撤销记录，不能只删除进程内缓存。
- 能力最小化：默认只签发业务必需 `with/can`。
- 所有 `auth/central/*` 接口需要限流与异常告警。

## 8. 观测与排障

建议日志字段：
- `authMode`: `wallet_ucan` | `central_ucan` | `jwt`
- `issuerDid`
- `subject`
- `aud`
- `cap`
- `sessionId/requestId`
- `tokenId/jti`
- `sessionHash`（只记录 SHA-256，不记录 session 明文）

建议指标：
- 中心化签发成功率、失败率
- session 创建成功率
- token 验证失败分类（aud 不匹配、cap 拒绝、过期、签名失败）

## 9. 实施里程碑

### 阶段 1（已完成）
- 增加 `auth/central/issuer|session|issue|revoke` 路由
- 增加基础配置项与启动校验
- 支持中心化 token 的服务端校验分支

### 阶段 2（已完成）
- 完善中心化签发错误路径与验证分支
- 完成 active/next/previous key ring、持久化 session/token、jti 黑名单和审计记录
- 完成 session/scoped grant 撤销与 verifier 的联动

### 阶段 3（进行中）
- 外部 KMS/HSM 托管接入
- 面向独立下游资源服务的 introspection/revocation API
- 审计报表、导出和安全告警

## 10. 与其它文档关系
- 登录总文档：`登录授权.md`
- 权限/签名：`权限与签名.md`
- 接口总览：`接口说明.md`
- 运行配置：根目录 `config.js.template`

## 11. 维护约定（长期）
- 涉及以下任一变更，必须先更新本文档再发布：
  - 签发接口变更（路径、请求、响应）
  - Issuer 信任模型变更
  - session/ucan 有效期策略变更
  - 密钥管理策略变更
- 文档更新必须包含：
  - 日期
  - 变更原因
  - 对客户端（尤其移动端）影响

## 12. 变更记录

| 日期 | 变更摘要 | 说明 |
| --- | --- | --- |
| 2026-04-17 | 首版创建 | 建立 Node UCAN 签发模式长期维护文档 |
| 2026-04-17 | 明确中心化接口 | 采用 `/api/v1/public/auth/central/*` 路由并保持业务验 token 无感 |
| 2026-04-21 | 引入 `AppId` 客户端识别 | 支持 `appId=applications.uid` 动态解析回跳白名单，降低 Chat 集成配置复杂度 |
| 2026-04-24 | 补充多后端签发实践 | 明确 `authorize/exchange` 后通过 `central/session|issue` 按后端动态签发 UCAN，并强调服务端验证无感 |
| 2026-09-21 | 完成 key ring、撤销闭环与审计 | active/next/previous、session/token 持久化、jti 黑名单、scoped grant 撤销联动和元数据审计落库 |
