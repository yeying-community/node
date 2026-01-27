# Mail


## Operations

### mailSend

```http
POST /api/v1/internal/mail/send
```


### mailVerify

```http
POST /api/v1/internal/mail/verify
```


## Implementation

This is an example of the API implementation to use to update the actual API implementation
when the API structure has changed.

```typescript
async function mailSend(request: Api.MailSendMailRequest): Promise<t.MailSendResponse> {
	throw 'Unimplemented'
}

async function mailVerify(request: Api.MailVerifyMailRequest): Promise<t.MailVerifyResponse> {
	throw 'Unimplemented'
}


const api: t.MailApi = {
	mailSend,
	mailVerify,
}

export default api
```
