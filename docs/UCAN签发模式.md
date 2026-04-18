# UCAN签发模式（长期维护）

本文档用于沉淀 Node 服务的 **UCAN 签发模式**（服务端 Issuer 模式）设计、实现进度与运维规范。  
目标是让 Node 在保留“UCAN 校验模式”的同时，提供“中心化签发 UCAN”能力，用于移动端无钱包插件场景。

## 1. 文档目标
- 明确 UCAN 双模式边界：校验模式 vs 签发模式。
- 统一签发接口、配置项、校验逻辑与安全基线。
- 记录实现里程碑、回滚策略、已知风险，作为长期维护入口。

## 2. 当前状态（截至 2026-04-17）
- 已实现：
  - SIWE/JWT 登录接口：`/api/v1/public/auth/challenge|verify|refresh|logout`
  - UCAN 校验模式：`Authorization: Bearer <UCAN>`，服务端验证 `aud/cap/proof`
  - 中心化签发接口：`/api/v1/public/auth/central/issuer|session|issue|revoke`
  - 中心化 UCAN 校验分支：支持 `UCAN_ISSUER_DID` 信任 + `mode` 分支（`verify|issue|hybrid`）
- 未实现（后续阶段）：
  - key rotation（active/next）
  - revoke 与 token 黑名单联动（当前仅 session revoke）
  - 外部 KMS/HSM 托管接入

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
  - 输出：`sessionToken`（短期）
- `POST /issue`
  - Header：`Authorization: Bearer <sessionToken>`
  - 输入：`audience`、`capabilities`、`expiresInMs`（或 `ttlMs`）
  - 输出：`ucan`
- `POST /revoke`
  - Header：`Authorization: Bearer <sessionToken>`
  - 输出：`revoked`

## 5. 配置项

`config.js` / 环境变量：

- `ucanIssuer.enabled` / `UCAN_ISSUER_ENABLED`
- `ucanIssuer.mode` / `UCAN_ISSUER_MODE`
  - `verify`（仅校验，默认）
  - `issue`（仅签发路径与中心化校验）
  - `hybrid`（钱包校验 + 中心化签发/校验）
- `ucanIssuer.did` / `UCAN_ISSUER_DID`
- `ucanIssuer.privateKey` / `UCAN_ISSUER_PRIVATE_KEY`（建议从密钥管理系统注入）
- `ucanIssuer.sessionTtlMs` / `UCAN_ISSUER_SESSION_TTL_MS`
- `ucanIssuer.tokenTtlMs` / `UCAN_ISSUER_TOKEN_TTL_MS`
- `ucanIssuer.defaultAudience` / `UCAN_ISSUER_DEFAULT_AUDIENCE`
- `ucanIssuer.defaultCapabilities` / `UCAN_ISSUER_DEFAULT_CAPABILITIES`

## 6. 服务端验证逻辑（第三方无感）

`src/auth/ucan.ts` 的 UCAN 校验入口保持统一，业务接口无须区分钱包签发或中心化签发：
- `aud` 必须匹配 `UCAN_AUD`
- capability 必须满足 required `with/can`
- `exp/nbf` 时间窗合法
- 钱包模式要求 `prf` 证明链可验证

模式分派：
- 钱包模式：`Root(SIWE) -> Delegation -> Invocation`
- 中心化模式：信任 `UCAN_ISSUER_DID`，校验 `aud/cap/exp/nbf/sub`

## 7. 安全与风控基线

- Issuer 私钥不得写入仓库，必须通过环境注入或 KMS 托管。
- 必须实现 key rotation（最少双 key：active + next）。
- `sessionToken` 与 `ucan` 都采用短期有效策略。
- 所有签发行为写审计日志：谁、何时、签发给谁、能力范围、过期时间。
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

建议指标：
- 中心化签发成功率、失败率
- session 创建成功率
- token 验证失败分类（aud 不匹配、cap 拒绝、过期、签名失败）

## 9. 实施里程碑

### 阶段 1（已完成）
- 增加 `auth/central/issuer|session|issue|revoke` 路由
- 增加基础配置项与启动校验
- 支持中心化 token 的服务端校验分支

### 阶段 2（进行中）
- 完善错误码与观测指标（按失败原因聚合）
- 文档与前端 SDK 联调（移动端直连流程）
- session 与签发策略细化（多终端、多租户）

### 阶段 3（规划）
- key rotation
- revoke 黑名单联动
- 审计报表与安全告警

## 10. 与其它文档关系
- 登录总文档：`登录授权.md`
- 权限/签名：`权限与签名.md`
- 接口总览：`接口说明.md`
- 运行配置：`运行配置.md`

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
