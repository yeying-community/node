import { Repository } from 'typeorm'
import { v4 as uuidv4 } from 'uuid'
import { getCurrentUtcString } from '../../common/date'
import { SingletonDataSource } from '../facade/datasource'
import { SingletonLogger } from '../facade/logger'
import { NotificationDO, NotificationInboxDO } from '../mapper/entity'
import {
  publishNotificationEvent,
  type NotificationStreamEvent,
} from './notificationEvents'

export type NotificationCreateInput = {
  type: string
  source: string
  subjectType: string
  subjectId: string
  actor?: string
  audienceType?: string
  recipients: string[]
  level?: 'info' | 'success' | 'warning' | 'error'
  title: string
  body?: string
  payload?: Record<string, unknown>
  expiresAt?: string
}

export type NotificationListQuery = {
  recipient: string
  unreadOnly?: boolean
  page?: number
  pageSize?: number
}

export type NotificationListItem = {
  uid: string
  notificationUid: string
  type: string
  source: string
  subjectType: string
  subjectId: string
  actor: string
  audienceType: string
  audienceIds: string[]
  level: string
  title: string
  body: string
  payload: Record<string, unknown>
  status: string
  isRead: boolean
  readAt: string
  deliveredAt: string
  archivedAt: string
  createdAt: string
  updatedAt: string
  expiresAt: string
}

function normalizeRecipient(input: unknown): string {
  return String(input || '').trim().toLowerCase()
}

function parseJsonObject(input: string): Record<string, unknown> {
  const text = String(input || '').trim()
  if (!text) {
    return {}
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore parse failure
  }
  return {}
}

function parseJsonArray(input: string): string[] {
  const text = String(input || '').trim()
  if (!text) {
    return []
  }
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean)
    }
  } catch {
    // ignore parse failure
  }
  return []
}

