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
- 公共接口：`/api/v1/public/auth/*`、`/api/v1/public/healthCheck`
- 其余接口需要 `Authorization: Bearer <JWT|UCAN>`
 - 管理员接口：`/api/v1/admin/*` 需要管理员身份（角色 `OWNER` 或 `ADMIN_DIDS` 白名单）
 - 内部接口：`/api/v1/internal/*` 需要 `x-internal-token` 与 `INTERNAL_TOKEN` 匹配

## 接口前缀归类表
| 前缀 | 访问范围 | 鉴权 | 现状 | 示例 |
| --- | --- | --- | --- | --- |
| `/api/v1/public/*` | 公开访问 | 无 | 已实现 | `/api/v1/public/auth/*`、`/api/v1/public/healthCheck` |
| `/api/v1/admin/*` | 管理员访问 | 管理员凭证 | 已实现 | `/api/v1/admin/audit/approve`、`/api/v1/admin/user/*` |
| `/api/v1/internal/*` | 内部服务访问 | `x-internal-token` | 已实现 | `/api/v1/internal/config/*` |
| `/api/v1/*` | 业务接口 | `Authorization: Bearer <JWT|UCAN>` | 已实现 | `/api/v1/application/*` 等 |

## 接口前缀归类表（模块级）
| 模块 | 前缀 | 说明 |
| --- | --- | --- |
| Auth | `/api/v1/public/*` | 公共认证与健康检查 |
| Application | `/api/v1/*` | create/detail/search/delete/publish/unpublish |
| Service | `/api/v1/*` | create/detail/search/delete/publish/unpublish |
| Audit | `/api/v1/*` + `/api/v1/admin/*` | create/search/cancel/detail 在用户前缀，approve/reject 在管理员前缀（审批人也可调用） |
| User | `/api/v1/admin/*` | 用户管理与状态变更 |
| Config | `/api/v1/internal/*` | 内部配置读取/写入 |
| Provider | `/api/v1/admin/*` | 供应商管理 |
| Spider | `/api/v1/admin/*` | 爬虫配置/安装/升级 |
| Recycle | `/api/v1/admin/*` | 回收站管理 |
| Invitation | `/api/v1/admin/*` | 邀请码管理 |
| Mail | `/api/v1/internal/*` | 邮件发送/校验 |
| Minio | `/api/v1/internal/*` | 预签名上传 |
| Certificate | `/api/v1/internal/*` | 证书签发/查询 |
| Event | `/api/v1/internal/*` | 事件生产/消费 |
| Block | `/api/v1/internal/*` | 区块存取接口 |

## 模块分组（常见）
- **Application**: create/detail/search/delete/publish/unpublish
- **Service**: create/detail/search/delete/publish/unpublish
- **Audit/Approval**: create/search/cancel/detail（用户） + approve/reject（管理员）
- **User/Profile/Node**: 用户管理（管理员）与健康检查（公共）
- **User**: 管理员可更新用户状态与角色

> 完整接口列表参见 `openapi.json` 或在 `APP_ENV=dev` 访问 `/api-docs`。

## 存储
后端存储接口已弃用，前端通过 WebDAV 直连上传。
