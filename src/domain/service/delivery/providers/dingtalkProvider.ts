import crypto from 'crypto'
import { getCurrentUtcString } from '../../../../common/date'
import { NotificationDO, NotificationWebhookDO } from '../../../mapper/entity'
import { resolveChannelPolicy } from '../policy'
import { DeliveryContext, DeliveryPolicy, DeliveryProvider, DeliveryResult } from '../types'
import { httpPost, resolveWebhookSecret, touchWebhookTriggeredAt, WEBHOOK_POLICY_DEFAULTS } from './webhookProvider'

/**
 * DingTalk custom-robot provider (channel = 'dingtalk'). A dingtalk bot is a
 * webhook-family target: the row lives in notification_webhooks with
 * format = 'dingtalk'. DingTalk returns HTTP 200 even on logical failure, so the
 * response body's errcode must be parsed to decide success.
 *
 * Signing (when a secret is configured): sign = base64(HMAC-SHA256(secret,
 * `${timestamp}\n${secret}`)); timestamp + sign are appended to the query string.
 */

function buildMarkdown(notification: NotificationDO): { title: string; text: string } {
  const title = String(notification.title || '夜莺社区通知').trim() || '夜莺社区通知'
  const bodyLines = [`### ${title}`]
  if (notification.body) {
    bodyLines.push('', String(notification.body))
  }
  bodyLines.push('', `> 来源：${notification.source || 'YeYing Node'}`)
  return { title, text: bodyLines.join('\n') }
}

function signDingtalkUrl(targetUrl: string, secret: string): string {
  if (!secret) {
    return targetUrl
  }
  const timestamp = String(Date.now())
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}\n${secret}`)
    .digest('base64')
  const separator = targetUrl.includes('?') ? '&' : '?'
  return `${targetUrl}${separator}timestamp=${timestamp}&sign=${encodeURIComponent(signature)}`
}

export const dingtalkDeliveryProvider: DeliveryProvider = {
  channel: 'dingtalk',
  requiresWebhook: true,
  resolvePolicy(): DeliveryPolicy {
    return resolveChannelPolicy('dingtalk', WEBHOOK_POLICY_DEFAULTS)
  },
  async send(context: DeliveryContext): Promise<DeliveryResult> {
    const { notification } = context
    const webhook = context.webhook as NotificationWebhookDO
    if (!webhook.enabled) {
      throw new Error('DingTalk bot is disabled')
    }
    const markdown = buildMarkdown(notification)
    const body = JSON.stringify({
      msgtype: 'markdown',
      markdown: { title: markdown.title, text: markdown.text },
    })
    const secret = resolveWebhookSecret(webhook)
    const url = signDingtalkUrl(webhook.targetUrl, secret)
    const policy = this.resolvePolicy()
    const response = await httpPost({
      url,
      headers: { 'content-type': 'application/json' },
      body,
      timeoutMs: policy.deliveryTimeoutMs,
    })
    if (!response.ok) {
      throw new Error(`DingTalk responded ${response.status}${response.text ? `: ${response.text.slice(0, 200)}` : ''}`)
    }
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(response.text || '{}') as Record<string, unknown>
    } catch {
      throw new Error(`DingTalk returned non-JSON response: ${response.text.slice(0, 200)}`)
    }
    if (Number(parsed.errcode) !== 0) {
      throw new Error(`DingTalk error ${parsed.errcode}: ${String(parsed.errmsg || 'unknown error')}`)
    }
    await touchWebhookTriggeredAt(webhook)
    return { providerMessageId: String(getCurrentUtcString()) }
  },
}
