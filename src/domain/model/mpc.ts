import {
  MpcAuditLogDO,
  MpcMessageDO,
  MpcSessionDO,
  MpcSessionParticipantDO,
  MpcSignRequestDO
} from '../mapper/entity'

export type MpcSessionType = 'keygen' | 'sign' | 'refresh'

export interface MpcSession {
  id: string
  name: string
  type: string
  walletId: string
  threshold: number
  participants: string[]
  status: string
  round: number
  curve: string
  keyVersion: number
  shareVersion: number
  result?: unknown
  createdAt: string
  expiresAt: string
}

export interface MpcSessionParticipant {
  uid?: string
  sessionId: string
  participantId: string
  deviceId: string
  identity: string
  e2ePublicKey: string
  signingPublicKey: string
  status: string
  joinedAt: string
}

export interface MpcMessage {
  id: string
  sessionId: string
  sender: string
  receiver?: string
  round: number
  type: string
  seq: number
  envelope: unknown
  createdAt: string
}

export interface MpcSignRequest {
  id: string
  walletId: string
  sessionId: string
  initiator: string
  payloadType: string
  payloadHash: string
  chainId: number
  status: string
  approvals: unknown
  signature: string
  result: unknown
  completedAt: string
  createdAt: string
}

export interface MpcAuditLog {
  id: string
  walletId: string
  sessionId: string
  level: string
  action: string
  actor: string
  message: string
  time: string
  metadata: unknown
}

