# Core Business & Priorities

## Core API Groups
- **Application**: create/update, detail, query, search, unpublish
- **Service**: create/update, detail, query, search, unpublish
- **Audit**: submit, approve/reject, cancel, detail, search
- **User/State**: user detail, status update, role management (not enforced yet)
- **Auth/Health**: login (SIWE/UCAN), refresh/logout, health check

> The definitive list is in `docs/en/api.md`.

## Required Auth/Permission Rules (Should be enforced)
- **Auth**: all non-public endpoints require `Authorization: Bearer <JWT|UCAN>`.
- **UCAN**: `aud == UCAN_AUD`, capabilities include `UCAN_RESOURCE/UCAN_ACTION`.
- **Ownership**: only owners can update/unpublish/delete their apps/services.
- **Audit permissions**: only reviewers/admins can approve/reject.
- **User status**: only admins can freeze/unfreeze; frozen users cannot publish/approve.
- **Online constraints**: must pass audit before online; search defaults to online only.

## Priority Modules to Improve (Suggested Order)
1. **Audit flow**
   - Reviewer permissions (implemented: approver-only)
   - Link audit results to online status (implemented)
2. **Apply flow**
   - Validate target metadata (implemented)
   - Duplicate submit/cancel rules (implemented: no duplicate pending tickets)
3. **Publish/Unpublish**
   - Clear lifecycle states (created/audited/online/offline) (implemented)
   - Search/display aligned with state (implemented)
   - Endpoints are in place; keep tightening audit gating + owner checks
4. **Permission model enforcement**
   - Role/status binding to endpoints
5. **Signature verification (partial)**
   - Enforced for audit submit/approve/reject (wallet `personal_sign`)
   - Other flows remain unsigned for now
