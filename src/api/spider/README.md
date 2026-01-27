# Spider


## Operations

### spiderConfig

```http
POST /api/v1/admin/spider/config
```


### spiderInstall

```http
POST /api/v1/admin/spider/install
```


### spiderRemove

```http
POST /api/v1/admin/spider/remove
```


### spiderSearch

```http
POST /api/v1/admin/spider/search
```


### spiderUpgrade

```http
POST /api/v1/admin/spider/upgrade
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function spiderConfig(request: Api.PluginInstallRequest): Promise<t.SpiderConfigResponse> {
	throw 'Unimplemented'
}

async function spiderInstall(request: Api.PluginInstallRequest): Promise<t.SpiderInstallResponse> {
	throw 'Unimplemented'
}

async function spiderRemove(request: Api.PluginUninstallRequest): Promise<t.SpiderRemoveResponse> {
	throw 'Unimplemented'
}

async function spiderSearch(request: Api.ApipluginSearchRequest): Promise<t.SpiderSearchResponse> {
	throw 'Unimplemented'
}

async function spiderUpgrade(request: Api.PluginInstallRequest): Promise<t.SpiderUpgradeResponse> {
	throw 'Unimplemented'
}


const api: t.SpiderApi = {
	spiderConfig,
	spiderInstall,
	spiderRemove,
	spiderSearch,
	spiderUpgrade,
}

export default api
```
