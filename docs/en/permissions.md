# Permission Model

This section describes the current authorization model as implemented in the backend.

## Authentication Layer (Implemented)
- All `/api/v1/*` business endpoints require `Authorization: Bearer <token>`.
- Two token types are supported:
  - **SIWE (JWT)**
  - **UCAN** (must satisfy `aud` + `cap`)

## UCAN Authorization Rules (Implemented)
Server validates:
- `aud` equals `UCAN_AUD` (exact match)
- capability includes `{ resource: UCAN_RESOURCE, action: UCAN_ACTION }`
- `exp` is valid and proof chain passes

> The client must generate UCAN with an `aud` that exactly matches `UCAN_AUD`.

## Roles & User Status (Defined)
Role/status enums exist in the API schema but are **not enforced** by current server logic:
- `UserRoleEnum`: `OWNER`, `NORMAL`, `UNKNOWN`
- `UserStatusEnum`: `ACTIVE`, `OFFLINE`, `DISABLE`, `LOCK`, `AUDIT`, `REFUSED`, ...

## Current Enforcement Boundaries
- **Enforced**: token validation (JWT/UCAN)
- **Enforced**: ownership checks on create/delete for applications/services
- **Enforced**: approver-only audit approval/rejection
- **Enforced**: admin prefix guard (`/api/v1/admin/*`, role `OWNER` or `ADMIN_DIDS` allowlist)
- **Enforced**: blocked user status (disabled/freeze/lock) cannot publish/approve
- **Not enforced**: role/status checks and fine-grained RBAC
- **Signature verification**: disabled (no-op) since `@yeying-community/yeying-web3` removal

## Recommended Target Model (Plan)
Suggested rules to implement:

### Role Guidelines
- `OWNER`: audit/governance permissions (approve, ban, publish/unpublish)
- `NORMAL`: create and manage own apps/services, submit applications
- `UNKNOWN`: read-only or denied

### Resource-Level Rules
- **Application**: only owner can update/offline; audited before online
- **Service**: only owner can update/offline; audited before online
- **Audit**: only reviewers/admins can approve/reject
- **User status**: only admins can freeze/unfreeze

> These are planned constraints; current code does not enforce them.

## Gaps & TODOs (Suggested Priority)
1. **Role checks**: bind `OWNER/NORMAL` to approval and publish/unpublish operations.
2. **Ownership checks**: only owners can update/offline their apps/services (create/delete enforced; update/offline still missing).
3. **Audit permissions**: only reviewers/admins can approve/reject; record approver identity (approver-only enforcement is in place).
4. **User status control**: only admins can freeze/unfreeze; frozen users cannot publish/approve.
5. **Restore signature verification**: reintroduce a crypto/signature module or equivalent.
6. **Online state constraints**: require audit pass before online; search should default to online only (implemented).
