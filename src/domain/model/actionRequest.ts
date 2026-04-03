import { ActionRequestDO } from '../mapper/entity'

export type ActionRequest = {
  uid?: string
  actor: string
  action: string
  requestId: string
  payloadHash: string
  signedAt: string
  signature: string
  createdAt: string
  status: string
  responseCode: number
  responseBody: string
  completedAt: string
}

export function convertActionRequestTo(input: ActionRequest): ActionRequestDO {
  const entity = new ActionRequestDO()
  if (input.uid) entity.uid = input.uid
  entity.actor = input.actor
  entity.action = input.action
  entity.requestId = input.requestId
  entity.payloadHash = input.payloadHash
  entity.signedAt = input.signedAt
  entity.signature = input.signature
  entity.createdAt = input.createdAt
  entity.status = input.status
  entity.responseCode = input.responseCode
  entity.responseBody = input.responseBody
  entity.completedAt = input.completedAt
  return entity
}
