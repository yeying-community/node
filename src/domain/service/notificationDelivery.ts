import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getCurrentUtcString } from '../../common/date'
import { NotificationRuntimeConfig } from '../../config'
import { getConfig } from '../../config/runtime'
import { getRuntimeSecret } from '../../security/secretVault'
import { SingletonDataSource } from '../facade/datasource'
import { SingletonLogger } from '../facade/logger'
import { NotificationDO, NotificationDeliveryDO, NotificationWebhookDO } from '../mapper/entity'

const WEBHOOK_SECRET_CIPHER_VERSION = 'v1'
const WEBHOOK_SECRET_CONTEXT = Buffer.from('notification-webhook-secret:v1', 'utf8')
const WEBHOOK_SIGNATURE_PREFIX = 'sha256='

type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed'

function parsePositiveNumber(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseNonNegativeNumber(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(input: string): Buffer {
  const normalized = String(input || '').trim().replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4 || 4)) % 4
  return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64')
}

function resolveWebhookSecretMasterKey(): Buffer {
  const configured = String(
    getRuntimeSecret('NOTIFICATION_WEBHOOK_MASTER_KEY') ||
      process.env.NOTIFICATION_WEBHOOK_MASTER_KEY ||
      getConfig<string>('notification.webhookMasterKey') ||
      ''
  ).trim()
  if (!configured) {
    throw new Error('NOTIFICATION_WEBHOOK_MASTER_KEY is required when webhook secret is used')
  }
  return Buffer.from(configured, 'utf8')
}

function deriveWebhookSecretEncryptionKey(masterKey: Buffer): Buffer {
  return crypto.createHash('sha256').update(masterKey).update(WEBHOOK_SECRET_CONTEXT).digest()
}

export function encryptNotificationWebhookSecret(secret: string): string {
  const normalized = String(secret || '').trim()
  if (!normalized) {
    return ''
  }
  const key = deriveWebhookSecretEncryptionKey(resolveWebhookSecretMasterKey())
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(normalized, 'utf8')), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${WEBHOOK_SECRET_CIPHER_VERSION}.${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(ciphertext)}`
}

export function decryptNotificationWebhookSecret(ciphertextInput: string): string {
  const ciphertext = String(ciphertextInput || '').trim()
  if (!ciphertext) {
    return ''
  }
  const [version, ivEncoded, authTagEncoded, payloadEncoded] = ciphertext.split('.')
  if (version !== WEBHOOK_SECRET_CIPHER_VERSION || !ivEncoded || !authTagEncoded || !payloadEncoded) {
    throw new Error('Stored webhook secret is invalid')
  }
  try {
    const key = deriveWebhookSecretEncryptionKey(resolveWebhookSecretMasterKey())
    const iv = fromBase64Url(ivEncoded)
    const authTag = fromBase64Url(authTagEncoded)
    const payload = fromBase64Url(payloadEncoded)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Stored webhook secret is invalid')
  }
}

export function buildNotificationWebhookSignature(timestamp: string, body: string, secret: string): string {
  const payload = `${String(timestamp || '').trim()}.${String(body || '')}`
  return `${WEBHOOK_SIGNATURE_PREFIX}${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
}

function resolveNotificationPolicy() {
  const config = (getConfig<NotificationRuntimeConfig>('notification') || {}) as NotificationRuntimeConfig
  return {
    webhookDeliveryEnabled: config.webhookDeliveryEnabled !== false,
    webhookDeliveryIntervalMs: parsePositiveNumber(config.webhookDeliveryIntervalMs, 15 * 1000),
    webhookDeliveryBatchSize: parsePositiveNumber(config.webhookDeliveryBatchSize, 20),
    webhookDeliveryTimeoutMs: parsePositiveNumber(config.webhookDeliveryTimeoutMs, 10 * 1000),
    webhookClaimTimeoutMs: parsePositiveNumber(config.webhookClaimTimeoutMs, 60 * 1000),
    webhookMaxAttempts: parsePositiveNumber(config.webhookMaxAttempts, 5),
    webhookRetryBaseDelayMs: parsePositiveNumber(config.webhookRetryBaseDelayMs, 15 * 1000),
    webhookRetryMaxDelayMs: parsePositiveNumber(config.webhookRetryMaxDelayMs, 10 * 60 * 1000),
  }
}

function isRetryDue(nextRetryAt: string, nowIso: string): boolean {
  const normalized = String(nextRetryAt || '').trim()
  return !normalized || normalized <= nowIso
}

