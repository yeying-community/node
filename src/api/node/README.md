# Node


## Operations

### nodeHealthCheck

```http
POST /api/v1/public/healthCheck
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function nodeHealthCheck(request: Api.NodeHealthCheckRequest): Promise<t.NodeHealthCheckResponse> {
	throw 'Unimplemented'
}

const api: t.NodeApi = {
	nodeHealthCheck,
}

export default api
```
