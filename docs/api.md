# API 概览

## 基础路径
`/api/v1`

## 响应封装
所有响应遵循统一结构：
```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": 1730000000000
}
```

## 鉴权
- 公共接口：`/api/v1/public/auth/*`、`/api/v1/public/health`
- 其余接口需要 `Authorization: Bearer <JWT|UCAN>`
 - 管理员接口：`/api/v1/admin/*` 需要管理员身份（角色 `OWNER` 或 `ADMIN_DIDS` 白名单）
 - 内部接口：`/api/v1/internal/*` 需要 `x-internal-token` 与 `INTERNAL_TOKEN` 匹配

## 接口前缀归类表
| 前缀 | 访问范围 | 鉴权 | 现状 | 示例 |
| --- | --- | --- | --- | --- |
| `/api/v1/public/*` | 公开访问 | 公开或需要 Bearer（除 auth/health） | 已实现 | `/api/v1/public/applications/*` |
| `/api/v1/admin/*` | 管理员访问 | 管理员凭证 | 已实现 | `/api/v1/admin/audits/*` |
| `/api/v1/internal/*` | 内部服务访问 | `x-internal-token` | 保留 | `/api/v1/internal/*` |

## 接口前缀归类表（模块级）
| 模块 | 前缀 | 说明 |
| --- | --- | --- |
| Auth | `/api/v1/public/*` | 公共认证与健康检查 |
| Application | `/api/v1/public/*` | create/detail/search/delete/publish/unpublish |
| Service | `/api/v1/public/*` | create/detail/search/delete/publish/unpublish |
| Audit | `/api/v1/public/*` + `/api/v1/admin/*` | create/search/cancel/detail 在 public，approve/reject 在 admin（审批人也可调用） |
| User | `/api/v1/admin/*` | 用户管理与状态变更 |
| MPC | `/api/v1/public/*` | MPC 协调器会话/消息接口（需 UCAN） |

## 模块分组（常见）
- **Application**: create/detail/search/delete/publish/unpublish
- **Service**: create/detail/search/delete/publish/unpublish
- **Audit/Approval**: create/search/cancel/detail（用户） + approve/reject（管理员）
- **User/Profile/Node**: 用户管理（管理员）与健康检查（公共）
- **User**: 管理员可更新用户状态与角色

> 接口以 REST 风格为准，完整清单维护在本文档中。

## 主要接口（REST）

### Public（前端/第三方）
- **Auth**
  - `POST /api/v1/public/auth/challenge`
  - `POST /api/v1/public/auth/verify`
  - `POST /api/v1/public/auth/refresh`
  - `POST /api/v1/public/auth/logout`
- **Health**
  - `GET /api/v1/public/health`
- **Profile**
  - `GET /api/v1/public/profile/me`
- **Applications**
  - `POST /api/v1/public/applications`
  - `PATCH /api/v1/public/applications/:uid`
  - `GET /api/v1/public/applications/:uid`
  - `GET /api/v1/public/applications/:uid/config`
  - `PUT /api/v1/public/applications/:uid/config`
  - `GET /api/v1/public/applications/by-did?did=...&version=...`
  - `POST /api/v1/public/applications/search`
  - `DELETE /api/v1/public/applications/:uid`
  - `POST /api/v1/public/applications/:uid/publish`
  - `POST /api/v1/public/applications/:uid/unpublish`
- **Services**
  - `POST /api/v1/public/services`
  - `PATCH /api/v1/public/services/:uid`
  - `GET /api/v1/public/services/:uid`
  - `GET /api/v1/public/services/:uid/config`
  - `PUT /api/v1/public/services/:uid/config`
  - `GET /api/v1/public/services/by-did?did=...&version=...`
  - `POST /api/v1/public/services/search`
  - `DELETE /api/v1/public/services/:uid`
  - `POST /api/v1/public/services/:uid/publish`
  - `POST /api/v1/public/services/:uid/unpublish`
- **Audits**
  - `POST /api/v1/public/audits`
  - `POST /api/v1/public/audits/search`
  - `GET /api/v1/public/audits/:uid`
  - `DELETE /api/v1/public/audits/:uid`
- **MPC Coordinator**
  - `POST /api/v1/public/mpc/sessions`
  - `POST /api/v1/public/mpc/sessions/:sessionId/join`
  - `POST /api/v1/public/mpc/sessions/:sessionId/messages`
  - `GET /api/v1/public/mpc/sessions/:sessionId/messages?since=...&cursor=...`
  - `GET /api/v1/public/mpc/sessions/:sessionId`
  - `GET /api/v1/public/mpc/ws?sessionId=...`（SSE 推送）
  - 事件类型：`session-update` / `message` / `participant-joined`
  - SSE 断线可使用 `Last-Event-ID` 或 `cursor` 续传（需 Redis Streams 启用）

### Admin（管理端）
- **Audits**
  - `POST /api/v1/admin/audits/:uid/approve`
  - `POST /api/v1/admin/audits/:uid/reject`
- **Users**
  - `GET /api/v1/admin/users`
  - `GET /api/v1/admin/users/:did`
  - `PATCH /api/v1/admin/users/:did/role`
  - `PATCH /api/v1/admin/users/:did/status`

## 存储
后端存储接口已弃用，前端通过 WebDAV 直连上传。
