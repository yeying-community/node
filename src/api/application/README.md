# Application


## Operations

### applicationCreate

```http
POST /api/v1/application/create
```


### applicationDelete

```http
POST /api/v1/application/delete
```


### applicationDetail

```http
POST /api/v1/application/detail
```


### applicationQueryByUid

```http
POST /api/v1/application/querybyuid
```


### applicationSearch

```http
POST /api/v1/application/search
POST /api/v1/application/publish
POST /api/v1/application/unpublish
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function applicationCreate(request: Api.ApplicationCreateApplicationRequest): Promise<t.ApplicationCreateResponse> {
	throw 'Unimplemented'
}

async function applicationDelete(request: Api.ApplicationDeleteApplicationRequest): Promise<t.ApplicationDeleteResponse> {
	throw 'Unimplemented'
}

async function applicationDetail(request: Api.ApplicationApplicationDetailRequest): Promise<t.ApplicationDetailResponse> {
	throw 'Unimplemented'
}

async function applicationQueryByUid(request: Api.ApplicationQueryByUidApplicationRequest): Promise<t.ApplicationQueryByUidResponse> {
	throw 'Unimplemented'
}

async function applicationSearch(request: Api.ApplicationSearchApplicationRequest): Promise<t.ApplicationSearchResponse> {
	throw 'Unimplemented'
}


const api: t.ApplicationApi = {
	applicationCreate,
	applicationDelete,
	applicationDetail,
	applicationQueryByUid,
	applicationSearch,
}

export default api
```
