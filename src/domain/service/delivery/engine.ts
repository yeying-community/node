import { v4 as uuidv4 } from 'uuid'
import { getCurrentUtcString } from '../../../common/date'
import { SingletonDataSource } from '../../facade/datasource'
import { SingletonLogger } from '../../facade/logger'
import { NotificationDO, NotificationDeliveryDO, NotificationWebhookDO } from '../../mapper/entity'
import { DeliveryContext, DeliveryPolicy, DeliveryProvider } from './types'

/**
 * Generic notification delivery engine. Owns the parts every channel shares:
 * claiming pending/retryable rows with a lock, exponential backoff, and the
 * pending → delivering → delivered/failed status machine. Channel-specific
 * dispatch is delegated to the DeliveryProvider passed in.
 *
 * Extracted from the previously duplicated emailNotificationDelivery.ts and
 * notificationDelivery.ts workers; behaviour is intentionally identical.
 */

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

export function isRetryDue(nextRetryAt: string, nowIso: string): boolean {
  const normalized = String(nextRetryAt || '').trim()
  return !normalized || normalized <= nowIso
}

export function computeNextRetryAt(attemptCount: number, nowMs: number, policy: DeliveryPolicy): string {
  const safeAttempt = Math.max(1, Math.trunc(attemptCount))
  const delayMs = Math.min(policy.retryBaseDelayMs * Math.pow(2, safeAttempt - 1), policy.retryMaxDelayMs)
  return new Date(nowMs + delayMs).toISOString()
}

