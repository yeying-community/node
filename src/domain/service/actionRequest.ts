import { QueryFailedError } from 'typeorm'
import { ActionRequestManager } from '../manager/actionRequest'
import { ActionRequest, convertActionRequestTo } from '../model/actionRequest'

function isUniqueViolation(error: unknown) {
  if (!(error instanceof QueryFailedError)) {
    return false
  }
  const driverError = (
    error as QueryFailedError & {
      driverError?: { code?: string | number; errno?: number; message?: string; sqlMessage?: string }
    }
  ).driverError
  const code = driverError?.code
  const errno = driverError?.errno
  const message = String(driverError?.message || driverError?.sqlMessage || error.message || '').toLowerCase()

  if (code === '23505' || code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT') {
    return true
  }
  if (code === 1062 || errno === 1062 || errno === 19) {
    return true
  }
  return (
    message.includes('duplicate entry') ||
    message.includes('unique constraint') ||
    message.includes('unique violation') ||
    message.includes('constraint failed')
  )
}

export class ActionRequestService {
  private manager: ActionRequestManager

  constructor() {
    this.manager = new ActionRequestManager()
  }

  async begin(input: ActionRequest) {
    try {
      await this.manager.insert(convertActionRequestTo(input))
      return { kind: 'new' as const }
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.manager.findByActorAndRequestId(input.actor, input.requestId)
        if (!existing) {
          throw new Error('Request replayed')
        }
        if (existing.action !== input.action || existing.payloadHash !== input.payloadHash) {
          throw new Error('Request replay payload mismatch')
        }
        if (existing.status !== 'completed') {
          throw new Error('Request in progress')
        }
        return {
          kind: 'replay' as const,
          responseCode: Number(existing.responseCode || 0),
          responseBody: existing.responseBody || '',
        }
      }
      throw error
    }
  }

  async complete(input: {
    actor: string
    requestId: string
    responseCode: number
    responseBody: string
    completedAt: string
  }) {
    await this.manager.updateByActorAndRequestId(input.actor, input.requestId, {
      status: 'completed',
      responseCode: input.responseCode,
      responseBody: input.responseBody,
      completedAt: input.completedAt,
    })
  }
}
