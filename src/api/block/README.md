# Block


## Operations

### blockConfirm

```http
POST /api/v1/internal/block/confirm
```


### blockGet

```http
POST /api/v1/internal/block/get
```


### blockPut

```http
POST /api/v1/internal/block/put
```


### blockStreamGet

```http
POST /api/v1/internal/block/streamGet
```


### blockStreamPut

```http
POST /api/v1/internal/block/streamPut
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function blockConfirm(request: Api.AssetConfirmBlockRequest): Promise<t.BlockConfirmResponse> {
	throw 'Unimplemented'
}

async function blockGet(request: Api.AssetGetBlockRequest): Promise<t.BlockGetResponse> {
	throw 'Unimplemented'
}

async function blockPut(request: Api.AssetPutBlockRequest): Promise<t.BlockPutResponse> {
	throw 'Unimplemented'
}

async function blockStreamGet(request: Api.AssetStreamGetBlockRequest): Promise<t.BlockStreamGetResponse> {
	throw 'Unimplemented'
}

async function blockStreamPut(request: Api.AssetStreamPutBlockRequest): Promise<t.BlockStreamPutResponse> {
	throw 'Unimplemented'
}


const api: t.BlockApi = {
	blockConfirm,
	blockGet,
	blockPut,
	blockStreamGet,
	blockStreamPut,
}

export default api
```
