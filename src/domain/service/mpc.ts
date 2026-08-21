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

export type MpcMessagePage = {
  messages: MpcMessage[]
  nextCursor?: string
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

export type MpcSessionDetail = MpcSession & {
  joinedParticipants: MpcSessionParticipant[]
  joinedCount: number
}

const SESSION_TYPES = new Set(['keygen', 'sign', 'refresh'])
const CANCELLABLE_SESSION_STATUSES = new Set(['created', 'invited'])

function normalizeAddress(value: string) {
  return value.trim().toLowerCase()
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
      keyVersion: input.keyVersion ?? 0,
      shareVersion: input.shareVersion ?? 0,
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
    if (!this.ensureActorAccess(participants, actor)) {
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

  async fetchMessages(
    sessionId: string,
    actor: string,
    since?: number,
    cursor?: string,
    limit?: number
  ): Promise<MpcMessagePage> {
    const sessionDO = await this.manager.getSession(sessionId)
    if (!sessionDO) {
      throw new Error('SESSION_NOT_FOUND')
    }

    const participants = (await this.manager.listParticipants(sessionId)).map(convertMpcParticipantFrom)
    if (!this.ensureActorAccess(participants, actor)) {
      throw new Error('FORBIDDEN')
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
      limit: cappedLimit
    })

    const mapped = messages.map(convertMpcMessageFrom)
    const last = mapped[mapped.length - 1]
    const nextCursor = last ? last.createdAt : undefined
    return { messages: mapped, nextCursor }
  }
}
