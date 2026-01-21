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
- Public SIWE auth endpoints: `/api/v1/public/auth/*`
- All other endpoints require `Authorization: Bearer <JWT|UCAN>`

## Module Groups (Typical)
- **Application**: create, detail, search, delete
- **Service**: create, detail, search, delete
- **Audit/Approval**: create, search, approve, reject, cancel, detail
- **User/Profile/Node**: basic profile and health check

> For the full list of endpoints, see `openapi.json` or `/api-docs` when `APP_ENV=dev`.

## Storage
Backend storage APIs are deprecated. The frontend uploads directly to WebDAV using UCAN.
