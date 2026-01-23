# Core Business & Priorities

## Core API Groups
- **Application**: create/update, detail, query, search, unpublish
- **Service**: create/update, detail, query, search, unpublish
- **Audit**: submit, approve/reject, cancel, detail, search
- **User/State**: user detail, status update, role management (not enforced yet)
- **Node**: health check, basic info
- **Invitation**: create/validate invite codes (if enabled)

> The definitive list is in `openapi.json`.

## Required Auth/Permission Rules (Should be enforced)
- **Auth**: all non-public endpoints require `Authorization: Bearer <JWT|UCAN>`.
- **UCAN**: `aud == UCAN_AUD`, capabilities include `UCAN_RESOURCE/UCAN_ACTION`.
- **Ownership**: only owners can update/unpublish/delete their apps/services.
- **Audit permissions**: only reviewers/admins can approve/reject.
- **User status**: only admins can freeze/unfreeze; frozen users cannot publish/approve.
- **Online constraints**: must pass audit before online; search defaults to online only.

## Priority Modules to Improve (Suggested Order)
1. **Audit flow**
   - Reviewer permissions
   - Link audit results to online status
2. **Apply flow**
   - Validate target metadata
   - Duplicate submit/cancel rules
3. **Publish/Unpublish**
   - Clear lifecycle states (created/audited/online/offline)
   - Search/display aligned with state
4. **Permission model enforcement**
   - Role/status binding to endpoints
5. **Signature/identity verification** (if reinstated)
   - Reintroduce secure signing or an alternative