function parseBooleanValue(input: unknown): boolean {
  if (typeof input === 'boolean') {
    return input
  }
  if (typeof input === 'number') {
    return input !== 0
  }
  const value = String(input || '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 't'
}

function shortAddress(input: unknown): string {
  const value = String(input || '').trim().toLowerCase()
  if (!value) {
    return ''
  }
  if (value.length <= 12) {
    return value
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export class NotificationService {
  private notificationRepository: Repository<NotificationDO>
  private inboxRepository: Repository<NotificationInboxDO>

  constructor() {
    const dataSource = SingletonDataSource.get()
    this.notificationRepository = dataSource.getRepository(NotificationDO)
    this.inboxRepository = dataSource.getRepository(NotificationInboxDO)
  }

  private normalizeRecipients(input: string[]): string[] {
    return Array.from(new Set((input || []).map((item) => normalizeRecipient(item)).filter(Boolean)))
  }

  private mapListItem(
    inbox: NotificationInboxDO,
    notification: NotificationDO
  ): NotificationListItem {
    return {
      uid: inbox.uid,
      notificationUid: notification.uid,
      type: notification.type,
      source: notification.source,
      subjectType: notification.subjectType,
      subjectId: notification.subjectId,
      actor: notification.actor,
      audienceType: notification.audienceType,
      audienceIds: parseJsonArray(notification.audienceIds),
      level: notification.level,
      title: notification.title,
      body: notification.body,
      payload: parseJsonObject(notification.payload),
      status: notification.status,
      isRead: Boolean(inbox.isRead),
      readAt: inbox.readAt || '',
      deliveredAt: inbox.deliveredAt || '',
      archivedAt: inbox.archivedAt || '',
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      expiresAt: notification.expiresAt || '',
    }
  }

  async create(input: NotificationCreateInput): Promise<NotificationDO | null> {
    const recipients = this.normalizeRecipients(input.recipients)
    if (!input.type || !input.source || !input.subjectType || !input.subjectId || !input.title) {
      throw new Error('Invalid notification input')
    }
    if (recipients.length === 0) {
      return null
    }

    const now = getCurrentUtcString()
    const notification = this.notificationRepository.create({
      uid: uuidv4(),
      type: input.type,
      source: input.source,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      actor: String(input.actor || '').trim().toLowerCase(),
      audienceType: String(input.audienceType || 'user').trim() || 'user',
      audienceIds: JSON.stringify(recipients),
      level: String(input.level || 'info').trim() || 'info',
      title: String(input.title || '').trim(),
      body: String(input.body || '').trim(),
      payload: JSON.stringify(input.payload || {}),
      status: 'delivered',
      createdAt: now,
      updatedAt: now,
      expiresAt: String(input.expiresAt || '').trim(),
    })

    await this.notificationRepository.save(notification)

    const inboxes = recipients.map((recipient) =>
      this.inboxRepository.create({
        uid: uuidv4(),
        notificationUid: notification.uid,
        recipient,
        recipientType: 'user',
        isRead: false,
        readAt: '',
        deliveredAt: now,
        archivedAt: '',
        createdAt: now,
        updatedAt: now,
      })
    )
    await this.inboxRepository.save(inboxes)

    for (const recipient of recipients) {
      const unreadCount = await this.getUnreadCount(recipient)
      this.publish({
        event: 'notification.created',
        recipient,
        notificationUid: notification.uid,
        unreadCount,
        timestamp: Date.now(),
      })
    }
    return notification
  }

  async list(query: NotificationListQuery) {
    const recipient = normalizeRecipient(query.recipient)
    if (!recipient) {
      return { items: [], page: { total: 0, page: 1, pageSize: 20 } }
    }
    const page = Number.isFinite(query.page) && (query.page as number) > 0 ? Math.trunc(query.page as number) : 1
    const pageSize =
      Number.isFinite(query.pageSize) && (query.pageSize as number) > 0
        ? Math.min(Math.trunc(query.pageSize as number), 100)
        : 20

    const qb = this.inboxRepository
      .createQueryBuilder('inbox')
      .innerJoin(NotificationDO, 'notification', 'notification.uid = inbox.notification_uid')
      .where('LOWER(inbox.recipient) = :recipient', { recipient })
      .andWhere("COALESCE(inbox.archived_at, '') = ''")

    if (query.unreadOnly) {
      qb.andWhere('inbox.is_read = :isRead', { isRead: false })
    }

    const total = await qb.clone().getCount()
    const rows = await qb
      .select([
        'inbox.uid AS inbox_uid',
        'inbox.notification_uid AS inbox_notification_uid',
        'inbox.is_read AS inbox_is_read',
        'inbox.read_at AS inbox_read_at',
        'inbox.delivered_at AS inbox_delivered_at',
        'inbox.archived_at AS inbox_archived_at',
        'inbox.created_at AS inbox_created_at',
        'inbox.updated_at AS inbox_updated_at',
        'notification.uid AS notification_uid',
        'notification.type AS notification_type',
        'notification.source AS notification_source',
        'notification.subject_type AS notification_subject_type',
        'notification.subject_id AS notification_subject_id',
        'notification.actor AS notification_actor',
        'notification.audience_type AS notification_audience_type',
        'notification.audience_ids AS notification_audience_ids',
        'notification.level AS notification_level',
        'notification.title AS notification_title',
        'notification.body AS notification_body',
        'notification.payload AS notification_payload',
        'notification.status AS notification_status',
        'notification.created_at AS notification_created_at',
        'notification.updated_at AS notification_updated_at',
        'notification.expires_at AS notification_expires_at',
      ])
      .orderBy('notification.created_at', 'DESC')
      .addOrderBy('inbox.created_at', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<Record<string, unknown>>()

    const items: NotificationListItem[] = rows.map((row) =>
      this.mapListItem(
        {
          uid: String(row.inbox_uid || ''),
          notificationUid: String(row.inbox_notification_uid || ''),
          recipient,
          recipientType: 'user',
          isRead: parseBooleanValue(row.inbox_is_read),
          readAt: String(row.inbox_read_at || ''),
          deliveredAt: String(row.inbox_delivered_at || ''),
          archivedAt: String(row.inbox_archived_at || ''),
          createdAt: String(row.inbox_created_at || ''),
          updatedAt: String(row.inbox_updated_at || ''),
        } as NotificationInboxDO,
        {
          uid: String(row.notification_uid || ''),
          type: String(row.notification_type || ''),
          source: String(row.notification_source || ''),
          subjectType: String(row.notification_subject_type || ''),
          subjectId: String(row.notification_subject_id || ''),
          actor: String(row.notification_actor || ''),
          audienceType: String(row.notification_audience_type || ''),
          audienceIds: String(row.notification_audience_ids || ''),
          level: String(row.notification_level || ''),
          title: String(row.notification_title || ''),
          body: String(row.notification_body || ''),
          payload: String(row.notification_payload || ''),
          status: String(row.notification_status || ''),
          createdAt: String(row.notification_created_at || ''),
          updatedAt: String(row.notification_updated_at || ''),
          expiresAt: String(row.notification_expires_at || ''),
        } as NotificationDO
      )
    )
    return {
      items,
      page: {
        total,
        page,
        pageSize,
      },
    }
  }

  async getUnreadCount(recipientInput: string): Promise<number> {
    const recipient = normalizeRecipient(recipientInput)
    if (!recipient) {
      return 0
    }
    return await this.inboxRepository.count({
      where: {
        recipient,
        isRead: false,
        archivedAt: '',
      },
    })
  }

  async markRead(notificationUidInput: string, recipientInput: string): Promise<NotificationInboxDO | null> {
    const recipient = normalizeRecipient(recipientInput)
    const notificationUid = String(notificationUidInput || '').trim()
    if (!recipient || !notificationUid) {
      return null
    }

    const inbox = await this.inboxRepository.findOneBy({
      notificationUid,
      recipient,
      archivedAt: '',
    })
    if (!inbox) {
      return null
    }
    if (!inbox.isRead) {
      inbox.isRead = true
      inbox.readAt = getCurrentUtcString()
      inbox.updatedAt = inbox.readAt
      await this.inboxRepository.save(inbox)
      const unreadCount = await this.getUnreadCount(recipient)
      this.publish({
        event: 'notification.read',
        recipient,
        notificationUid,
        unreadCount,
        timestamp: Date.now(),
      })
    }
    return inbox
  }

  async markAllRead(recipientInput: string): Promise<number> {
    const recipient = normalizeRecipient(recipientInput)
    if (!recipient) {
      return 0
    }
    const inboxes = await this.inboxRepository.findBy({
      recipient,
      isRead: false,
      archivedAt: '',
    })
    if (!inboxes || inboxes.length === 0) {
      return 0
    }
    const now = getCurrentUtcString()
    for (const inbox of inboxes) {
      inbox.isRead = true
      inbox.readAt = now
      inbox.updatedAt = now
    }
    await this.inboxRepository.save(inboxes)
    this.publish({
      event: 'notification.read',
      recipient,
      notificationUid: '*',
      unreadCount: 0,
      timestamp: Date.now(),
    })
    return inboxes.length
  }

  async notifyAuditApproved(input: {
    auditId: string
    applicant: string
    actor?: string
    targetName?: string
    auditType?: string
    targetUid?: string
    targetDid?: string
    targetVersion?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.applicant)
    if (!recipient) {
      return
    }
    await this.create({
      type: 'audit.approved',
      source: 'audit',
      subjectType: 'audit',
      subjectId: input.auditId,
      actor: input.actor,
      recipients: [recipient],
      level: 'success',
      title: `${String(input.targetName || '目标').trim() || '目标'} 审批已通过`,
      body: `你提交的 ${String(input.targetName || '目标').trim() || '目标'} 已审批通过。`,
      payload: {
        auditId: input.auditId,
        auditType: String(input.auditType || '').trim(),
        targetName: String(input.targetName || '').trim(),
        targetUid: String(input.targetUid || '').trim(),
        targetDid: String(input.targetDid || '').trim(),
        targetVersion: Number.isFinite(input.targetVersion) ? Number(input.targetVersion) : undefined,
      },
    })
  }

  async notifyAuditCreated(input: {
    auditId: string
    recipients: string[]
    applicant?: string
    actor?: string
    targetName?: string
    auditType?: string
    targetUid?: string
    targetDid?: string
    targetVersion?: number
  }): Promise<void> {
    const recipients = (input.recipients || []).map((item) => normalizeRecipient(item)).filter(Boolean)
    if (recipients.length === 0) {
      return
    }
    const targetName = String(input.targetName || '目标').trim() || '目标'
    const applicantLabel = shortAddress(input.applicant)
    await this.create({
      type: 'audit.created',
      source: 'audit',
      subjectType: 'audit',
      subjectId: input.auditId,
      actor: input.actor,
      recipients,
      level: 'info',
      title: `${targetName} 待你审批`,
      body: applicantLabel
        ? `申请人 ${applicantLabel} 提交了 ${targetName}，请及时处理。`
        : `${targetName} 已提交审批，请及时处理。`,
      payload: {
        auditId: input.auditId,
        auditType: String(input.auditType || '').trim(),
        applicant: String(input.applicant || '').trim(),
        targetName: String(input.targetName || '').trim(),
        targetUid: String(input.targetUid || '').trim(),
        targetDid: String(input.targetDid || '').trim(),
        targetVersion: Number.isFinite(input.targetVersion) ? Number(input.targetVersion) : undefined,
      },
    })
  }

  async notifyAuditRejected(input: {
    auditId: string
    applicant: string
    actor?: string
    targetName?: string
    auditType?: string
    targetUid?: string
    targetDid?: string
    targetVersion?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.applicant)
    if (!recipient) {
      return
    }
    await this.create({
      type: 'audit.rejected',
      source: 'audit',
      subjectType: 'audit',
      subjectId: input.auditId,
      actor: input.actor,
      recipients: [recipient],
      level: 'warning',
      title: `${String(input.targetName || '目标').trim() || '目标'} 审批未通过`,
      body: `你提交的 ${String(input.targetName || '目标').trim() || '目标'} 已被驳回。`,
      payload: {
        auditId: input.auditId,
        auditType: String(input.auditType || '').trim(),
        targetName: String(input.targetName || '').trim(),
        targetUid: String(input.targetUid || '').trim(),
        targetDid: String(input.targetDid || '').trim(),
        targetVersion: Number.isFinite(input.targetVersion) ? Number(input.targetVersion) : undefined,
      },
    })
  }

  async notifyTotpAuthorizeApproved(input: {
    requestId: string
    subject: string
    appId: string
    appName?: string
  }): Promise<void> {
    const recipient = normalizeRecipient(input.subject)
    if (!recipient) {
      return
    }
    const appName = String(input.appName || input.appId || '').trim() || '应用'
    await this.create({
      type: 'totp.request_approved',
      source: 'totp',
      subjectType: 'authorize_request',
      subjectId: input.requestId,
      actor: recipient,
      recipients: [recipient],
      level: 'success',
      title: '授权已确认',
      body: `${appName} 的授权已确认。`,
      payload: {
        requestId: input.requestId,
        appId: input.appId,
        appName,
      },
    })
  }

  async notifyTotpAuthorizeExpired(input: {
    requestId: string
    subject: string
    appId: string
    appName?: string
  }): Promise<void> {
    const recipient = normalizeRecipient(input.subject)
    if (!recipient) {
      return
    }
    const appName = String(input.appName || input.appId || '').trim() || '应用'
    await this.create({
      type: 'totp.request_expired',
      source: 'totp',
      subjectType: 'authorize_request',
      subjectId: input.requestId,
      actor: 'system',
      recipients: [recipient],
      level: 'warning',
      title: '授权已过期',
      body: `${appName} 的授权请求已过期，请重新发起授权。`,
      payload: {
        requestId: input.requestId,
        appId: input.appId,
        appName,
      },
    })
  }

  private publish(event: NotificationStreamEvent) {
    publishNotificationEvent(event)
  }
}

export async function safelyRunNotificationTask(task: () => Promise<void>): Promise<void> {
  try {
    await task()
  } catch (error) {
    const logger = SingletonLogger.get()
    logger.warn('notification task failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