async function claimDeliveries(
  channel: string,
  requiresWebhook: boolean,
  limit: number,
  nowIso: string,
  policy: DeliveryPolicy
): Promise<NotificationDeliveryDO[]> {
  const dataSource = SingletonDataSource.get()
  const repository = dataSource.getRepository(NotificationDeliveryDO)
  const staleLockedBeforeIso = toIso(Date.parse(nowIso) - policy.claimTimeoutMs)
  const dbType = dataSource.options?.type

  if (dbType === 'postgres') {
    const schema = (dataSource.options as { schema?: string }).schema || 'public'
    const schemaRef = `"${String(schema).replace(/"/g, '""')}"`
    const claimToken = uuidv4()
    const webhookPredicate = requiresWebhook ? `AND webhook_uid <> ''` : ''
    await dataSource.query(
      `
      WITH candidates AS (
        SELECT uid
        FROM ${schemaRef}."notification_deliveries"
        WHERE channel = $1
          ${webhookPredicate}
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
      [channel, 'pending', 'failed', nowIso, 'delivering', staleLockedBeforeIso, limit, claimToken]
    )
    return await repository.find({
      where: { lockToken: claimToken },
      order: { createdAt: 'ASC' },
    })
  }

  // MySQL / entity-sync fallback: optimistic-lock update per candidate.
  const rows = await repository.find({
    where: [
      { channel, status: 'pending' },
      { channel, status: 'failed' },
      { channel, status: 'delivering' },
    ],
    order: { createdAt: 'ASC' },
    take: limit * 3,
  })
  const candidates = rows
    .filter((row) => (requiresWebhook ? String(row.webhookUid || '').trim() !== '' : true))
    .filter((row) => {
      if (row.status === 'pending') return true
      if (row.status === 'failed') return isRetryDue(row.nextRetryAt, nowIso)
      return String(row.lockedAt || '').trim() !== '' && String(row.lockedAt || '').trim() <= staleLockedBeforeIso
    })
    .slice(0, limit)
  const claimed: NotificationDeliveryDO[] = []
  for (const row of candidates) {
    const claimToken = uuidv4()
    const where: Record<string, string> = {
      uid: row.uid,
      channel,
      status: row.status,
    }
    if (row.status === 'delivering') {
      where.lockedAt = String(row.lockedAt || '')
    }
    const result = await repository.update(where, {
      status: 'delivering',
      lockToken: claimToken,
      lockedAt: nowIso,
      attemptCount: Number(row.attemptCount || 0) + 1,
      lastError: '',
      updatedAt: nowIso,
    })
    if (Number(result.affected || 0) > 0) {
      const current = await repository.findOneBy({ uid: row.uid, lockToken: claimToken })
      if (current) {
        claimed.push(current)
      }
    }
  }
  return claimed
}

async function markSuccess(delivery: NotificationDeliveryDO, providerMessageId: string): Promise<boolean> {
  const now = getCurrentUtcString()
  const result = await SingletonDataSource.get().getRepository(NotificationDeliveryDO).update(
    {
      uid: delivery.uid,
      status: 'delivering',
      lockToken: delivery.lockToken,
    },
    {
      status: 'delivered',
      lastError: providerMessageId ? `providerMessageId:${providerMessageId}` : '',
      deliveredAt: now,
      nextRetryAt: '',
      lockToken: '',
      lockedAt: '',
      updatedAt: now,
    }
  )
  return Number(result.affected || 0) > 0
}

async function markFailure(delivery: NotificationDeliveryDO, message: string, policy: DeliveryPolicy): Promise<boolean> {
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  const attemptCount = Math.max(1, Number(delivery.attemptCount || 0))
  const nextRetryAt = attemptCount >= policy.maxAttempts ? '' : computeNextRetryAt(attemptCount, nowMs, policy)
  const result = await SingletonDataSource.get().getRepository(NotificationDeliveryDO).update(
    {
      uid: delivery.uid,
      status: 'delivering',
      lockToken: delivery.lockToken,
    },
    {
      status: 'failed',
      lastError: String(message || 'Delivery failed').slice(0, 4000),
      nextRetryAt,
      lockToken: '',
      lockedAt: '',
      updatedAt: now,
    }
  )
  return Number(result.affected || 0) > 0
}

async function loadContext(
  delivery: NotificationDeliveryDO,
  requiresWebhook: boolean
): Promise<DeliveryContext | null> {
  const dataSource = SingletonDataSource.get()
  const notification = await dataSource.getRepository(NotificationDO).findOneBy({ uid: delivery.notificationUid })
  if (!notification) {
    return null
  }
  let webhook: NotificationWebhookDO | undefined
  if (requiresWebhook) {
    webhook = (await dataSource.getRepository(NotificationWebhookDO).findOneBy({ uid: delivery.webhookUid })) || undefined
  }
  return { delivery, notification, webhook }
}

/**
 * Process one already-claimed (status = delivering) delivery through the given
 * provider. Shared by the polling loop and by manual retry / replay entry points.
 */
export async function processOne(delivery: NotificationDeliveryDO, provider: DeliveryProvider): Promise<void> {
  const policy = provider.resolvePolicy()
  const requiresWebhook = provider.requiresWebhook === true
  const context = await loadContext(delivery, requiresWebhook)
  if (!context) {
    await markFailure(delivery, 'Notification not found', policy)
    return
  }
  if (requiresWebhook && !context.webhook) {
    await markFailure(delivery, 'Webhook not found', policy)
    return
  }
  try {
    const result = await provider.send(context)
    await markSuccess(delivery, String(result?.providerMessageId || ''))
  } catch (error) {
    await markFailure(delivery, error instanceof Error ? error.message : String(error), policy)
  }
}

export async function runOnce(provider: DeliveryProvider): Promise<void> {
  const policy = provider.resolvePolicy()
  if (!policy.enabled) {
    return
  }
  const now = getCurrentUtcString()
  const deliveries = await claimDeliveries(provider.channel, provider.requiresWebhook === true, policy.batchSize, now, policy)
  for (const delivery of deliveries) {
    await processOne(delivery, provider)
  }
}

const jobStartedChannels = new Set<string>()
const jobRunningChannels = new Set<string>()

export function startJob(provider: DeliveryProvider): void {
  if (jobStartedChannels.has(provider.channel)) {
    return
  }
  jobStartedChannels.add(provider.channel)
  const logger = SingletonLogger.get()
  const policy = provider.resolvePolicy()
  if (!policy.enabled || !Number.isFinite(policy.intervalMs) || policy.intervalMs <= 0) {
    return
  }
  const tick = async () => {
    if (jobRunningChannels.has(provider.channel)) {
      return
    }
    jobRunningChannels.add(provider.channel)
    try {
      await runOnce(provider)
    } catch (error) {
      logger.warn(`notification ${provider.channel} delivery failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      jobRunningChannels.delete(provider.channel)
    }
  }
  tick().catch(() => undefined)
  setInterval(() => {
    tick().catch(() => undefined)
  }, policy.intervalMs)
}
