# Provider


## Operations

### providerAdd

```http
POST /api/v1/admin/provider/add
```


### providerDelete

```http
POST /api/v1/admin/provider/delete
```


### providerDescriptions

```http
POST /api/v1/admin/provider/descriptions
```


### providerDetail

```http
POST /api/v1/admin/provider/detail
```


### providerModels

```http
POST /api/v1/admin/provider/models
```


### providerSearch

```http
POST /api/v1/admin/provider/search
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function providerAdd(request: Api.LlmAddProviderRequest): Promise<t.ProviderAddResponse> {
	throw 'Unimplemented'
}

async function providerDelete(request: Api.LlmDeleteProviderRequest): Promise<t.ProviderDeleteResponse> {
	throw 'Unimplemented'
}

async function providerDescriptions(request: Api.LlmProviderDescriptionsRequest): Promise<t.ProviderDescriptionsResponse> {
	throw 'Unimplemented'
}

async function providerDetail(request: Api.LlmProviderDetailRequest): Promise<t.ProviderDetailResponse> {
	throw 'Unimplemented'
}

async function providerModels(request: Api.LlmProviderModelsRequest): Promise<t.ProviderModelsResponse> {
	throw 'Unimplemented'
}

async function providerSearch(request: Api.LlmSearchProviderRequest): Promise<t.ProviderSearchResponse> {
	throw 'Unimplemented'
}


const api: t.ProviderApi = {
	providerAdd,
	providerDelete,
	providerDescriptions,
	providerDetail,
	providerModels,
	providerSearch,
}

export default api
```
