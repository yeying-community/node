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
- Public endpoints: `/api/v1/public/auth/*`, `/api/v1/public/health`
- All other endpoints require `Authorization: Bearer <JWT|UCAN>`
 - Admin endpoints: `/api/v1/admin/*` require admin identity (role `OWNER` or `ADMIN_DIDS` allowlist)
 - Internal endpoints: `/api/v1/internal/*` require `x-internal-token` matching `INTERNAL_TOKEN`

## Prefix Classification Table
| Prefix | Access | Auth | Status | Examples |
| --- | --- | --- | --- | --- |
| `/api/v1/public/*` | Public | public or Bearer (except auth/health) | Implemented | `/api/v1/public/applications/*` |
| `/api/v1/admin/*` | Admin-only | Admin credentials | Implemented | `/api/v1/admin/audits/*` |
| `/api/v1/internal/*` | Internal services | `x-internal-token` | Reserved | `/api/v1/internal/*` |

## Prefix Classification (Module Level)
| Module | Prefix | Notes |
| --- | --- | --- |
| Auth | `/api/v1/public/*` | Public auth + health check |
| Application | `/api/v1/public/*` | create/detail/search/delete/publish/unpublish |
| Service | `/api/v1/public/*` | create/detail/search/delete/publish/unpublish |
| Audit | `/api/v1/public/*` + `/api/v1/admin/*` | create/search/cancel/detail in public; approve/reject in admin (approvers allowed) |
| User | `/api/v1/admin/*` | user management + status changes |
| Config | `/api/v1/internal/*` | reserved |

## Module Groups (Typical)
- **Application**: create, detail, search, delete, publish, unpublish
- **Service**: create, detail, search, delete, publish, unpublish
- **Audit/Approval**: create/search/cancel/detail (user) + approve/reject (admin)
- **User/Profile/Node**: admin user management + public health check
- **User**: admins can update user status and role

> The REST endpoints are defined in this document.

## Service/Application Config
- `GET /api/v1/public/applications/:uid/config`
- `PUT /api/v1/public/applications/:uid/config`
- `GET /api/v1/public/services/:uid/config`
- `PUT /api/v1/public/services/:uid/config`

## Storage
Backend storage APIs are deprecated. The frontend uploads directly to WebDAV using UCAN.