function computeNextRetryAt(attemptCount: number, nowMs: number, baseDelayMs: number, maxDelayMs: number): string {
  const safeAttempt = Math.max(1, Math.trunc(attemptCount))
  const delayMs = Math.min(baseDelayMs * Math.pow(2, safeAttempt - 1), maxDelayMs)
  return new Date(nowMs + delayMs).toISOString()
}

function normalizeDeliveryStatus(input: unknown): DeliveryStatus {
  const value = String(input || '').trim()
  switch (value) {
    case 'pending':
    case 'delivering':
    case 'delivered':
    case 'failed':
      return value
    default:
      return 'pending'
  }
}

function canManualRetry(statusInput: unknown): boolean {
  return normalizeDeliveryStatus(statusInput) === 'failed'
}

function canReplay(statusInput: unknown): boolean {
  const status = normalizeDeliveryStatus(statusInput)
  return status === 'failed' || status === 'delivered'
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

async function claimDeliveryCandidates(
  limit: number,
  nowIso: string,
  policy: ReturnType<typeof resolveNotificationPolicy>
): Promise<NotificationDeliveryDO[]> {
  const dataSource = SingletonDataSource.get()
  const repository = dataSource.getRepository(NotificationDeliveryDO)
  const claimToken = uuidv4()
  const staleLockedBeforeIso = toIso(Date.parse(nowIso) - policy.webhookClaimTimeoutMs)
  const dbType = dataSource.options.type

  if (dbType === 'postgres') {
    const schema = (dataSource.options as { schema?: string }).schema || 'public'
    const schemaRef = `"${String(schema).replace(/"/g, '""')}"`
    await dataSource.query(
      `
      WITH candidates AS (
        SELECT uid
        FROM ${schemaRef}."notification_deliveries"
        WHERE channel = $1
          AND webhook_uid <> ''
          AND (
            status = $2
            OR (status = $3 AND (next_retry_at = '' OR next_retry_at <= $4))
            OR (status = $5 AND locked_at <> '' AND locked_at <= $6)
          )
        ORDER BY created_at ASC
        LIMIT $7
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${schemaRef}."notification_deliveries" AS delivery
      SET status = $5,
          lock_token = $8,
          locked_at = $4,
          attempt_count = delivery.attempt_count + 1,
          updated_at = $4,
          last_error = ''
      FROM candidates
      WHERE delivery.uid = candidates.uid
      `,
      ['webhook', 'pending', 'failed', nowIso, 'delivering', staleLockedBeforeIso, limit, claimToken]
    )
    return await repository.find({
      where: { lockToken: claimToken },
      order: { createdAt: 'ASC' },
    })
  }

  const rows = await repository.find({
    where: [
      { channel: 'webhook', status: 'pending' },
      { channel: 'webhook', status: 'failed' },
      { channel: 'webhook', status: 'delivering' },
    ],
    order: { createdAt: 'ASC' },
    take: limit * 3,
  })
  const candidates = rows
    .filter((row) => String(row.webhookUid || '').trim())
    .filter((row) => {
      if (row.status === 'pending') return true
      if (row.status === 'failed') return isRetryDue(row.nextRetryAt, nowIso)
      return String(row.lockedAt || '').trim() !== '' && String(row.lockedAt || '').trim() <= staleLockedBeforeIso
    })
    .slice(0, limit)
  for (const row of candidates) {
    row.status = 'delivering'
    row.lockToken = claimToken
    row.lockedAt = nowIso
    row.attemptCount = Number(row.attemptCount || 0) + 1
    row.updatedAt = nowIso
    row.lastError = ''
  }
  if (candidates.length > 0) {
    await repository.save(candidates)
  }
  return candidates
}

async function getDeliveryByUid(uidInput: string): Promise<NotificationDeliveryDO | null> {
  const uid = String(uidInput || '').trim()
  if (!uid) {
    return null
  }
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  return await repository.findOneBy({ uid })
}

async function claimDeliveryRecord(delivery: NotificationDeliveryDO, nowIso: string): Promise<NotificationDeliveryDO> {
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  if (normalizeDeliveryStatus(delivery.status) !== 'pending') {
    throw new Error('Delivery is not claimable')
  }
  delivery.status = 'delivering'
  delivery.lockToken = uuidv4()
  delivery.lockedAt = nowIso
  delivery.attemptCount = Number(delivery.attemptCount || 0) + 1
  delivery.updatedAt = nowIso
  delivery.lastError = ''
  return await repository.save(delivery)
}

async function markDeliverySuccess(delivery: NotificationDeliveryDO, nowIso: string): Promise<void> {
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  delivery.status = 'delivered'
  delivery.deliveredAt = nowIso
  delivery.nextRetryAt = ''
  delivery.lastError = ''
  delivery.lockToken = ''
  delivery.lockedAt = ''
  delivery.updatedAt = nowIso
  await repository.save(delivery)
}

async function markDeliveryFailure(
  delivery: NotificationDeliveryDO,
  errorMessage: string,
  nowMs: number,
  policy: ReturnType<typeof resolveNotificationPolicy>
): Promise<void> {
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  const nowIso = new Date(nowMs).toISOString()
  const attemptCount = Math.max(1, Number(delivery.attemptCount || 0))
  delivery.status = 'failed'
  delivery.lastError = String(errorMessage || 'Webhook delivery failed').slice(0, 4000)
  delivery.lockToken = ''
  delivery.lockedAt = ''
  delivery.updatedAt = nowIso
  delivery.nextRetryAt =
    attemptCount >= policy.webhookMaxAttempts
      ? ''
      : computeNextRetryAt(attemptCount, nowMs, policy.webhookRetryBaseDelayMs, policy.webhookRetryMaxDelayMs)
  await repository.save(delivery)
}

async function resetDeliveryForManualRetry(delivery: NotificationDeliveryDO, nowIso: string): Promise<NotificationDeliveryDO> {
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  delivery.status = 'pending'
  delivery.nextRetryAt = ''
  delivery.deliveredAt = ''
  delivery.lastError = ''
  delivery.lockToken = ''
  delivery.lockedAt = ''
  delivery.updatedAt = nowIso
  return await repository.save(delivery)
}

async function resolveDeliveryContext(delivery: NotificationDeliveryDO): Promise<{
  notification: NotificationDO | null
  webhook: NotificationWebhookDO | null
}> {
  const dataSource = SingletonDataSource.get()
  const notificationRepository = dataSource.getRepository(NotificationDO)
  const webhookRepository = dataSource.getRepository(NotificationWebhookDO)
  const [notification, webhook] = await Promise.all([
    notificationRepository.findOneBy({ uid: delivery.notificationUid }),
    webhookRepository.findOneBy({ uid: delivery.webhookUid }),
  ])
  return { notification, webhook }
}

async function createReplayDelivery(input: {
  webhookUid: string
  notificationUid: string
  target: string
  nowIso: string
}): Promise<NotificationDeliveryDO> {
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  const entity = repository.create({
    webhookUid: input.webhookUid,
    notificationUid: input.notificationUid,
    channel: 'webhook',
    target: input.target,
    status: 'pending',
    lockToken: '',
    lockedAt: '',
    attemptCount: 0,
    lastError: '',
    deliveredAt: '',
    nextRetryAt: '',
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  })
  return await repository.save(entity)
}

async function updateWebhookTriggeredAt(webhook: NotificationWebhookDO, nowIso: string): Promise<void> {
  const repository = SingletonDataSource.get().getRepository(NotificationWebhookDO)
  webhook.lastTriggeredAt = nowIso
  webhook.updatedAt = nowIso
  await repository.save(webhook)
}

function buildWebhookBody(notification: NotificationDO, delivery: NotificationDeliveryDO, nowIso: string): string {
  return JSON.stringify({
    notification: {
      uid: notification.uid,
      type: notification.type,
      source: notification.source,
      subjectType: notification.subjectType,
      subjectId: notification.subjectId,
      actor: notification.actor,
      audienceType: notification.audienceType,
      audienceIds: notification.audienceIds ? JSON.parse(notification.audienceIds) : [],
      level: notification.level,
      title: notification.title,
      body: notification.body,
      payload: notification.payload ? JSON.parse(notification.payload) : {},
      status: notification.status,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      expiresAt: notification.expiresAt || '',
    },
    delivery: {
      uid: delivery.uid,
      webhookUid: delivery.webhookUid,
      attemptCount: delivery.attemptCount,
      triggeredAt: nowIso,
    },
  })
}

async function postWebhook(input: {
  delivery: NotificationDeliveryDO
  webhook: NotificationWebhookDO
  notification: NotificationDO
  timeoutMs: number
  nowIso: string
}): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const body = buildWebhookBody(input.notification, input.delivery, input.nowIso)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-yeying-event': input.notification.type,
      'x-yeying-notification-id': input.notification.uid,
      'x-yeying-delivery-id': input.delivery.uid,
      'x-yeying-webhook-id': input.webhook.uid,
      'x-yeying-timestamp': input.nowIso,
    }
    const secretCiphertext = String(input.webhook.secretCiphertext || '').trim()
    if (secretCiphertext) {
      const secret = decryptNotificationWebhookSecret(secretCiphertext)
      headers['x-yeying-signature'] = buildNotificationWebhookSignature(input.nowIso, body, secret)
    }
    const response = await fetch(input.webhook.targetUrl, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(`Webhook responded ${response.status}${responseText ? `: ${responseText.slice(0, 200)}` : ''}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function processSingleDelivery(
  candidate: NotificationDeliveryDO,
  policy: ReturnType<typeof resolveNotificationPolicy>
): Promise<NotificationDeliveryDO> {
  const attemptStartedAt = getCurrentUtcString()
  const delivery = candidate
  delivery.updatedAt = attemptStartedAt
  try {
    const { notification, webhook } = await resolveDeliveryContext(delivery)
    if (!notification) {
      throw new Error('Notification not found')
    }
    if (!webhook) {
      throw new Error('Webhook not found')
    }
    if (!webhook.enabled) {
      throw new Error('Webhook is disabled')
    }
    await postWebhook({
      delivery,
      webhook,
      notification,
      timeoutMs: policy.webhookDeliveryTimeoutMs,
      nowIso: attemptStartedAt,
    })
    const successTime = getCurrentUtcString()
    await markDeliverySuccess(delivery, successTime)
    await updateWebhookTriggeredAt(webhook, successTime)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markDeliveryFailure(delivery, message, Date.now(), policy)
  }
  return (await getDeliveryByUid(delivery.uid)) || delivery
}

export async function runNotificationWebhookDeliveryOnce(nowMs = Date.now()): Promise<void> {
  const policy = resolveNotificationPolicy()
  if (!policy.webhookDeliveryEnabled) {
    return
  }
  const nowIso = new Date(nowMs).toISOString()
  const deliveries = await claimDeliveryCandidates(policy.webhookDeliveryBatchSize, nowIso, policy)
  for (const candidate of deliveries) {
    await processSingleDelivery(candidate, policy)
  }
}

export async function retryNotificationWebhookDeliveryNow(deliveryUidInput: string): Promise<NotificationDeliveryDO | null> {
  const delivery = await getDeliveryByUid(deliveryUidInput)
  if (!delivery || String(delivery.channel || '').trim() !== 'webhook') {
    return null
  }
  if (!canManualRetry(delivery.status)) {
    throw new Error('Only failed deliveries can be retried directly')
  }
  const reset = await resetDeliveryForManualRetry(delivery, getCurrentUtcString())
  const claimed = await claimDeliveryRecord(reset, getCurrentUtcString())
  return await processSingleDelivery(claimed, resolveNotificationPolicy())
}

export async function replayNotificationWebhookDeliveryNow(input: {
  webhookUid: string
  notificationUid: string
  target: string
  sourceStatus?: string
}): Promise<NotificationDeliveryDO> {
  if (input.sourceStatus !== undefined && !canReplay(input.sourceStatus)) {
    throw new Error('Only delivered or failed deliveries can be replayed')
  }
  const nowIso = getCurrentUtcString()
  const delivery = await createReplayDelivery({
    webhookUid: input.webhookUid,
    notificationUid: input.notificationUid,
    target: input.target,
    nowIso,
  })
  const claimed = await claimDeliveryRecord(delivery, getCurrentUtcString())
  return await processSingleDelivery(claimed, resolveNotificationPolicy())
}

let deliveryJobStarted = false
let deliveryJobRunning = false

export function startNotificationDeliveryJobs(): void {
  if (deliveryJobStarted) {
    return
  }
  deliveryJobStarted = true

  const logger = SingletonLogger.get()
  const policy = resolveNotificationPolicy()
  if (!policy.webhookDeliveryEnabled || !Number.isFinite(policy.webhookDeliveryIntervalMs) || policy.webhookDeliveryIntervalMs <= 0) {
    return
  }

  const runOnce = async () => {
    if (deliveryJobRunning) {
      return
    }
    deliveryJobRunning = true
    try {
      await runNotificationWebhookDeliveryOnce(Date.now())
    } catch (error) {
      logger.warn(`notification webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      deliveryJobRunning = false
    }
  }

  runOnce().catch(() => undefined)
  setInterval(() => {
    runOnce().catch(() => undefined)
  }, policy.webhookDeliveryIntervalMs)
}
