# API Overview

## Base Path
`/api/v1`

## Response Envelope
All responses follow a common envelope:
```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "timestamp": 1730000000000
}
```

## Authentication
- Public endpoints: `/api/v1/public/auth/*`, `/api/v1/public/healthCheck`
- All other endpoints require `Authorization: Bearer <JWT|UCAN>`
 - Admin endpoints: `/api/v1/admin/*` require admin identity (role `OWNER` or `ADMIN_DIDS` allowlist)
 - Internal endpoints: `/api/v1/internal/*` require `x-internal-token` matching `INTERNAL_TOKEN`

## Prefix Classification Table
| Prefix | Access | Auth | Status | Examples |
| --- | --- | --- | --- | --- |
| `/api/v1/public/*` | Public | None | Implemented | `/api/v1/public/auth/*`, `/api/v1/public/healthCheck` |
| `/api/v1/admin/*` | Admin-only | Admin credentials | Implemented | `/api/v1/admin/audit/approve`, `/api/v1/admin/user/*` |
| `/api/v1/internal/*` | Internal services | `x-internal-token` | Implemented | `/api/v1/internal/config/*` |
| `/api/v1/*` | Business APIs | `Authorization: Bearer <JWT|UCAN>` | Implemented | `/api/v1/application/*` |

## Prefix Classification (Module Level)
| Module | Prefix | Notes |
| --- | --- | --- |
| Auth | `/api/v1/public/*` | Public auth + health check |
| Application | `/api/v1/*` | create/detail/search/delete/publish/unpublish |
| Service | `/api/v1/*` | create/detail/search/delete/publish/unpublish |
| Audit | `/api/v1/*` + `/api/v1/admin/*` | create/search/cancel/detail on user prefix; approve/reject on admin prefix (approvers allowed) |
| User | `/api/v1/admin/*` | user management + status changes |
| Config | `/api/v1/internal/*` | internal config read/write |
| Provider | `/api/v1/admin/*` | provider management |
| Spider | `/api/v1/admin/*` | crawler config/install/upgrade |
| Recycle | `/api/v1/admin/*` | recycle bin management |
| Invitation | `/api/v1/admin/*` | invite code management |
| Mail | `/api/v1/internal/*` | mail send/verify |
| Minio | `/api/v1/internal/*` | presigned uploads |
| Certificate | `/api/v1/internal/*` | certificate sign/get |
| Event | `/api/v1/internal/*` | event produce/consume |
| Block | `/api/v1/internal/*` | block storage APIs |

## Module Groups (Typical)
- **Application**: create, detail, search, delete, publish, unpublish
- **Service**: create, detail, search, delete, publish, unpublish
- **Audit/Approval**: create/search/cancel/detail (user) + approve/reject (admin)
- **User/Profile/Node**: admin user management + public health check
- **User**: admins can update user status and role

> For the full list of endpoints, see `openapi.json` or `/api-docs` when `APP_ENV=dev`.

## Storage
Backend storage APIs are deprecated. The frontend uploads directly to WebDAV using UCAN.
