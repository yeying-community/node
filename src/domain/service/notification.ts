import { Repository } from 'typeorm'
import { v4 as uuidv4 } from 'uuid'
import { getCurrentUtcString } from '../../common/date'
import { SingletonDataSource } from '../facade/datasource'
import { SingletonLogger } from '../facade/logger'
import { NotificationDO, NotificationInboxDO, NotificationWebhookDO, NotificationDeliveryDO } from '../mapper/entity'
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
  source?: string
  level?: string
  applicationUid?: string
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

export type NotificationWebhookRecord = {
  uid: string
  owner: string
  applicationUid: string
  events: string[]
  targetUrl: string
  secretMasked: string
  enabled: boolean
  lastTriggeredAt: string
  createdAt: string
  updatedAt: string
}

export type NotificationDeliveryRecord = {
  uid: string
  notificationUid: string
  channel: string
  target: string
  status: string
  attemptCount: number
  lastError: string
  deliveredAt: string
  nextRetryAt: string
  createdAt: string
  updatedAt: string
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

function escapeSqlLikeValue(input: string): string {
  return String(input || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

function buildNotificationEventId(createdAt: string, notificationUid: string): string {
  return `${encodeURIComponent(createdAt || '')}|${encodeURIComponent(notificationUid || '')}`
}

function parseNotificationEventId(input: string): { createdAt: string; notificationUid: string } | null {
  const text = String(input || '').trim()
  if (!text) {
    return null
  }
  const separator = text.indexOf('|')
  if (separator <= 0) {
    return { createdAt: text, notificationUid: '' }
  }
  try {
    return {
      createdAt: decodeURIComponent(text.slice(0, separator)),
      notificationUid: decodeURIComponent(text.slice(separator + 1)),
    }
  } catch {
    return null
  }
}

export class NotificationService {
  private notificationRepository: Repository<NotificationDO>
  private inboxRepository: Repository<NotificationInboxDO>
  private webhookRepository: Repository<NotificationWebhookDO>
  private deliveryRepository: Repository<NotificationDeliveryDO>

  constructor() {
    const dataSource = SingletonDataSource.get()
    this.notificationRepository = dataSource.getRepository(NotificationDO)
    this.inboxRepository = dataSource.getRepository(NotificationInboxDO)
    this.webhookRepository = dataSource.getRepository(NotificationWebhookDO)
    this.deliveryRepository = dataSource.getRepository(NotificationDeliveryDO)
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

  buildEventId(item: { createdAt: string; notificationUid: string }): string {
    return buildNotificationEventId(item.createdAt, item.notificationUid)
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

    const deliveryRecords = recipients.map((recipient) =>
      this.deliveryRepository.create({
        notificationUid: notification.uid,
        channel: 'inbox',
        target: recipient,
        status: 'delivered',
        attemptCount: 1,
        lastError: '',
        deliveredAt: now,
        nextRetryAt: '',
        createdAt: now,
        updatedAt: now,
      })
    )
    await this.deliveryRepository.save(deliveryRecords)

    const webhookDeliveries = await this.prepareWebhookDeliveries(notification, now)
    if (webhookDeliveries.length > 0) {
      await this.deliveryRepository.save(webhookDeliveries)
    }

    for (const recipient of recipients) {
      const unreadCount = await this.getUnreadCount(recipient)
      this.publish({
        event: 'notification.created',
        recipient,
        notificationUid: notification.uid,
        unreadCount,
        timestamp: Date.now(),
        id: this.buildEventId({ createdAt: now, notificationUid: notification.uid }),
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
    const source = String(query.source || '').trim()
    if (source) {
      qb.andWhere('notification.source = :source', { source })
    }
    const level = String(query.level || '').trim()
    if (level) {
      qb.andWhere('notification.level = :level', { level })
    }
    const applicationUid = String(query.applicationUid || '').trim()
    if (applicationUid) {
      const applicationUidLike = `%\"applicationUid\":\"${escapeSqlLikeValue(applicationUid)}\"%`
      const targetUidLike = `%\"targetUid\":\"${escapeSqlLikeValue(applicationUid)}\"%`
      const appIdLike = `%\"appId\":\"${escapeSqlLikeValue(applicationUid)}\"%`
      qb.andWhere(
        `(
          (notification.source = :applicationSource AND notification.subject_id = :applicationUid)
          OR (notification.source = :auditSource AND (notification.payload LIKE :applicationUidLike ESCAPE '\\' OR notification.payload LIKE :targetUidLike ESCAPE '\\'))
          OR (notification.source = :totpSource AND (notification.payload LIKE :applicationUidLike ESCAPE '\\' OR notification.payload LIKE :appIdLike ESCAPE '\\'))
        )`,
        {
          applicationSource: 'application',
          auditSource: 'audit',
          totpSource: 'totp',
          applicationUid,
          applicationUidLike,
          targetUidLike,
          appIdLike,
        }
      )
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

  async getByNotificationUid(notificationUidInput: string, recipientInput: string): Promise<NotificationListItem | null> {
    const recipient = normalizeRecipient(recipientInput)
    const notificationUid = String(notificationUidInput || '').trim()
    if (!recipient || !notificationUid) {
      return null
    }
    const row = await this.inboxRepository
      .createQueryBuilder('inbox')
      .innerJoin(NotificationDO, 'notification', 'notification.uid = inbox.notification_uid')
      .where('LOWER(inbox.recipient) = :recipient', { recipient })
      .andWhere('inbox.notification_uid = :notificationUid', { notificationUid })
      .andWhere("COALESCE(inbox.archived_at, '') = ''")
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
      .getRawOne<Record<string, unknown>>()

    if (!row) {
      return null
    }
    return this.mapListItem(
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
  }

  async listCreatedAfterCursor(recipientInput: string, cursorInput: string, limitInput = 100): Promise<NotificationListItem[]> {
    const recipient = normalizeRecipient(recipientInput)
    const cursor = parseNotificationEventId(cursorInput)
    if (!recipient || !cursor?.createdAt) {
      return []
    }
    const limit = Number.isFinite(limitInput) && limitInput > 0 ? Math.min(Math.trunc(limitInput), 200) : 100
    const qb = this.inboxRepository
      .createQueryBuilder('inbox')
      .innerJoin(NotificationDO, 'notification', 'notification.uid = inbox.notification_uid')
      .where('LOWER(inbox.recipient) = :recipient', { recipient })
      .andWhere("COALESCE(inbox.archived_at, '') = ''")
      .andWhere(
        cursor.notificationUid
          ? '(notification.created_at > :createdAt OR (notification.created_at = :createdAt AND notification.uid > :notificationUid))'
          : 'notification.created_at > :createdAt',
        {
          createdAt: cursor.createdAt,
          notificationUid: cursor.notificationUid,
        }
      )

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
      .orderBy('notification.created_at', 'ASC')
      .addOrderBy('notification.uid', 'ASC')
      .limit(limit)
      .getRawMany<Record<string, unknown>>()

    return rows.map((row) =>
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

  async listWebhooks(ownerInput: string): Promise<NotificationWebhookRecord[]> {
    const owner = normalizeRecipient(ownerInput)
    if (!owner) {
      return []
    }
    const rows = await this.webhookRepository.find({
      where: { owner },
      order: { createdAt: 'DESC' },
    })
    return rows.map((row) => this.mapWebhook(row))
  }

  async createWebhook(input: {
    owner: string
    applicationUid?: string
    events?: string[]
    targetUrl: string
    secret?: string
    enabled?: boolean
  }): Promise<NotificationWebhookRecord> {
    const owner = normalizeRecipient(input.owner)
    const targetUrl = String(input.targetUrl || '').trim()
    if (!owner || !targetUrl) {
      throw new Error('Invalid webhook input')
    }
    const now = getCurrentUtcString()
    const secret = String(input.secret || '').trim()
    const entity = this.webhookRepository.create({
      owner,
      applicationUid: String(input.applicationUid || '').trim(),
      eventsJson: JSON.stringify(this.normalizeEventList(input.events)),
      targetUrl,
      secretMasked: this.maskSecret(secret),
      secretCiphertext: secret,
      enabled: input.enabled !== false,
      lastTriggeredAt: '',
      createdAt: now,
      updatedAt: now,
    })
    const saved = await this.webhookRepository.save(entity)
    return this.mapWebhook(saved)
  }

  async updateWebhook(
    uidInput: string,
    ownerInput: string,
    input: {
      applicationUid?: string
      events?: string[]
      targetUrl?: string
      secret?: string
      enabled?: boolean
    }
  ): Promise<NotificationWebhookRecord | null> {
    const owner = normalizeRecipient(ownerInput)
    const uid = String(uidInput || '').trim()
    if (!owner || !uid) {
      return null
    }
    const existing = await this.webhookRepository.findOneBy({ uid, owner })
    if (!existing) {
      return null
    }
    if (input.applicationUid !== undefined) {
      existing.applicationUid = String(input.applicationUid || '').trim()
    }
    if (input.events !== undefined) {
      existing.eventsJson = JSON.stringify(this.normalizeEventList(input.events))
    }
    if (input.targetUrl !== undefined) {
      existing.targetUrl = String(input.targetUrl || '').trim()
    }
    if (input.secret !== undefined) {
      const secret = String(input.secret || '').trim()
      existing.secretCiphertext = secret
      existing.secretMasked = this.maskSecret(secret)
    }
    if (input.enabled !== undefined) {
      existing.enabled = Boolean(input.enabled)
    }
    existing.updatedAt = getCurrentUtcString()
    const saved = await this.webhookRepository.save(existing)
    return this.mapWebhook(saved)
  }

  async deleteWebhook(uidInput: string, ownerInput: string): Promise<boolean> {
    const owner = normalizeRecipient(ownerInput)
    const uid = String(uidInput || '').trim()
    if (!owner || !uid) {
      return false
    }
    const existing = await this.webhookRepository.findOneBy({ uid, owner })
    if (!existing) {
      return false
    }
    await this.webhookRepository.delete({ uid, owner })
    return true
  }

  async listDeliveriesByNotificationUid(notificationUidInput: string): Promise<NotificationDeliveryRecord[]> {
    const notificationUid = String(notificationUidInput || '').trim()
    if (!notificationUid) {
      return []
    }
    const rows = await this.deliveryRepository.find({
      where: { notificationUid },
      order: { createdAt: 'DESC' },
    })
    return rows.map((row) => ({
      uid: row.uid,
      notificationUid: row.notificationUid,
      channel: row.channel,
      target: row.target,
      status: row.status,
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      deliveredAt: row.deliveredAt,
      nextRetryAt: row.nextRetryAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
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

  async notifyApplicationCreated(input: {
    applicationUid: string
    owner: string
    actor?: string
    name?: string
    did?: string
    version?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.owner)
    if (!recipient) {
      return
    }
    const appName = String(input.name || '应用').trim() || '应用'
    await this.create({
      type: 'application.created',
      source: 'application',
      subjectType: 'application',
      subjectId: input.applicationUid,
      actor: input.actor,
      recipients: [recipient],
      level: 'success',
      title: `${appName} 已创建`,
      body: `${appName} 已保存到个人应用，可继续配置并提交上架。`,
      payload: {
        applicationUid: input.applicationUid,
        name: appName,
        did: String(input.did || '').trim(),
        version: Number.isFinite(input.version) ? Number(input.version) : undefined,
      },
    })
  }

  async notifyApplicationUpdated(input: {
    applicationUid: string
    owner: string
    actor?: string
    name?: string
    did?: string
    version?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.owner)
    if (!recipient) {
      return
    }
    const appName = String(input.name || '应用').trim() || '应用'
    await this.create({
      type: 'application.updated',
      source: 'application',
      subjectType: 'application',
      subjectId: input.applicationUid,
      actor: input.actor,
      recipients: [recipient],
      level: 'info',
      title: `${appName} 已更新`,
      body: `${appName} 的基础信息和授权策略已更新。`,
      payload: {
        applicationUid: input.applicationUid,
        name: appName,
        did: String(input.did || '').trim(),
        version: Number.isFinite(input.version) ? Number(input.version) : undefined,
      },
    })
  }

  async notifyApplicationPublished(input: {
    applicationUid: string
    owner: string
    actor?: string
    name?: string
    did?: string
    version?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.owner)
    if (!recipient) {
      return
    }
    const appName = String(input.name || '应用').trim() || '应用'
    await this.create({
      type: 'application.published',
      source: 'application',
      subjectType: 'application',
      subjectId: input.applicationUid,
      actor: input.actor,
      recipients: [recipient],
      level: 'success',
      title: `${appName} 已上架`,
      body: `${appName} 已发布到应用中心，可对外提供接入。`,
      payload: {
        applicationUid: input.applicationUid,
        name: appName,
        did: String(input.did || '').trim(),
        version: Number.isFinite(input.version) ? Number(input.version) : undefined,
      },
    })
  }

  async notifyApplicationUnpublished(input: {
    applicationUid: string
    owner: string
    actor?: string
    name?: string
    did?: string
    version?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.owner)
    if (!recipient) {
      return
    }
    const appName = String(input.name || '应用').trim() || '应用'
    await this.create({
      type: 'application.unpublished',
      source: 'application',
      subjectType: 'application',
      subjectId: input.applicationUid,
      actor: input.actor,
      recipients: [recipient],
      level: 'warning',
      title: `${appName} 已下架`,
      body: `${appName} 已从应用中心下架，外部用户将无法继续发现它。`,
      payload: {
        applicationUid: input.applicationUid,
        name: appName,
        did: String(input.did || '').trim(),
        version: Number.isFinite(input.version) ? Number(input.version) : undefined,
      },
    })
  }

  async notifyApplicationDeleted(input: {
    applicationUid: string
    owner: string
    actor?: string
    name?: string
    did?: string
    version?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.owner)
    if (!recipient) {
      return
    }
    const appName = String(input.name || '应用').trim() || '应用'
    await this.create({
      type: 'application.deleted',
      source: 'application',
      subjectType: 'application',
      subjectId: input.applicationUid,
      actor: input.actor,
      recipients: [recipient],
      level: 'warning',
      title: `${appName} 已删除`,
      body: `${appName} 已从个人应用中移除。`,
      payload: {
        applicationUid: input.applicationUid,
        name: appName,
        did: String(input.did || '').trim(),
        version: Number.isFinite(input.version) ? Number(input.version) : undefined,
      },
    })
  }

  async notifyApplicationConfigUpdated(input: {
    applicationUid: string
    owner: string
    actor?: string
    name?: string
    did?: string
    version?: number
    configCount?: number
  }): Promise<void> {
    const recipient = normalizeRecipient(input.owner)
    if (!recipient) {
      return
    }
    const appName = String(input.name || '应用').trim() || '应用'
    const configCount = Number.isFinite(input.configCount) ? Math.max(0, Number(input.configCount)) : 0
    await this.create({
      type: 'application.config_updated',
      source: 'application',
      subjectType: 'application_config',
      subjectId: input.applicationUid,
      actor: input.actor,
      recipients: [recipient],
      level: 'info',
      title: `${appName} 接入设置已更新`,
      body: configCount > 0 ? `${appName} 的接入设置已更新，共 ${configCount} 项。` : `${appName} 的接入设置已更新。`,
      payload: {
        applicationUid: input.applicationUid,
        name: appName,
        did: String(input.did || '').trim(),
        version: Number.isFinite(input.version) ? Number(input.version) : undefined,
        configCount,
      },
    })
  }

  private publish(event: NotificationStreamEvent) {
    publishNotificationEvent(event)
  }

  private resolveNotificationApplicationUid(notification: Pick<NotificationDO, 'source' | 'subjectId' | 'payload'>): string {
    const payload = parseJsonObject(notification.payload)
    const source = String(notification.source || '').trim()
    if (source === 'application') {
      return String(payload.applicationUid || notification.subjectId || '').trim()
    }
    if (source === 'audit') {
      return String(payload.applicationUid || payload.targetUid || notification.subjectId || '').trim()
    }
    if (source === 'totp') {
      return String(payload.applicationUid || payload.appId || notification.subjectId || '').trim()
    }
    return String(payload.applicationUid || payload.targetUid || payload.appId || notification.subjectId || '').trim()
  }

  private normalizeEventList(input: string[] | undefined): string[] {
    return Array.from(new Set((input || []).map((item) => String(item || '').trim()).filter(Boolean))).sort()
  }

  private maskSecret(secret: string): string {
    const normalized = String(secret || '').trim()
    if (!normalized) {
      return ''
    }
    if (normalized.length <= 6) {
      return `${normalized.slice(0, 1)}***`
    }
    return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`
  }

  private mapWebhook(row: NotificationWebhookDO): NotificationWebhookRecord {
    return {
      uid: row.uid,
      owner: row.owner,
      applicationUid: row.applicationUid,
      events: parseJsonArray(row.eventsJson),
      targetUrl: row.targetUrl,
      secretMasked: row.secretMasked,
      enabled: Boolean(row.enabled),
      lastTriggeredAt: row.lastTriggeredAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private async prepareWebhookDeliveries(notification: NotificationDO, now: string): Promise<NotificationDeliveryDO[]> {
    const audienceIds = parseJsonArray(notification.audienceIds)
    if (audienceIds.length === 0) {
      return []
    }
    const notificationApplicationUid = this.resolveNotificationApplicationUid(notification)
    const rows = await this.webhookRepository.find({
      where: audienceIds.map((owner) => ({ owner })),
    })
    const deliveries: NotificationDeliveryDO[] = []
    for (const row of rows) {
      if (!row.enabled) {
        continue
      }
      const events = parseJsonArray(row.eventsJson)
      if (events.length > 0 && !events.includes(notification.type)) {
        continue
      }
      const webhookApplicationUid = String(row.applicationUid || '').trim()
      if (webhookApplicationUid && webhookApplicationUid !== notificationApplicationUid) {
        continue
      }
      deliveries.push(
        this.deliveryRepository.create({
          notificationUid: notification.uid,
          channel: 'webhook',
          target: row.targetUrl,
          status: 'pending',
          attemptCount: 0,
          lastError: '',
          deliveredAt: '',
          nextRetryAt: '',
          createdAt: now,
          updatedAt: now,
        })
      )
    }
    return deliveries
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
