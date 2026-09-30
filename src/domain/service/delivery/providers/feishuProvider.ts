import crypto from 'crypto'
import { getCurrentUtcString } from '../../../../common/date'
import { NotificationDO, NotificationWebhookDO } from '../../../mapper/entity'
import { resolveChannelPolicy } from '../policy'
import { DeliveryContext, DeliveryPolicy, DeliveryProvider, DeliveryResult } from '../types'
import { httpPost, resolveWebhookSecret, touchWebhookTriggeredAt, WEBHOOK_POLICY_DEFAULTS } from './webhookProvider'

/**
 * Feishu (Lark) custom-robot provider (channel = 'feishu'). A feishu bot is a
 * webhook-family target stored in notification_webhooks with format = 'feishu'.
 * Feishu returns HTTP 200 with `code`/`StatusCode` in the body, so success is
 * decided by parsing that code.
 *
 * Signing (when a secret is configured): sign = base64(HMAC-SHA256(
 * key = `${timestamp}\n${secret}`, data = '')); timestamp + sign go in the body.
 */

function buildText(notification: NotificationDO): string {
  const title = String(notification.title || '夜莺社区通知').trim() || '夜莺社区通知'
  const lines = [title]
  if (notification.body) {
    lines.push(String(notification.body))
  }
  lines.push(`来源：${notification.source || 'YeYing Node'}`)
  return lines.join('\n')
}

function signFeishu(secret: string): { timestamp: string; sign: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const sign = crypto
    .createHmac('sha256', `${timestamp}\n${secret}`)
    .update('')
    .digest('base64')
  return { timestamp, sign }
}

export const feishuDeliveryProvider: DeliveryProvider = {
  channel: 'feishu',
  requiresWebhook: true,
  resolvePolicy(): DeliveryPolicy {
    return resolveChannelPolicy('feishu', WEBHOOK_POLICY_DEFAULTS)
  },
  async send(context: DeliveryContext): Promise<DeliveryResult> {
    const { notification } = context
    const webhook = context.webhook as NotificationWebhookDO
    if (!webhook.enabled) {
      throw new Error('Feishu bot is disabled')
    }
    const payload: Record<string, unknown> = {
      msg_type: 'text',
      content: { text: buildText(notification) },
    }
    const secret = resolveWebhookSecret(webhook)
    if (secret) {
      const { timestamp, sign } = signFeishu(secret)
      payload.timestamp = timestamp
      payload.sign = sign
    }
    const policy = this.resolvePolicy()
    const response = await httpPost({
      url: webhook.targetUrl,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: policy.deliveryTimeoutMs,
    })
    if (!response.ok) {
      throw new Error(`Feishu responded ${response.status}${response.text ? `: ${response.text.slice(0, 200)}` : ''}`)
    }
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(response.text || '{}') as Record<string, unknown>
    } catch {
      throw new Error(`Feishu returned non-JSON response: ${response.text.slice(0, 200)}`)
    }
    const code = Number(parsed.code ?? parsed.StatusCode ?? 0)
    if (code !== 0) {
      const message = String(parsed.msg || parsed.StatusMessage || 'unknown error')
      throw new Error(`Feishu error ${code}: ${message}`)
    }
    await touchWebhookTriggeredAt(webhook)
    return { providerMessageId: String(getCurrentUtcString()) }
  },
}
