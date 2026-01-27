# Config


## Operations

### configGet

```http
POST /api/v1/internal/config/get
```


### configSet

```http
POST /api/v1/internal/config/set
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function configGet(request: Api.ConfigGetConfigRequest): Promise<t.ConfigGetResponse> {
	throw 'Unimplemented'
}

async function configSet(request: Api.ConfigSetConfigRequest): Promise<t.ConfigSetResponse> {
	throw 'Unimplemented'
}


const api: t.ConfigApi = {
	configGet,
	configSet,
}

export default api
```
