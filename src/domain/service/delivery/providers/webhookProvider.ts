import { getCurrentUtcString } from '../../../../common/date'
import { SingletonDataSource } from '../../../facade/datasource'
import { NotificationDO, NotificationDeliveryDO, NotificationWebhookDO } from '../../../mapper/entity'
import { resolveChannelPolicy } from '../policy'
import { DeliveryContext, DeliveryPolicy, DeliveryProvider, DeliveryResult } from '../types'
import { buildNotificationWebhookSignature, decryptNotificationWebhookSecret } from '../webhookSecret'

/**
 * Generic outbound webhook provider (channel = 'webhook'). Also exposes helpers
 * shared by the dingtalk / feishu providers, which are webhook-family channels
 * that POST to a bot URL with a platform-specific body + signature.
 * Ported from the former notificationDelivery.ts worker.
 */

export const WEBHOOK_POLICY_DEFAULTS = {
  intervalMs: 15 * 1000,
  batchSize: 20,
  deliveryTimeoutMs: 10 * 1000,
  claimTimeoutMs: 60 * 1000,
  maxAttempts: 5,
  retryBaseDelayMs: 15 * 1000,
  retryMaxDelayMs: 10 * 60 * 1000,
}

/** POST a body to a bot/webhook URL with a timeout. Returns status + text. */
export async function httpPost(input: {
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
}): Promise<{ status: number; ok: boolean; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: input.headers,
      body: input.body,
      signal: controller.signal,
    })
    const text = await response.text().catch(() => '')
    return { status: response.status, ok: response.ok, text }
  } finally {
    clearTimeout(timer)
  }
}

/** Record the last time a webhook/bot was triggered successfully. */
export async function touchWebhookTriggeredAt(webhook: NotificationWebhookDO): Promise<void> {
  const now = getCurrentUtcString()
  const repository = SingletonDataSource.get().getRepository(NotificationWebhookDO)
  webhook.lastTriggeredAt = now
  webhook.updatedAt = now
  await repository.save(webhook)
}

/** Resolve the (optional) decrypted signing secret for a webhook/bot. */
export function resolveWebhookSecret(webhook: NotificationWebhookDO): string {
  const secretCiphertext = String(webhook.secretCiphertext || '').trim()
  return secretCiphertext ? decryptNotificationWebhookSecret(secretCiphertext) : ''
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

export const webhookDeliveryProvider: DeliveryProvider = {
  channel: 'webhook',
  requiresWebhook: true,
  resolvePolicy(): DeliveryPolicy {
    return resolveChannelPolicy('webhook', WEBHOOK_POLICY_DEFAULTS)
  },
  async send(context: DeliveryContext): Promise<DeliveryResult> {
    const { notification, delivery } = context
    const webhook = context.webhook as NotificationWebhookDO
    if (!webhook.enabled) {
      throw new Error('Webhook is disabled')
    }
    const nowIso = getCurrentUtcString()
    const body = buildWebhookBody(notification, delivery, nowIso)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-yeying-event': notification.type,
      'x-yeying-notification-id': notification.uid,
      'x-yeying-delivery-id': delivery.uid,
      'x-yeying-webhook-id': webhook.uid,
      'x-yeying-timestamp': nowIso,
    }
    const secret = resolveWebhookSecret(webhook)
    if (secret) {
      headers['x-yeying-signature'] = buildNotificationWebhookSignature(nowIso, body, secret)
    }
    const policy = this.resolvePolicy()
    const response = await httpPost({ url: webhook.targetUrl, headers, body, timeoutMs: policy.deliveryTimeoutMs })
    if (!response.ok) {
      throw new Error(`Webhook responded ${response.status}${response.text ? `: ${response.text.slice(0, 200)}` : ''}`)
    }
    await touchWebhookTriggeredAt(webhook)
    return {}
  },
}
