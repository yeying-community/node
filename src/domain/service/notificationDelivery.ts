import { v4 as uuidv4 } from 'uuid'
import { getCurrentUtcString } from '../../common/date'
import { SingletonDataSource } from '../facade/datasource'
import { NotificationDeliveryDO } from '../mapper/entity'
import { processOne, runOnce } from './delivery/engine'
import { webhookDeliveryProvider } from './delivery/providers/webhookProvider'
import { getDeliveryProvider, isWebhookFamilyChannel } from './delivery/registry'

/**
 * Compatibility shim for the webhook-family delivery path. The claim / retry /
 * backoff engine and the per-channel dispatch now live under ./delivery. This
 * module keeps the historical public surface:
 *  - crypto helpers (re-exported so existing importers don't move)
 *  - manual retry / replay entry points used by NotificationService
 *  - the single-run helper used by tests
 * Background scheduling is driven by registry.startAllDeliveryJobs() in server.ts.
 */
export {
  encryptNotificationWebhookSecret,
  decryptNotificationWebhookSecret,
  buildNotificationWebhookSignature,
} from './delivery/webhookSecret'

type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed'

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

async function getDeliveryByUid(uidInput: string): Promise<NotificationDeliveryDO | null> {
  const uid = String(uidInput || '').trim()
  if (!uid) {
    return null
  }
  return await SingletonDataSource.get().getRepository(NotificationDeliveryDO).findOneBy({ uid })
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

/** Move a pending delivery into `delivering` with a fresh lock so the engine can process it. */
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

async function createReplayDelivery(input: {
  webhookUid: string
  notificationUid: string
  channel: string
  target: string
  nowIso: string
}): Promise<NotificationDeliveryDO> {
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  const entity = repository.create({
    webhookUid: input.webhookUid,
    notificationUid: input.notificationUid,
    channel: input.channel,
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

function resolveProviderOrThrow(channel: string) {
  const provider = getDeliveryProvider(channel)
  if (!provider) {
    throw new Error(`No delivery provider registered for channel ${channel}`)
  }
  return provider
}

/** Single polling run for the generic webhook channel. Retained for tests. */
export async function runNotificationWebhookDeliveryOnce(_nowMs = Date.now()): Promise<void> {
  await runOnce(webhookDeliveryProvider)
}

export async function retryNotificationWebhookDeliveryNow(deliveryUidInput: string): Promise<NotificationDeliveryDO | null> {
  const delivery = await getDeliveryByUid(deliveryUidInput)
  if (!delivery || !isWebhookFamilyChannel(delivery.channel)) {
    return null
  }
  if (!canManualRetry(delivery.status)) {
    throw new Error('Only failed deliveries can be retried directly')
  }
  const reset = await resetDeliveryForManualRetry(delivery, getCurrentUtcString())
  const claimed = await claimDeliveryRecord(reset, getCurrentUtcString())
  await processOne(claimed, resolveProviderOrThrow(claimed.channel))
  return (await getDeliveryByUid(claimed.uid)) || claimed
}

export async function replayNotificationWebhookDeliveryNow(input: {
  webhookUid: string
  notificationUid: string
  target: string
  channel?: string
  sourceStatus?: string
}): Promise<NotificationDeliveryDO> {
  if (input.sourceStatus !== undefined && !canReplay(input.sourceStatus)) {
    throw new Error('Only delivered or failed deliveries can be replayed')
  }
  const channel = String(input.channel || 'webhook').trim() || 'webhook'
  const nowIso = getCurrentUtcString()
  const delivery = await createReplayDelivery({
    webhookUid: input.webhookUid,
    notificationUid: input.notificationUid,
    channel,
    target: input.target,
    nowIso,
  })
  const claimed = await claimDeliveryRecord(delivery, getCurrentUtcString())
  await processOne(claimed, resolveProviderOrThrow(channel))
  return (await getDeliveryByUid(claimed.uid)) || claimed
}
