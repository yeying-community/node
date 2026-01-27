# Event


## Operations

### eventConsume

```http
POST /api/v1/internal/event/consume
```


### eventProduce

```http
POST /api/v1/internal/event/produce
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function eventConsume(request: Api.EventConsumeRequest): Promise<t.EventConsumeResponse> {
	throw 'Unimplemented'
}

async function eventProduce(request: Api.EventProduceRequest): Promise<t.EventProduceResponse> {
	throw 'Unimplemented'
}


const api: t.EventApi = {
	eventConsume,
	eventProduce,
}

export default api
```
