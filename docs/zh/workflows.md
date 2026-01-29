# 业务流程（细化）

本节描述社区市场的核心业务流程与当前实现的关键细节。

## 1) 应用发布流程
```mermaid
sequenceDiagram
  actor U as 申请方
  participant FE as 前端
  participant BE as 后端
  participant DB as 数据库

  U ->> FE: 填写应用信息
  FE ->> BE: POST /api/v1/public/applications
  BE ->> DB: 保存 applications（is_online 默认 false）
  BE -->> FE: 创建成功
```

### 关键点
- `applications.is_online` 在创建时被设置为 `false`（`convertApplicationTo`）。
- `applications.status` 默认 `BUSINESS_STATUS_PENDING`。
- 审核通过置为 `BUSINESS_STATUS_ONLINE`，拒绝置为 `BUSINESS_STATUS_REJECTED`。

### 应用生命周期（目标模型）
> 说明：已落地 `status` + `is_online`；审核流程围绕 `BUSINESS_STATUS_*` 运行。
```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> REVIEWING: 提交上架审核
  REVIEWING --> ONLINE: 审核通过
  REVIEWING --> REJECTED: 审核拒绝
  ONLINE --> OFFLINE: 下架
  OFFLINE --> REVIEWING: 重新上架审核
  REJECTED --> REVIEWING: 重新提交上架审核
```

## 2) 服务发布流程
```mermaid
sequenceDiagram
  actor U as 申请方
  participant FE as 前端
  participant BE as 后端
  participant DB as 数据库

  U ->> FE: 填写服务信息
  FE ->> BE: POST /api/v1/public/services
  BE ->> DB: 保存 services（is_online 默认 false）
  BE -->> FE: 创建成功
```

### 关键点
- `services.is_online` 在创建时被设置为 `false`（`convertServiceTo`）。
- `services.status` 默认 `BUSINESS_STATUS_PENDING`。
- 审核通过置为 `BUSINESS_STATUS_ONLINE`，拒绝置为 `BUSINESS_STATUS_REJECTED`。

### 服务生命周期（目标模型）
```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> REVIEWING: 提交上架审核
  REVIEWING --> ONLINE: 审核通过
  REVIEWING --> REJECTED: 审核拒绝
  ONLINE --> OFFLINE: 下架
  OFFLINE --> REVIEWING: 重新上架审核
  REJECTED --> REVIEWING: 重新提交上架审核
```

## 3) 申请流程（提交/撤销）
```mermaid
flowchart TD
  A[申请人提交申请]
  B{校验通过?}
  C[POST /api/v1/public/audits]
  D[生成 audits 工单]
  E[进入待审核队列]
  F{是否撤销?}
  G[DELETE /api/v1/public/audits/:uid]
  H[删除 audits + comments]
  I[等待审核处理]
  J[返回错误]

  A --> B
  B -- 否 --> J
  B -- 是 --> C --> D --> E --> F
  F -- 是 --> G --> H
  F -- 否 --> I
```

### 关键点
- 服务端校验：资源存在、申请人是 owner、元数据 JSON 可解析、同一资源的未结工单不可重复提交。
- `DELETE /api/v1/public/audits/:uid` 会删除工单与其评论（`audits` + `comments`）。

## 4) 审核流程（审批/拒绝）
```mermaid
flowchart TD
  A[审核人检索工单
POST /api/v1/public/audits/search]
  B[查看详情
GET /api/v1/public/audits/:uid]
  C{审核结果}
  D[POST /api/v1/admin/audits/:uid/approve]
  E[POST /api/v1/admin/audits/:uid/reject]
  F[写入 comments]
  G[目标：更新资源状态]
  H[通知/记录]

  A --> B --> C
  C -- 通过 --> D --> F
  C -- 拒绝 --> E --> F
  F -.-> G
  F --> H
```

### 关键点
- `comments.status` 仅支持 `COMMENT_STATUS_AGREE` / `COMMENT_STATUS_REJECT`。
- 审核通过条件：**同意数 >= requiredApprovals** 且无拒绝记录。
- 审核单已做幂等限制：已通过/已驳回后不允许再次审批。
- 审核结果会同步更新应用/服务 `is_online`。

### 审核工单状态机（逻辑）
> 说明：审核单无显式 `status` 字段，可由 comment 聚合（阈值 + 驳回）推断。
```mermaid
stateDiagram-v2
  [*] --> PENDING: POST /api/v1/public/audits
  PENDING --> APPROVED: POST /api/v1/admin/audits/:uid/approve
  PENDING --> REJECTED: POST /api/v1/admin/audits/:uid/reject
  PENDING --> CANCELED: DELETE /api/v1/public/audits/:uid
  REJECTED --> PENDING: 重新提交(新工单)
```

## 5) 上架/下架流程（应用/服务）
> 说明：已提供独立上/下架接口（`POST /api/v1/public/applications/:uid/publish`、`POST /api/v1/public/applications/:uid/unpublish`、`POST /api/v1/public/services/:uid/publish`、`POST /api/v1/public/services/:uid/unpublish`）。
```mermaid
flowchart TD
  A[资源 owner 发起上/下架]
  B{操作类型}
  C{审核通过?}
  D[更新 is_online=true]
  E[更新 is_online=false]
  F[返回结果]
  G[拒绝/提示原因]

  A --> B
  B -- 上架 --> C
  C -- 否 --> G
  C -- 是 --> D --> F
  B -- 下架 --> E --> F
```

### 关键点
- 上线需审核通过，且仅 owner/管理员可操作。
- 已提供独立上/下架接口，审核通过后可上线；下架为手动触发。
- 搜索与展示统一使用“审核 + 上线”状态组合。

### 上下架状态机（逻辑）
```mermaid
stateDiagram-v2
  [*] --> OFFLINE: 目标默认
  OFFLINE --> ONLINE: 上架
  ONLINE --> OFFLINE: 下架
```

## 6) 查询流程（搜索与过滤）
```mermaid
flowchart TD
  A[搜索条件]
  B{是否含 keyword?}
  C[按 keyword + is_online=true 搜索]
  D[按 name/owner/code 搜索]
  E[无条件时默认 is_online=true]

  A --> B
  B -- 是 --> C
  B -- 否 --> D
  D --> E
```

### 关键点
- 任意搜索均默认 `is_online=true`（包含 keyword / name / owner / code）。

## 7) 认证与权限
- 所有业务接口要求 `Authorization: Bearer <JWT|UCAN>`。
- UCAN `aud` 必须与服务端 `UCAN_AUD` 匹配，否则 401。
- 角色/状态权限校验仍**未强制**；上架申请/审核签名已**强制**（详见 `permissions.md`）。
