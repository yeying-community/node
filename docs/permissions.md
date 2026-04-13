# 权限模型

本节描述当前后端的权限模型与授权边界（以现有实现为准）。

## 认证层（已实现）
- 所有 `/api/v1/*` 业务接口默认要求 `Authorization: Bearer <token>`。
- 允许两种 token：
  - **SIWE (JWT)**
  - **UCAN**（需满足 `aud` + `cap`）

## UCAN 授权规则（已实现）
服务端严格校验：
- `aud` == `UCAN_AUD`（完全匹配）
- capability 包含 `{ with: UCAN_WITH, can: UCAN_CAN }`
- `exp` 未过期、证明链有效

> 注意：前端必须生成与后端 `UCAN_AUD` 完全一致的 audience，否则返回 `UCAN audience mismatch`。

## 角色与用户状态（已实现）
用户状态与角色已进入实际权限判定：
- `UserRoleEnum`: `OWNER`, `NORMAL`, `UNKNOWN`
- `UserStatusEnum`: `ACTIVE`, `OFFLINE`, `DISABLE`, `LOCK`, `AUDIT`, `REFUSED`, ...

默认策略：
- 首次认证成功或首次命中需要活跃校验的业务接口时，服务端会自动补齐 `user_state`
- 默认值为：`role=USER_ROLE_UNKNOWN`、`status=USER_STATUS_ACTIVE`
- `UNKNOWN` 视为只读，不允许业务写操作

## 当前实际授权边界（现状）
- **已生效**：Token 必须通过（JWT/UCAN）。
- **已生效**：缺失 `user_state` 的用户会被显式补齐为 `UNKNOWN + ACTIVE`。
- **已生效**：资源归属校验（应用/服务创建、更新、删除、上架/下架仅 owner 可操作；管理员可覆盖）。
- **已生效**：应用/服务/配置/审核申请等业务写接口要求角色为 `NORMAL` 或 `OWNER`。
- **已生效**：MPC 写接口（创建会话/加入会话/发送消息）要求角色为 `NORMAL` 或 `OWNER`。
- **已生效**：审核权限（仅审批人可 approve/reject）。
- **已生效**：approve/reject 额外要求治理角色（`OWNER` 或 `ADMIN_DIDS` 白名单）。
- **已生效**：多审批人阈值（`audit.approvers` + `audit.requiredApprovals`），达到阈值才通过；任一驳回即拒绝。
- **已生效**：用户冻结/禁用限制（冻结/禁用用户禁止发布/审批）。
- **已生效**：管理员前缀校验（`/api/v1/admin/*`，角色 `OWNER` 或 `ADMIN_DIDS` 白名单）。
- **已生效**：审批列表查询走服务端过滤与分页，`/api/v1/public/audits/search` 支持 `auditType/type`、`states/state`、`page/pageSize`。
- **已生效**：审核详情与审批列表返回服务端聚合 `summary`，前端直接消费审批状态、阈值和待处理审批人。
- **已生效**：所有业务写接口启用钱包签名校验（personal_sign）。
- **已生效**：`requestId` 持久化去重，写请求会在 `action_requests` 中缓存首个响应；重复提交同一 `(actor, requestId)` 会回放首次结果。
- **已生效**：签名时间窗校验，默认仅接受较短时间窗内的请求签名。
- **已生效**：`action_requests` 后台清理任务会清除过期完成记录和超时 `pending` 记录。

## 写接口签名协议（已实现）
所有业务写接口统一要求顶层字段：
- `requestId`: 本次写请求的唯一请求 ID
- `timestamp`: 本次签名时间戳（推荐 UTC ISO 字符串）
- `signature`: 对签名消息执行 `personal_sign` 的结果

签名消息格式：
- 前缀固定为 `YeYing Market`
- 包含 `Action`、`Actor`、`Timestamp`、`RequestId`
- 包含 `PayloadHash = sha256(canonical_json(payload))`

约束说明：
- 资源自身的 `uid`、`createdAt` 继续是业务字段，不再兼作签名元数据
- 服务端会对每个写接口根据实际执行 payload 重建 `PayloadHash`
- 请求体核心字段在传输途中被改写时，签名会失效
- 服务端会持久化消费 `(actor, requestId)`，请求记录落表 `action_requests`
- 若同一 `(actor, requestId)` 已完成，服务端直接返回首次响应
- 若同一 `(actor, requestId)` 仍在处理中，或 requestId 对应的 `action/payload` 不一致，则返回冲突
- 服务端默认校验签名时间窗：
  - `ACTION_SIGNATURE_MAX_AGE_MS`，默认 5 分钟
  - `ACTION_SIGNATURE_FUTURE_SKEW_MS`，默认 30 秒
- 服务端默认清理策略：
  - `idempotency.successRetentionDays`，默认 7 天
  - `idempotency.failureRetentionDays`，默认 1 天
  - `idempotency.pendingTimeoutMs`，默认 15 分钟
  - `idempotency.cleanupIntervalMs`，默认 15 分钟

## 当前结论
- 权限主路径、签名防重放、审批聚合态与管理员治理接口已经闭环。
- 当前不再有关键收尾型缺口；后续主要是可选增强，而非主链功能补齐。

## 推荐的目标权限模型（规划）
以下是推荐的权限约束（可作为后续开发目标）：

### 角色权限建议
- `OWNER`：审批/治理权限（审核、封禁、上下架）
- `NORMAL`：创建与管理自己的应用/服务、提交申请
- `UNKNOWN`：只读或拒绝

### 资源级权限建议
- **应用**：
  - 仅创建者可更新/下架
  - 审核通过后才能上线
- **服务**：
  - 仅创建者可更新/下架
  - 审核通过后才能上线
- **审核**：
  - 仅审核人/管理员可审批
- **用户状态**：
  - 仅管理员可冻结/解锁

> 说明：角色/状态与市场/MPC 业务接口的主要约束已落地；其余条目为后续加强项。
