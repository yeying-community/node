import { SingletonDataSource } from '../../../facade/datasource'
import { EmailTemplateDO, NotificationDO } from '../../../mapper/entity'
import { sendMail } from '../../mailProvider'
import { resolveChannelPolicy } from '../policy'
import { DeliveryContext, DeliveryPolicy, DeliveryProvider, DeliveryResult } from '../types'

/**
 * Email delivery provider. Renders a notification into a subject/text/html
 * message (template table with a branded fallback) and sends it over SMTP.
 * Ported verbatim from the former emailNotificationDelivery.ts worker.
 */

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

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function findEmailTemplate(notification: NotificationDO): Promise<EmailTemplateDO | null> {
  const repository = SingletonDataSource.get().getRepository(EmailTemplateDO)
  const payload = parseJsonObject(notification.payload)
  const requestedTemplateId = String(payload.emailTemplateId || payload.templateId || '').trim().toLowerCase()
  const rows = await repository.find({
    order: { version: 'DESC', updatedAt: 'DESC' },
  })
  const enabled = rows.filter((row) => row.enabled)
  if (requestedTemplateId) {
    const requested = enabled.find((row) => row.templateId === requestedTemplateId)
    if (requested) {
      return requested
    }
  }
  return (
    enabled.find((row) => {
      const appId = String(row.appId || '').trim()
      if (appId && appId !== notification.source) {
        return false
      }
      const eventTypes = parseJsonArray(row.eventTypesJson)
      return eventTypes.length === 0 || eventTypes.includes(notification.type)
    }) || null
  )
}

function getPathValue(input: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return ''
    }
    return (current as Record<string, unknown>)[part]
  }, input)
}

function renderTemplate(input: string, context: Record<string, unknown>, html: boolean): string {
  return String(input || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = getPathValue(context, String(key))
    return html ? escapeHtml(value) : String(value || '')
  })
}

function localized(record: Record<string, unknown>, locale = 'zh-CN'): string {
  return String(record[locale] || record['zh-CN'] || record['en-US'] || '').trim()
}

export async function buildNotificationEmail(notification: NotificationDO) {
  const payload = parseJsonObject(notification.payload)
  const template = await findEmailTemplate(notification)
  const context: Record<string, unknown> = {
    notification: {
      uid: notification.uid,
      type: notification.type,
      source: notification.source,
      level: notification.level,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt,
    },
    app: {
      appId: notification.source,
      name: String(payload.appName || notification.source || 'YeYing Node'),
    },
    data: payload,
  }
  if (template) {
    const subject = renderTemplate(localized(parseJsonObject(template.subjectJson)), context, false)
    const text = renderTemplate(localized(parseJsonObject(template.textBodyJson)), context, false)
    const html = renderTemplate(localized(parseJsonObject(template.htmlBodyJson)), context, true)
    if (subject && text && html) {
      return { subject, text, html }
    }
  }
  const appName = escapeHtml(String(payload.appName || notification.source || 'YeYing Node'))
  const title = escapeHtml(notification.title)
  const body = escapeHtml(notification.body)
  const subject = `【夜莺社区】${notification.title}`
  const text = [notification.title, notification.body, '', `来源：${notification.source}`].filter(Boolean).join('\n')
  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#f4f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:36px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dce3ed;border-radius:10px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#172033;color:#ffffff;">
            <div style="font-size:18px;font-weight:700;line-height:26px;letter-spacing:0;">夜莺社区</div>
            <div style="margin-top:5px;font-size:13px;line-height:20px;color:#d8dee9;">${appName}</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <div style="font-size:20px;font-weight:700;line-height:30px;">${title}</div>
            <p style="margin:12px 0 0;font-size:14px;line-height:23px;color:#526075;">${body}</p>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5eaf1;font-size:12px;line-height:20px;color:#7a8798;">此邮件由 YeYing Node 通知中心自动发送。安全类邮件不能完全关闭，非安全类邮件可在通知偏好中调整。</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  return { subject, text, html }
}

export const emailDeliveryProvider: DeliveryProvider = {
  channel: 'email',
  resolvePolicy(): DeliveryPolicy {
    return resolveChannelPolicy('email', {
      intervalMs: 30 * 1000,
      batchSize: 20,
      deliveryTimeoutMs: 15 * 1000,
      claimTimeoutMs: 60 * 1000,
      maxAttempts: 5,
      retryBaseDelayMs: 30 * 1000,
      retryMaxDelayMs: 15 * 60 * 1000,
    })
  },
  async send(context: DeliveryContext): Promise<DeliveryResult> {
    const email = String(context.delivery.target || '').trim().toLowerCase()
    if (!email) {
      throw new Error('Email recipient missing')
    }
    const content = await buildNotificationEmail(context.notification)
    const providerMessageId = await sendMail({
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    })
    return { providerMessageId }
  },
}
