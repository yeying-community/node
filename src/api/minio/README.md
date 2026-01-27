# Minio


## Operations

### minioPresignedUploadUrl

```http
POST /api/v1/internal/minio/presigned/upload/url
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function minioPresignedUploadUrl(request: Api.MiniosdkPresignedUploadUrlRequest): Promise<t.MinioPresignedUploadUrlResponse> {
	throw 'Unimplemented'
}


const api: t.MinioApi = {
	minioPresignedUploadUrl,
}

export default api
```
