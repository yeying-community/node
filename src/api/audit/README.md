# Audit


## Operations

### auditApprove

```http
POST /api/v1/admin/audit/approve
```


### auditCancel

```http
POST /api/v1/audit/cancel
```


### auditCreate

```http
POST /api/v1/audit/create
```


### auditDetail

```http
POST /api/v1/audit/detail
```


### auditReject

```http
POST /api/v1/admin/audit/reject
```


### auditSearch

```http
POST /api/v1/audit/search
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function auditApprove(request: Api.AuditAuditApproveRequest): Promise<t.AuditApproveResponse> {
	throw 'Unimplemented'
}

async function auditCancel(request: Api.AuditAuditCancelRequest): Promise<t.AuditCancelResponse> {
	throw 'Unimplemented'
}

async function auditCreate(request: Api.AuditAuditCreateRequest): Promise<t.AuditCreateResponse> {
	throw 'Unimplemented'
}

async function auditDetail(request: Api.AuditAuditDetailRequest): Promise<t.AuditDetailResponse> {
	throw 'Unimplemented'
}

async function auditReject(request: Api.AuditAuditRejectRequest): Promise<t.AuditRejectResponse> {
	throw 'Unimplemented'
}

async function auditSearch(request: Api.AuditAuditSearchRequest): Promise<t.AuditSearchResponse> {
	throw 'Unimplemented'
}


const api: t.AuditApi = {
	auditApprove,
	auditCancel,
	auditCreate,
	auditDetail,
	auditReject,
	auditSearch,
}

export default api
```
