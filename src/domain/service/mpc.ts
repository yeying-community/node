import { Logger } from 'winston'
import { v4 as uuidv4 } from 'uuid'
import { SingletonLogger } from '../facade/logger'
import { MpcManager } from '../manager/mpc'
import {
  MpcMessage,
  MpcSession,
  MpcSessionParticipant,
  convertMpcAuditLogTo,
  convertMpcMessageFrom,
  convertMpcMessageTo,
  convertMpcParticipantFrom,
  convertMpcParticipantTo,
  convertMpcSignRequestFrom,
  convertMpcSignRequestTo,
  convertMpcSessionFrom,
  convertMpcSessionTo
} from '../model/mpc'
import { publishMpcEvent } from './mpcEvents'
import { NotificationService, safelyRunNotificationTask } from './notification'

export type CreateMpcSessionInput = {
  id?: string
  name: string
  type: string
  walletId: string
  threshold: number
  participants: string[]
  curve?: string
  expiresAt?: string
  keyVersion?: number
  shareVersion?: number
}

export type JoinMpcSessionInput = {
  participantId: string
  deviceId: string
  identity: string
  e2ePublicKey: string
  signingPublicKey?: string
}

export type SendMpcMessageInput = {
  id: string
  from: string
  to?: string
  round?: number
  type: string
  seq?: number
  envelope: unknown
}

export type MpcWireAudience =
  | 'all-parties'
  | { 'one-party': { recipient_index?: number } }

export type SendMpcWireMessageInput = {
  protocol_version?: number
  engine: string
  session_id?: string
  protocol: string
  request_id?: string
  sequence?: number
  sender_index?: number
  audience: MpcWireAudience
  payload: unknown
}

export type CompleteMpcKeygenInput = {
  participantId: string
  result: {
    address: string
    publicKey: string
    groupPublicKey?: string
    chainCode?: string
    curve?: string
    keyVersion?: number
    shareVersion?: number
  }
}

export type CreateMpcSignRequestInput = {
  id?: string
  walletId: string
  sessionId: string
  payloadType: string
  payloadHash: string
  payload?: unknown
  chainId?: number
}

export type CompleteMpcSignRequestInput = {
  requestId: string
  participantId: string
  signature: string
  result?: unknown
}

export type MpcMessagePage = {
  messages: MpcMessage[]
  nextCursor?: string
  nextSequence?: number
}

export type MpcInviteListItem = {
  uid: string
  type: 'mpc.keygen.invited'
  source: 'mpc'
  subjectType: 'mpc.session'
  subjectId: string
  actor: string
  title: string
  payload: {
    sessionId: string
    name: string
    walletId: string
    sessionType: string
    threshold: number
    participants: string[]
    curve: string
    keyVersion: number
    shareVersion: number
    inviter: string
    expiresAt: string
  }
  session: MpcSession
}

export type MpcSignRequestListQuery = {
  sessionId?: string
  walletId?: string
  status?: string
  page?: number
  pageSize?: number
}

export type MpcSessionDetail = MpcSession & {
  joinedParticipants: MpcSessionParticipant[]
  joinedCount: number
}

const SESSION_TYPES = new Set(['keygen', 'sign', 'refresh'])
const CANCELLABLE_SESSION_STATUSES = new Set(['created', 'invited'])
const SIGN_PAYLOAD_TYPES = new Set(['message', 'transaction', 'typed_data'])
const MPC_WIRE_ENGINE = 'cggmp24'
const MPC_WIRE_PROTOCOL_VERSION = 1
const MPC_WIRE_PROTOCOLS = new Set(['keygen', 'aux-info', 'sign'])

function normalizeAddress(value: string) {
  return value.trim().toLowerCase()
}

function normalizeMpcVersion(value: unknown, fallback = 1) {
  const version = Number(value)
  if (Number.isInteger(version) && version > 0) {
    return version
  }
  return fallback
}