function parseJsonArray(raw: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item))
    }
  } catch {
    // ignore parse errors
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseJsonValue(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function convertMpcSessionTo(session: Partial<MpcSession>): MpcSessionDO {
  const sessionDO = new MpcSessionDO()
  if (!session) {
    return sessionDO
  }
  sessionDO.id = session.id!
  sessionDO.name = session.name || ''
  sessionDO.type = session.type || ''
  sessionDO.walletId = session.walletId || ''
  sessionDO.threshold = session.threshold ?? 0
  sessionDO.participants = JSON.stringify(session.participants ?? [])
  sessionDO.status = session.status || ''
  sessionDO.round = session.round ?? 0
  sessionDO.curve = session.curve || ''
  sessionDO.keyVersion = session.keyVersion ?? 0
  sessionDO.shareVersion = session.shareVersion ?? 0
  if (typeof session.result === 'string') {
    sessionDO.resultJson = session.result
  } else {
    sessionDO.resultJson = JSON.stringify(session.result ?? {})
  }
  sessionDO.createdAt = session.createdAt || ''
  sessionDO.expiresAt = session.expiresAt || ''
  return sessionDO
}

export function convertMpcSessionFrom(sessionDO: MpcSessionDO): MpcSession {
  return {
    id: sessionDO.id,
    name: sessionDO.name || '',
    type: sessionDO.type,
    walletId: sessionDO.walletId,
    threshold: sessionDO.threshold,
    participants: parseJsonArray(sessionDO.participants),
    status: sessionDO.status,
    round: sessionDO.round,
    curve: sessionDO.curve,
    keyVersion: sessionDO.keyVersion,
    shareVersion: sessionDO.shareVersion,
    result: parseJsonValue(sessionDO.resultJson || '{}'),
    createdAt: sessionDO.createdAt,
    expiresAt: sessionDO.expiresAt
  }
}

export function convertMpcParticipantTo(participant: Partial<MpcSessionParticipant>): MpcSessionParticipantDO {
  const participantDO = new MpcSessionParticipantDO()
  if (!participant) {
    return participantDO
  }
  if (participant.uid) {
    participantDO.uid = participant.uid
  }
  participantDO.sessionId = participant.sessionId!
  participantDO.participantId = participant.participantId!
  participantDO.deviceId = participant.deviceId!
  participantDO.identity = participant.identity!
  participantDO.e2ePublicKey = participant.e2ePublicKey!
  participantDO.signingPublicKey = participant.signingPublicKey || ''
  participantDO.status = participant.status || 'active'
  participantDO.joinedAt = participant.joinedAt || ''
  return participantDO
}

export function convertMpcParticipantFrom(participantDO: MpcSessionParticipantDO): MpcSessionParticipant {
  return {
    uid: participantDO.uid,
    sessionId: participantDO.sessionId,
    participantId: participantDO.participantId,
    deviceId: participantDO.deviceId,
    identity: participantDO.identity,
    e2ePublicKey: participantDO.e2ePublicKey,
    signingPublicKey: participantDO.signingPublicKey,
    status: participantDO.status,
    joinedAt: participantDO.joinedAt
  }
}

export function convertMpcMessageTo(message: Partial<MpcMessage>): MpcMessageDO {
  const messageDO = new MpcMessageDO()
  if (!message) {
    return messageDO
  }
  messageDO.id = message.id!
  messageDO.sessionId = message.sessionId!
  messageDO.sender = message.sender!
  messageDO.receiver = message.receiver || ''
  messageDO.round = message.round ?? 0
  messageDO.type = message.type || ''
  messageDO.seq = message.seq ?? 0
  if (typeof message.envelope === 'string') {
    messageDO.envelope = message.envelope
  } else {
    messageDO.envelope = JSON.stringify(message.envelope ?? {})
  }
  messageDO.createdAt = message.createdAt || ''
  return messageDO
}

export function convertMpcMessageFrom(messageDO: MpcMessageDO): MpcMessage {
  return {
    id: messageDO.id,
    sessionId: messageDO.sessionId,
    sender: messageDO.sender,
    receiver: messageDO.receiver,
    round: messageDO.round,
    type: messageDO.type,
    seq: messageDO.seq,
    envelope: parseJsonValue(messageDO.envelope),
    createdAt: messageDO.createdAt
  }
}

export function convertMpcSignRequestTo(request: Partial<MpcSignRequest>): MpcSignRequestDO {
  const requestDO = new MpcSignRequestDO()
  if (!request) {
    return requestDO
  }
  requestDO.id = request.id!
  requestDO.walletId = request.walletId!
  requestDO.sessionId = request.sessionId!
  requestDO.initiator = request.initiator!
  requestDO.payloadType = request.payloadType!
  requestDO.payloadHash = request.payloadHash!
  requestDO.chainId = request.chainId ?? 0
  requestDO.status = request.status || ''
  if (typeof request.approvals === 'string') {
    requestDO.approvals = request.approvals
  } else {
    requestDO.approvals = JSON.stringify(request.approvals ?? [])
  }
  requestDO.signature = request.signature || ''
  if (typeof request.result === 'string') {
    requestDO.resultJson = request.result
  } else {
    requestDO.resultJson = JSON.stringify(request.result ?? {})
  }
  requestDO.completedAt = request.completedAt || ''
  requestDO.createdAt = request.createdAt || ''
  return requestDO
}

export function convertMpcSignRequestFrom(requestDO: MpcSignRequestDO): MpcSignRequest {
  return {
    id: requestDO.id,
    walletId: requestDO.walletId,
    sessionId: requestDO.sessionId,
    initiator: requestDO.initiator,
    payloadType: requestDO.payloadType,
    payloadHash: requestDO.payloadHash,
    chainId: requestDO.chainId,
    status: requestDO.status,
    approvals: parseJsonValue(requestDO.approvals),
    signature: requestDO.signature || '',
    result: parseJsonValue(requestDO.resultJson || '{}'),
    completedAt: requestDO.completedAt || '',
    createdAt: requestDO.createdAt
  }
}

export function convertMpcAuditLogTo(log: Partial<MpcAuditLog>): MpcAuditLogDO {
  const logDO = new MpcAuditLogDO()
  if (!log) {
    return logDO
  }
  logDO.id = log.id!
  logDO.walletId = log.walletId!
  logDO.sessionId = log.sessionId!
  logDO.level = log.level || 'info'
  logDO.action = log.action || ''
  logDO.actor = log.actor || ''
  logDO.message = log.message || ''
  logDO.time = log.time || ''
  if (typeof log.metadata === 'string') {
    logDO.metadata = log.metadata
  } else {
    logDO.metadata = JSON.stringify(log.metadata ?? {})
  }
  return logDO
}

export function convertMpcAuditLogFrom(logDO: MpcAuditLogDO): MpcAuditLog {
  return {
    id: logDO.id,
    walletId: logDO.walletId,
    sessionId: logDO.sessionId,
    level: logDO.level,
    action: logDO.action,
    actor: logDO.actor,
    message: logDO.message,
    time: logDO.time,
    metadata: parseJsonValue(logDO.metadata)
  }
}
