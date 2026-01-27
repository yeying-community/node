# Invitation


## Operations

### invitationCreate

```http
POST /api/v1/admin/invitation/create
```


### invitationDetail

```http
POST /api/v1/admin/invitation/detail
```


### invitationSearch

```http
POST /api/v1/admin/invitation/search
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function invitationCreate(request: Api.InvitationCreateInvitationRequest): Promise<t.InvitationCreateResponse> {
	throw 'Unimplemented'
}

async function invitationDetail(request: Api.InvitationInvitationDetailRequest): Promise<t.InvitationDetailResponse> {
	throw 'Unimplemented'
}

async function invitationSearch(request: Api.InvitationSearchInvitationRequest): Promise<t.InvitationSearchResponse> {
	throw 'Unimplemented'
}


const api: t.InvitationApi = {
	invitationCreate,
	invitationDetail,
	invitationSearch,
}

export default api
```