function extractEthAddress(identity: string): string | null {
  if (!identity) return null
  const lower = identity.trim().toLowerCase()
  const ethPrefix = 'did:pkh:eth:'
  if (lower.startsWith(ethPrefix)) {
    return lower.slice(ethPrefix.length)
  }
  const eipPrefix = 'did:pkh:eip155:'
  if (lower.startsWith(eipPrefix)) {
    const parts = lower.split(':')
    const address = parts[4]
    return address || null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseWireAudience(audience: MpcWireAudience): { receiver: string; recipientIndex?: number } {
  if (audience === 'all-parties') {
    return { receiver: '' }
  }
  if (!isRecord(audience)) {
    throw new Error('INVALID_MPC_MESSAGE_AUDIENCE')
  }
  const audienceRecord = audience as Record<string, unknown>
  const oneParty = audienceRecord['one-party']
  if (!isRecord(oneParty)) {
    throw new Error('INVALID_MPC_MESSAGE_AUDIENCE')
  }
  const recipientIndex = Number(oneParty.recipient_index)
  if (!Number.isInteger(recipientIndex) || recipientIndex < 0) {
    throw new Error('INVALID_MPC_MESSAGE_AUDIENCE')
  }
  return { receiver: String(recipientIndex), recipientIndex }
}

function inferWireRound(payload: unknown): number {
  if (!isRecord(payload)) {
    return 0
  }
  const explicitRound = Number(payload.round)
  if (Number.isFinite(explicitRound)) {
    return explicitRound
  }
  const key = Object.keys(payload)[0] || ''
  const normalized = key.toLowerCase()
  if (normalized.includes('round1')) return 1
  if (normalized.includes('round2')) return 2
  if (normalized.includes('round3')) return 3
  if (normalized.includes('round4')) return 4
  return 0
}

export class MpcService {
  private logger: Logger = SingletonLogger.get()
  private manager: MpcManager
  private notificationService: NotificationService

  constructor() {
    this.manager = new MpcManager()
    this.notificationService = new NotificationService()
  }

  private nowEpoch(): string {
    return String(Date.now())
  }

  private async writeAuditLog(
    walletId: string,
    sessionId: string,
    action: string,
    actor: string,
    message: string,
    metadata?: unknown
  ) {
    try {
      const log = convertMpcAuditLogTo({
        id: uuidv4(),
        walletId,
        sessionId,
        level: 'info',
        action,
        actor,
        message,
        time: this.nowEpoch(),
        metadata: metadata ?? {}
      })
      await this.manager.saveAuditLog(log)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown'
      this.logger.warn(`mpc audit log failed: ${errMsg}`)
    }
  }

  private emitEvent(sessionId: string, type: string, data: unknown) {
    try {
      publishMpcEvent(sessionId, {
        type,
        sessionId,
        data,
        timestamp: Date.now()
      })
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown'
      this.logger.warn(`mpc event publish failed: ${errMsg}`)
    }
  }

  private async notifySessionInvited(session: MpcSession, actor: string) {
    if (session.type !== 'keygen') {
      return
    }
    const actorAddress = normalizeAddress(actor || '')
    const recipients = Array.from(
      new Set(
        session.participants
          .map((participant) => normalizeAddress(participant || ''))
          .filter((participant) => participant && participant !== actorAddress)
      )
    )
    if (recipients.length === 0) {
      return
    }

    await safelyRunNotificationTask(async () => {
      await this.notificationService.create({
        type: 'mpc.keygen.invited',
        source: 'mpc',
        subjectType: 'mpc.session',
        subjectId: session.id,
        actor: actorAddress,
        audienceType: 'wallet-address',
        recipients,
        level: 'info',
        title: 'MPC 钱包创建邀请',
        body: '你被邀请参与 MPC 钱包密钥生成。',
        payload: {
          sessionId: session.id,
          name: session.name,
          walletId: session.walletId,
          sessionType: session.type,
          threshold: session.threshold,
          participants: session.participants,
          curve: session.curve,
          keyVersion: session.keyVersion,
          shareVersion: session.shareVersion,
          inviter: actorAddress,
          expiresAt: session.expiresAt || '',
        },
        expiresAt: session.expiresAt || undefined,
      })
    })
  }

  private async notifySessionCancelled(session: MpcSession, actor: string) {
    if (session.type !== 'keygen') {
      return
    }
    const actorAddress = normalizeAddress(actor || '')
    const recipients = Array.from(
      new Set(
        session.participants
          .map((participant) => normalizeAddress(participant || ''))
          .filter((participant) => participant && participant !== actorAddress)
      )
    )
    if (recipients.length === 0) {
      return
    }

    await safelyRunNotificationTask(async () => {
      await this.notificationService.create({
        type: 'mpc.keygen.cancelled',
        source: 'mpc',
        subjectType: 'mpc.session',
        subjectId: session.id,
        actor: actorAddress,
        audienceType: 'wallet-address',
        recipients,
        level: 'info',
        title: 'MPC 钱包创建已取消',
        body: '发起人已取消 MPC 钱包密钥生成。',
        payload: {
          sessionId: session.id,
          name: session.name,
          walletId: session.walletId,
          sessionType: session.type,
          threshold: session.threshold,
          participants: session.participants,
          curve: session.curve,
          keyVersion: session.keyVersion,
          shareVersion: session.shareVersion,
          inviter: actorAddress,
          cancelledBy: actorAddress,
          cancelledAt: this.nowEpoch(),
        },
        expiresAt: session.expiresAt || undefined,
      })
    })
  }

  private isExpired(expiresAt?: string) {
    if (!expiresAt) return false
    const numeric = Number(expiresAt)
    if (!Number.isFinite(numeric) || numeric <= 0) return false
    return Date.now() > numeric
  }

  private ensureActorAccess(participants: MpcSessionParticipant[], actor: string) {
    const normalized = normalizeAddress(actor)
    const addresses = participants
      .map((participant) => extractEthAddress(participant.identity))
      .filter((value): value is string => Boolean(value))
    if (addresses.length === 0) {
      return true
    }
    return addresses.some((address) => normalizeAddress(address) === normalized)
  }

  private ensureActorSessionAccess(session: MpcSession, participants: MpcSessionParticipant[], actor: string) {
    const normalized = normalizeAddress(actor || '')
    if (!normalized) {
      return false
    }
    const sessionParticipants = session.participants
      .map((participant) => normalizeAddress(participant || ''))
      .filter(Boolean)
    if (sessionParticipants.includes(normalized)) {
      return true
    }
    return this.ensureActorAccess(participants, actor)
  }

  async listInvites(actor: string, pageInput = 1, pageSizeInput = 20) {
    const actorAddress = normalizeAddress(actor || '')
    const page = Math.max(Number.isFinite(pageInput) ? Math.floor(pageInput) : 1, 1)
    const pageSize = Math.min(Math.max(Number.isFinite(pageSizeInput) ? Math.floor(pageSizeInput) : 20, 1), 100)
    const sessions = (await this.manager.listSessions())
      .map(convertMpcSessionFrom)
      .filter((session) => {
        if (session.type !== 'keygen') return false
        if (session.status === 'cancelled' || session.status === 'expired') return false
        const participants = session.participants.map((participant) => normalizeAddress(participant || ''))
        if (!participants.includes(actorAddress)) return false
        return participants[0] !== actorAddress
      })

    const total = sessions.length
    const items = sessions.slice((page - 1) * pageSize, page * pageSize).map((session): MpcInviteListItem => {
      const participants = session.participants.map((participant) => normalizeAddress(participant || '')).filter(Boolean)
      const inviter = participants[0] || ''
      return {
        uid: session.id,
        type: 'mpc.keygen.invited',
        source: 'mpc',
        subjectType: 'mpc.session',
        subjectId: session.id,
        actor: inviter,
        title: session.name,
        payload: {
          sessionId: session.id,
          name: session.name,
          walletId: session.walletId,
          sessionType: session.type,
          threshold: session.threshold,
          participants: session.participants,
          curve: session.curve,
          keyVersion: session.keyVersion,
          shareVersion: session.shareVersion,
          inviter,
          expiresAt: session.expiresAt || '',
        },
        session,
      }
    })

    return {
      items,
      page: {
        total,
        page,
        pageSize,
      },
    }
  }

  async createSession(input: CreateMpcSessionInput, actor: string): Promise<MpcSession> {
    if (!SESSION_TYPES.has(input.type)) {
      throw new Error('INVALID_SESSION_TYPE')
    }
    const name = String(input.name || '').trim()
    if (!name) {
      throw new Error('MISSING_WALLET_NAME')
    }
    if (!input.walletId) {
      throw new Error('MISSING_WALLET_ID')
    }
    if (!Number.isFinite(input.threshold) || input.threshold <= 0) {
      throw new Error('INVALID_THRESHOLD')
    }
    if (!Array.isArray(input.participants) || input.participants.length === 0) {
      throw new Error('MISSING_PARTICIPANTS')
    }
    if (input.threshold > input.participants.length) {
      throw new Error('THRESHOLD_EXCEEDS_PARTICIPANTS')
    }

    const sessionId = input.id || uuidv4()
    const existing = await this.manager.getSession(sessionId)
    if (existing) {
      throw new Error('SESSION_EXISTS')
    }

    const now = this.nowEpoch()
    const session: MpcSession = {
      id: sessionId,
      name,
      type: input.type,
      walletId: input.walletId,
      threshold: input.threshold,
      participants: input.participants,
      status: 'created',
      round: 0,
      curve: input.curve || 'secp256k1',
      keyVersion: normalizeMpcVersion(input.keyVersion),
      shareVersion: normalizeMpcVersion(input.shareVersion),
      createdAt: now,
      expiresAt: input.expiresAt || ''
    }

    const sessionDO = convertMpcSessionTo(session)
    await this.manager.saveSession(sessionDO)
    await this.writeAuditLog(session.walletId, session.id, 'session-created', actor, 'session created', {
      type: session.type,
      threshold: session.threshold,
      participants: session.participants
    })
    this.emitEvent(session.id, 'session-update', {
      status: session.status,
      round: session.round
    })
    await this.notifySessionInvited(session, actor)
    return convertMpcSessionFrom(sessionDO)
  }

  async cancelSession(sessionId: string, actor: string): Promise<MpcSession> {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    const session = convertMpcSessionFrom(sessionDO)
    if (session.type !== 'keygen') {
      throw new Error('SESSION_NOT_CANCELLABLE')
    }
    const actorAddress = normalizeAddress(actor)
    const participants = session.participants.map((participant) => normalizeAddress(participant || ''))
    if (!actorAddress || participants[0] !== actorAddress) {
      throw new Error('FORBIDDEN')
    }
    if (session.status === 'cancelled') {
      return session
    }
    if (!CANCELLABLE_SESSION_STATUSES.has(session.status)) {
      throw new Error('SESSION_NOT_CANCELLABLE')
    }

    const updatedDO = await this.manager.updateSession(sessionId, { status: 'cancelled' })
    const updated = updatedDO ? convertMpcSessionFrom(updatedDO) : { ...session, status: 'cancelled' }
    await this.writeAuditLog(updated.walletId, updated.id, 'session-cancelled', actor, 'session cancelled', {
      type: updated.type,
      threshold: updated.threshold,
      participants: updated.participants,
    })
    this.emitEvent(updated.id, 'session-update', {
      status: updated.status,
      round: updated.round,
    })
    await this.notifySessionCancelled(updated, actor)
    return updated
  }

  async getSession(sessionId: string, actor: string): Promise<MpcSessionDetail> {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    const session = convertMpcSessionFrom(sessionDO)
    const participants = (await this.manager.listParticipants(sessionId)).map(convertMpcParticipantFrom)
    if (!this.ensureActorSessionAccess(session, participants, actor)) {
      throw new Error('FORBIDDEN')
    }
    return {
      ...session,
      joinedParticipants: participants,
      joinedCount: participants.length
    }
  }

  async joinSession(sessionId: string, input: JoinMpcSessionInput, actor: string) {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    if (this.isExpired(sessionDO.expiresAt)) {
      if (sessionDO.status !== 'expired') {
        await this.manager.updateSession(sessionId, { status: 'expired' })
      }
      throw new Error('SESSION_EXPIRED')
    }

    const session = convertMpcSessionFrom(sessionDO)
    if (session.status === 'cancelled') {
      throw new Error('SESSION_CANCELLED')
    }
    if (session.participants.length > 0 && !session.participants.includes(input.participantId)) {
      throw new Error('PARTICIPANT_NOT_ALLOWED')
    }

    const actorAddress = normalizeAddress(actor)
    const identityAddress = extractEthAddress(input.identity)
    if (identityAddress && normalizeAddress(identityAddress) !== actorAddress) {
      throw new Error('IDENTITY_MISMATCH')
    }

    const existing = await this.manager.getParticipant(sessionId, input.participantId)
    if (existing) {
      const existingIdentity = extractEthAddress(existing.identity)
      if (existingIdentity && normalizeAddress(existingIdentity) !== actorAddress) {
        throw new Error('FORBIDDEN')
      }
      return {
        participant: convertMpcParticipantFrom(existing),
        session: await this.getSession(sessionId, actor)
      }
    }

    const now = this.nowEpoch()
    const participant: MpcSessionParticipant = {
      sessionId,
      participantId: input.participantId,
      deviceId: input.deviceId,
      identity: input.identity,
      e2ePublicKey: input.e2ePublicKey,
      signingPublicKey: input.signingPublicKey || '',
      status: 'active',
      joinedAt: now
    }

    const participantDO = convertMpcParticipantTo(participant)
    const saved = await this.manager.saveParticipant(participantDO)

    const joined = await this.manager.listParticipants(sessionId)
    const joinedCount = joined.length
    let nextStatus = session.status
    if (nextStatus === 'created') {
      nextStatus = 'invited'
    }
    if (joinedCount >= session.threshold) {
      nextStatus = 'ready'
    }
    if (nextStatus !== session.status) {
      await this.manager.updateSession(sessionId, { status: nextStatus })
    }

    await this.writeAuditLog(session.walletId, session.id, 'participant-joined', actor, 'participant joined', {
      participantId: input.participantId,
      deviceId: input.deviceId
    })
    this.emitEvent(session.id, 'participant-joined', {
      participantId: input.participantId,
      deviceId: input.deviceId
    })
    if (nextStatus !== session.status) {
      this.emitEvent(session.id, 'session-update', {
        status: nextStatus,
        round: session.round
      })
    }

    return {
      participant: convertMpcParticipantFrom(saved),
      session: await this.getSession(sessionId, actor)
    }
  }

  async sendMessage(sessionId: string, input: SendMpcMessageInput, actor: string): Promise<MpcMessage> {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    if (this.isExpired(sessionDO.expiresAt)) {
      if (sessionDO.status !== 'expired') {
        await this.manager.updateSession(sessionId, { status: 'expired' })
      }
      throw new Error('SESSION_EXPIRED')
    }

    const senderId = input.from
    const participantDO = await this.manager.getParticipant(sessionId, senderId)
    if (!participantDO) {
      throw new Error('PARTICIPANT_NOT_JOINED')
    }

    const identityAddress = extractEthAddress(participantDO.identity)
    if (identityAddress && normalizeAddress(identityAddress) !== normalizeAddress(actor)) {
      throw new Error('FORBIDDEN')
    }

    const existingById = await this.manager.getMessageById(input.id)
    if (existingById) {
      return convertMpcMessageFrom(existingById)
    }

    const seq = input.seq ?? 0
    if (seq > 0) {
      const existingBySeq = await this.manager.getMessageBySeq(sessionId, senderId, seq)
      if (existingBySeq) {
        return convertMpcMessageFrom(existingBySeq)
      }
    }

    const now = this.nowEpoch()
    const message: MpcMessage = {
      id: input.id,
      sessionId,
      sender: senderId,
      receiver: input.to || '',
      round: input.round ?? 0,
      type: input.type,
      seq,
      envelope: input.envelope,
      createdAt: now
    }

    const messageDO = convertMpcMessageTo(message)
    const saved = await this.manager.saveMessage(messageDO)

    const session = convertMpcSessionFrom(sessionDO)
    let updated = false
    const nextRound = Math.max(session.round || 0, message.round || 0)
    let nextStatus = session.status
    if (nextStatus === 'created' || nextStatus === 'invited' || nextStatus === 'ready') {
      nextStatus = 'rounds'
    }
    if (nextStatus !== session.status || nextRound !== session.round) {
      await this.manager.updateSession(sessionId, { status: nextStatus, round: nextRound })
      updated = true
    }

    await this.writeAuditLog(session.walletId, session.id, 'message-sent', actor, 'message delivered', {
      messageId: input.id,
      sender: senderId,
      round: message.round,
      type: message.type
    })
    this.emitEvent(session.id, 'message', convertMpcMessageFrom(saved))

    if (updated) {
      await this.writeAuditLog(session.walletId, session.id, 'session-updated', actor, 'session updated', {
        status: nextStatus,
        round: nextRound
      })
      this.emitEvent(session.id, 'session-update', { status: nextStatus, round: nextRound })
    }

    return convertMpcMessageFrom(saved)
  }

  async sendWireMessage(sessionId: string, input: SendMpcWireMessageInput, actor: string): Promise<MpcMessage> {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    if (this.isExpired(sessionDO.expiresAt)) {
      if (sessionDO.status !== 'expired') {
        await this.manager.updateSession(sessionId, { status: 'expired' })
      }
      throw new Error('SESSION_EXPIRED')
    }

    const session = convertMpcSessionFrom(sessionDO)
    const protocolVersion = Number(input.protocol_version)
    if (protocolVersion !== MPC_WIRE_PROTOCOL_VERSION) {
      throw new Error('INVALID_MPC_MESSAGE')
    }
    const engine = String(input.engine || '').trim()
    if (engine !== MPC_WIRE_ENGINE) {
      throw new Error('INVALID_MPC_MESSAGE')
    }
    const envelopeSessionId = String(input.session_id ?? '').trim()
    if (envelopeSessionId && envelopeSessionId !== sessionId) {
      throw new Error('INVALID_MPC_MESSAGE')
    }
    const protocol = String(input.protocol || '').trim()
    if (!MPC_WIRE_PROTOCOLS.has(protocol)) {
      throw new Error('INVALID_MPC_MESSAGE')
    }
    const requestId = String(input.request_id ?? '').trim()
    const senderIndex = Number(input.sender_index)
    if (!Number.isInteger(senderIndex) || senderIndex < 0 || senderIndex >= session.participants.length) {
      throw new Error('INVALID_MPC_PARTICIPANT_INDEX')
    }
    if (input.payload === undefined || input.payload === null) {
      throw new Error('INVALID_MPC_MESSAGE')
    }

    const senderParticipantId = String(session.participants[senderIndex] || '').trim()
    if (!senderParticipantId) {
      throw new Error('INVALID_MPC_PARTICIPANT_INDEX')
    }
    const participantDO = await this.manager.getParticipant(sessionId, senderParticipantId)
    if (!participantDO) {
      throw new Error('PARTICIPANT_NOT_JOINED')
    }
    const identityAddress = extractEthAddress(participantDO.identity)
    if (identityAddress && normalizeAddress(identityAddress) !== normalizeAddress(actor)) {
      throw new Error('FORBIDDEN')
    }

    const audience = parseWireAudience(input.audience)
    if (audience.recipientIndex !== undefined) {
      if (audience.recipientIndex >= session.participants.length) {
        throw new Error('INVALID_MPC_PARTICIPANT_INDEX')
      }
      if (audience.recipientIndex === senderIndex) {
        throw new Error('INVALID_MPC_MESSAGE_AUDIENCE')
      }
    }

    const saved = await this.manager.saveWireMessageWithNextSequence(sessionId, (seq) => {
      const now = this.nowEpoch()
      const envelope = {
        protocol_version: MPC_WIRE_PROTOCOL_VERSION,
        engine: MPC_WIRE_ENGINE,
        session_id: sessionId,
        protocol,
        ...(requestId ? { request_id: requestId } : {}),
        sequence: seq,
        sender_index: senderIndex,
        audience: audience.recipientIndex === undefined
          ? 'all-parties'
          : { 'one-party': { recipient_index: audience.recipientIndex } },
        payload: input.payload,
      }
      return convertMpcMessageTo({
        id: uuidv4(),
        sessionId,
        sender: String(senderIndex),
        receiver: audience.receiver,
        round: inferWireRound(input.payload),
        type: protocol,
        seq,
        envelope,
        createdAt: now,
      })
    })
    const output = convertMpcMessageFrom(saved)
    let updated = false
    const nextRound = Math.max(session.round || 0, output.round || 0)
    let nextStatus = session.status
    if (nextStatus === 'created' || nextStatus === 'invited' || nextStatus === 'ready') {
      nextStatus = 'rounds'
    }
    if (nextStatus !== session.status || nextRound !== session.round) {
      await this.manager.updateSession(sessionId, { status: nextStatus, round: nextRound })
      updated = true
    }

    await this.writeAuditLog(session.walletId, session.id, 'message-sent', actor, 'wire message delivered', {
      messageId: output.id,
      senderIndex,
      receiver: audience.receiver,
      protocol,
      seq: output.seq,
    })
    this.emitEvent(session.id, 'message', output)

    if (updated) {
      await this.writeAuditLog(session.walletId, session.id, 'session-updated', actor, 'session updated', {
        status: nextStatus,
        round: nextRound,
      })
      this.emitEvent(session.id, 'session-update', { status: nextStatus, round: nextRound })
    }

    return output
  }

  async completeKeygenSession(sessionId: string, input: CompleteMpcKeygenInput, actor: string): Promise<MpcSessionDetail> {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    if (this.isExpired(sessionDO.expiresAt)) {
      if (sessionDO.status !== 'expired') {
        await this.manager.updateSession(sessionId, { status: 'expired' })
      }
      throw new Error('SESSION_EXPIRED')
    }

    const session = convertMpcSessionFrom(sessionDO)
    if (session.type !== 'keygen') {
      throw new Error('INVALID_SESSION_TYPE')
    }
    const participantDO = await this.manager.getParticipant(sessionId, input.participantId)
    if (!participantDO) {
      throw new Error('PARTICIPANT_NOT_JOINED')
    }
    const identityAddress = extractEthAddress(participantDO.identity)
    if (identityAddress && normalizeAddress(identityAddress) !== normalizeAddress(actor)) {
      throw new Error('FORBIDDEN')
    }

    const address = String(input.result?.address || '').trim()
    const publicKey = String(input.result?.publicKey || input.result?.groupPublicKey || '').trim()
    if (!address || !publicKey) {
      throw new Error('MISSING_KEYGEN_RESULT')
    }

    const result = {
      address,
      publicKey,
      groupPublicKey: String(input.result.groupPublicKey || publicKey).trim(),
      chainCode: String(input.result.chainCode || '').trim(),
      curve: String(input.result.curve || session.curve || 'secp256k1').trim(),
      keyVersion: input.result.keyVersion ?? session.keyVersion,
      shareVersion: input.result.shareVersion ?? session.shareVersion,
    }
    const keyVersion = normalizeMpcVersion(result.keyVersion, normalizeMpcVersion(session.keyVersion))
    const shareVersion = normalizeMpcVersion(result.shareVersion, normalizeMpcVersion(session.shareVersion))
    const updatedDO = await this.manager.updateSession(sessionId, {
      status: 'completed',
      resultJson: JSON.stringify(result),
      keyVersion,
      shareVersion,
    })
    const updated = updatedDO ? convertMpcSessionFrom(updatedDO) : {
      ...session,
      status: 'completed',
      result,
      keyVersion,
      shareVersion,
    }

    await this.writeAuditLog(updated.walletId, updated.id, 'keygen-completed', actor, 'keygen completed', {
      participantId: input.participantId,
      address,
      publicKey,
      keyVersion,
      shareVersion,
    })
    this.emitEvent(updated.id, 'session-update', {
      status: updated.status,
      round: updated.round,
      result,
      keyVersion,
      shareVersion,
    })
    const participants = (await this.manager.listParticipants(sessionId)).map(convertMpcParticipantFrom)
    return {
      ...updated,
      joinedParticipants: participants,
      joinedCount: participants.length,
    }
  }

  async createSignRequest(input: CreateMpcSignRequestInput, actor: string) {
    if (!input.walletId) {
      throw new Error('MISSING_WALLET_ID')
    }
    if (!input.sessionId) {
      throw new Error('SESSION_NOT_FOUND')
    }
    const payloadType = String(input.payloadType || '').trim()
    if (!SIGN_PAYLOAD_TYPES.has(payloadType)) {
      throw new Error('INVALID_SIGN_PAYLOAD_TYPE')
    }
    const payloadHash = String(input.payloadHash || '').trim()
    if (!payloadHash) {
      throw new Error('MISSING_SIGN_PAYLOAD_HASH')
    }
    const sessionDO = await this.manager.getSession(input.sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    const session = convertMpcSessionFrom(sessionDO)
    if (session.walletId !== input.walletId) {
      throw new Error('FORBIDDEN')
    }
    const participants = (await this.manager.listParticipants(input.sessionId)).map(convertMpcParticipantFrom)
    if (!this.ensureActorAccess(participants, actor)) {
      throw new Error('FORBIDDEN')
    }

    const requestId = input.id || uuidv4()
    const existing = await this.manager.getSignRequest(requestId)
    if (existing) {
      return convertMpcSignRequestFrom(existing)
    }
    const now = this.nowEpoch()
    const request = convertMpcSignRequestTo({
      id: requestId,
      walletId: input.walletId,
      sessionId: input.sessionId,
      initiator: normalizeAddress(actor),
      payloadType,
      payloadHash,
      payload: input.payload ?? {},
      chainId: Number(input.chainId || 0),
      status: 'pending',
      approvals: [],
      createdAt: now,
    })
    const saved = await this.manager.saveSignRequest(request)
    await this.writeAuditLog(input.walletId, input.sessionId, 'sign-request-created', actor, 'sign request created', {
      requestId,
      payloadType,
      payloadHash,
      chainId: Number(input.chainId || 0),
    })
    this.emitEvent(input.sessionId, 'sign-request', convertMpcSignRequestFrom(saved))
    return convertMpcSignRequestFrom(saved)
  }

  async listSignRequests(actor: string, query: MpcSignRequestListQuery = {}) {
    const page = Math.max(Number.isFinite(query.page) ? Math.floor(query.page!) : 1, 1)
    const pageSize = Math.min(Math.max(Number.isFinite(query.pageSize) ? Math.floor(query.pageSize!) : 20, 1), 100)
    const sessionId = String(query.sessionId || '').trim()
    const walletId = String(query.walletId || '').trim()
    const status = String(query.status || '').trim()

    if (sessionId) {
      const sessionDO = await this.manager.getSession(sessionId)
      if (!sessionDO) {
        throw new Error('SESSION_NOT_FOUND')
      }
      const participants = (await this.manager.listParticipants(sessionId)).map(convertMpcParticipantFrom)
      if (!this.ensureActorAccess(participants, actor)) {
        throw new Error('FORBIDDEN')
      }
    }

    const allowedSessionIds = new Set<string>()
    if (!sessionId) {
      const sessions = (await this.manager.listSessions()).map(convertMpcSessionFrom)
      for (const session of sessions) {
        const participants = (await this.manager.listParticipants(session.id)).map(convertMpcParticipantFrom)
        if (this.ensureActorAccess(participants, actor)) {
          allowedSessionIds.add(session.id)
        }
      }
    }

    const requests = (await this.manager.querySignRequests({
      sessionId: sessionId || undefined,
      walletId: walletId || undefined,
      status: status || undefined,
    }))
      .map(convertMpcSignRequestFrom)
      .filter((request) => sessionId || allowedSessionIds.has(request.sessionId))

    const total = requests.length
    return {
      items: requests.slice((page - 1) * pageSize, page * pageSize),
      page: {
        total,
        page,
        pageSize,
      },
    }
  }

  async completeSignRequest(input: CompleteMpcSignRequestInput, actor: string) {
    const requestId = String(input.requestId || '').trim()
    if (!requestId) {
      throw new Error('SIGN_REQUEST_NOT_FOUND')
    }
    const participantId = normalizeAddress(input.participantId || actor || '')
    const signature = String(input.signature || '').trim()
    if (!signature) {
      throw new Error('MISSING_SIGN_RESULT')
    }
    const requestDO = await this.manager.getSignRequest(requestId)
    if (!requestDO) {
      throw new Error('SIGN_REQUEST_NOT_FOUND')
    }
    const request = convertMpcSignRequestFrom(requestDO)
    const sessionDO = await this.manager.getSession(request.sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    const participants = (await this.manager.listParticipants(request.sessionId)).map(convertMpcParticipantFrom)
    if (!this.ensureActorAccess(participants, actor)) {
      throw new Error('FORBIDDEN')
    }
    if (participantId && !participants.some((participant) => normalizeAddress(participant.participantId) === participantId)) {
      throw new Error('PARTICIPANT_NOT_JOINED')
    }
    const now = this.nowEpoch()
    const completed = convertMpcSignRequestTo({
      ...request,
      status: 'completed',
      signature,
      result: input.result ?? { signature },
      completedAt: now,
    })
    const saved = await this.manager.saveSignRequest(completed)
    const output = convertMpcSignRequestFrom(saved)
    await this.writeAuditLog(request.walletId, request.sessionId, 'sign-request-completed', actor, 'sign request completed', {
      requestId,
      participantId,
    })
    this.emitEvent(request.sessionId, 'sign-request-completed', output)
    return output
  }

  async fetchMessages(
    sessionId: string,
    actor: string,
    since?: number,
    cursor?: string,
    limit?: number,
    afterSeq?: number,
    recipientIndex?: number
  ): Promise<MpcMessagePage> {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }
    const session = convertMpcSessionFrom(sessionDO)

    const participants = (await this.manager.listParticipants(sessionId)).map(convertMpcParticipantFrom)
    if (!this.ensureActorAccess(participants, actor)) {
      throw new Error('FORBIDDEN')
    }
    if (typeof recipientIndex === 'number') {
      if (!Number.isInteger(recipientIndex) || recipientIndex < 0 || recipientIndex >= session.participants.length) {
        throw new Error('INVALID_MPC_PARTICIPANT_INDEX')
      }
      const expectedParticipantId = normalizeAddress(String(session.participants[recipientIndex] || ''))
      const actorAddress = normalizeAddress(actor || '')
      if (expectedParticipantId && expectedParticipantId !== actorAddress) {
        throw new Error('FORBIDDEN')
      }
    }

    let cursorTime: number | undefined
    if (cursor) {
      const numericCursor = Number(cursor)
      if (Number.isFinite(numericCursor)) {
        cursorTime = numericCursor
      } else {
        const existing = await this.manager.getMessageById(cursor)
        if (existing) {
          const msgTime = Number(existing.createdAt)
          if (Number.isFinite(msgTime)) {
            cursorTime = msgTime
          }
        }
      }
    }

    const cappedLimit = Math.min(Math.max(limit ?? 100, 1), 500)
    const messages = await this.manager.queryMessages({
      sessionId,
      since,
      cursorTime,
      afterSeq,
      recipientIndex,
      limit: cappedLimit
    })

    const mapped = messages.map(convertMpcMessageFrom)
    const last = mapped[mapped.length - 1]
    const nextCursor = last ? last.createdAt : undefined
    return { messages: mapped, nextCursor, nextSequence: last?.seq }
  }
}
