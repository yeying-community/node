import { describe, expect, it, vi } from 'vitest'
import { registerPublicIdentityEmailRoutes } from '../src/routes/publicIdentityEmail'

async function invokeConfirm(error: Error) {
  let handler: ((req: any, res: any) => Promise<void>) | undefined
  registerPublicIdentityEmailRoutes({
    post: (path: string, next: (req: any, res: any) => Promise<void>) => {
      if (path.endsWith('/confirm')) handler = next
    },
  } as any, { confirm: vi.fn().mockRejectedValue(error) } as any)

  let status = 200
  let body: any
  const response = {
    status(value: number) { status = value; return this },
    json(value: any) { body = value; return this },
  }
  await handler!({ body: {} }, response)
  return { status, body }
}

describe('public identity email error contract', () => {
  it.each([
    'IDENTITY_EMAIL_ALREADY_BOUND',
    'IDENTITY_EMAIL_CHANGE_REQUIRES_AUTHORIZATION',
    'IDENTITY_EMAIL_BINDING_CONFLICT',
  ])('returns HTTP 409 for %s', async message => {
    await expect(invokeConfirm(new Error(message))).resolves.toEqual({
      status: 409,
      body: { code: 409, message, data: null, timestamp: expect.any(Number) },
    })
  })

  it('keeps malformed and expired confirmation errors as HTTP 400', async () => {
    await expect(invokeConfirm(new Error('IDENTITY_EMAIL_VERIFICATION_INVALID'))).resolves.toMatchObject({
      status: 400,
      body: { code: 400, message: 'IDENTITY_EMAIL_VERIFICATION_INVALID', data: null },
    })
  })
})
