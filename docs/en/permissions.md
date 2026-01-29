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
- **Enforced**: ownership checks on create/update/delete/publish/unpublish for applications/services
- **Enforced**: approver-only audit approval/rejection
- **Enforced**: multi-approver threshold (`audit.approvers` + `audit.requiredApprovals`); approve only after threshold, any reject fails
- **Enforced**: admin prefix guard (`/api/v1/admin/*`, role `OWNER` or `ADMIN_DIDS` allowlist)
- **Enforced**: blocked user status (disabled/freeze/lock) cannot publish/approve
- **Not enforced**: role/status checks and fine-grained RBAC
- **Signature verification**: enforced for **audit submit / approve / reject** (wallet `personal_sign`); other signatures remain unenforced

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
2. **Ownership checks**: keep owner-only update/publish/unpublish consistent across UI and API.
3. **Audit permissions**: only reviewers/admins can approve/reject; record approver identity (approver-only enforcement is in place).
4. **User status control**: only admins can freeze/unfreeze; frozen users cannot publish/approve.
5. **Extend signature verification**: decide whether to enforce signatures for create/update/apply flows beyond audits.
6. **Online state constraints**: require audit pass before online; search should default to online only (implemented).
