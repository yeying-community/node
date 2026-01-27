# Certificate


## Operations

### certificateGet

```http
POST /api/v1/internal/certificate/get
```


### certificateSign

```http
POST /api/v1/internal/certificate/sign
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function certificateGet(request: Api.CertificateGetRequest): Promise<t.CertificateGetResponse> {
	throw 'Unimplemented'
}

async function certificateSign(request: Api.CertificateSignRequest): Promise<t.CertificateSignResponse> {
	throw 'Unimplemented'
}


const api: t.CertificateApi = {
	certificateGet,
	certificateSign,
}

export default api
```
