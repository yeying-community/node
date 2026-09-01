import { getCurrentUtcString } from '../../common/date'
import { NotificationRuntimeConfig } from '../../config'
import { getConfig } from '../../config/runtime'
import { SingletonDataSource } from '../facade/datasource'
import { SingletonLogger } from '../facade/logger'
import { EmailTemplateDO, NotificationDO, NotificationDeliveryDO } from '../mapper/entity'
import { sendMail } from './mailProvider'

type EmailPolicy = {
  enabled: boolean
  intervalMs: number
  batchSize: number
  maxAttempts: number
  retryBaseDelayMs: number
  retryMaxDelayMs: number
}

function parsePositiveNumber(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function resolveEmailPolicy(): EmailPolicy {
  const config = (getConfig<NotificationRuntimeConfig>('notification') || {}) as NotificationRuntimeConfig & Record<string, unknown>
  return {
    enabled: config.emailDeliveryEnabled !== false,
    intervalMs: parsePositiveNumber(config.emailDeliveryIntervalMs, 30 * 1000),
    batchSize: parsePositiveNumber(config.emailDeliveryBatchSize, 20),
    maxAttempts: parsePositiveNumber(config.emailMaxAttempts, 5),
    retryBaseDelayMs: parsePositiveNumber(config.emailRetryBaseDelayMs, 30 * 1000),
    retryMaxDelayMs: parsePositiveNumber(config.emailRetryMaxDelayMs, 15 * 60 * 1000),
  }
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

function escapeHtml(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function computeNextRetryAt(attemptCount: number, nowMs: number, policy: EmailPolicy): string {
  const safeAttempt = Math.max(1, Math.trunc(attemptCount))
  const delayMs = Math.min(policy.retryBaseDelayMs * Math.pow(2, safeAttempt - 1), policy.retryMaxDelayMs)
  return new Date(nowMs + delayMs).toISOString()
}

function isRetryDue(nextRetryAt: string, nowIso: string): boolean {
  const normalized = String(nextRetryAt || '').trim()
  return !normalized || normalized <= nowIso
}

async function getDeliveryByUid(uid: string): Promise<NotificationDeliveryDO | null> {
  return await SingletonDataSource.get().getRepository(NotificationDeliveryDO).findOneBy({ uid })
}

async function getNotificationByUid(uid: string): Promise<NotificationDO | null> {
  return await SingletonDataSource.get().getRepository(NotificationDO).findOneBy({ uid })
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
  return enabled.find((row) => {
    const appId = String(row.appId || '').trim()
    if (appId && appId !== notification.source) {
      return false
    }
    const eventTypes = parseJsonArray(row.eventTypesJson)
    return eventTypes.length === 0 || eventTypes.includes(notification.type)
  }) || null
}

async function claimEmailDeliveries(limit: number, nowIso: string): Promise<NotificationDeliveryDO[]> {
  const repository = SingletonDataSource.get().getRepository(NotificationDeliveryDO)
  const rows = await repository.find({
    where: [
      { channel: 'email', status: 'pending' },
      { channel: 'email', status: 'failed' },
    ],
    order: { createdAt: 'ASC' },
    take: limit * 2,
  })
  const candidates = rows
    .filter((row) => row.channel === 'email')
    .filter((row) => row.status === 'pending' || isRetryDue(row.nextRetryAt, nowIso))
    .slice(0, limit)
  for (const row of candidates) {
    row.status = 'delivering'
    row.lockedAt = nowIso
    row.attemptCount = Number(row.attemptCount || 0) + 1
    row.lastError = ''
    row.updatedAt = nowIso
  }
  if (candidates.length > 0) {
    await repository.save(candidates)
  }
  return candidates
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

async function buildNotificationEmail(notification: NotificationDO) {
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

async function markSuccess(delivery: NotificationDeliveryDO, providerMessageId: string): Promise<void> {
  const now = getCurrentUtcString()
  delivery.status = 'delivered'
  delivery.lastError = providerMessageId ? `providerMessageId:${providerMessageId}` : ''
  delivery.deliveredAt = now
  delivery.nextRetryAt = ''
  delivery.updatedAt = now
  await SingletonDataSource.get().getRepository(NotificationDeliveryDO).save(delivery)
}

async function markFailure(delivery: NotificationDeliveryDO, message: string, policy: EmailPolicy): Promise<void> {
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  delivery.status = Number(delivery.attemptCount || 0) >= policy.maxAttempts ? 'failed' : 'failed'
  delivery.lastError = message.slice(0, 2000)
  delivery.nextRetryAt = Number(delivery.attemptCount || 0) >= policy.maxAttempts ? '' : computeNextRetryAt(delivery.attemptCount, nowMs, policy)
  delivery.updatedAt = now
  await SingletonDataSource.get().getRepository(NotificationDeliveryDO).save(delivery)
}

async function processEmailDelivery(delivery: NotificationDeliveryDO, policy: EmailPolicy): Promise<void> {
  const notification = await getNotificationByUid(delivery.notificationUid)
  if (!notification) {
    await markFailure(delivery, 'Notification not found', policy)
    return
  }
  const email = String(delivery.target || '').trim().toLowerCase()
  if (!email) {
    await markFailure(delivery, 'Email recipient missing', policy)
    return
  }
  const content = await buildNotificationEmail(notification)
  try {
    const providerMessageId = await sendMail({
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    })
    await markSuccess(delivery, providerMessageId)
  } catch (error) {
    await markFailure(delivery, error instanceof Error ? error.message : String(error), policy)
  }
}

export async function runEmailNotificationDeliveryOnce(): Promise<void> {
  const policy = resolveEmailPolicy()
  if (!policy.enabled) {
    return
  }
  const now = getCurrentUtcString()
  const deliveries = await claimEmailDeliveries(policy.batchSize, now)
  for (const delivery of deliveries) {
    await processEmailDelivery(delivery, policy)
  }
}

let emailJobStarted = false
let emailJobRunning = false

export function startEmailNotificationDeliveryJobs(): void {
  if (emailJobStarted) {
    return
  }
  emailJobStarted = true
  const logger = SingletonLogger.get()
  const policy = resolveEmailPolicy()
  if (!policy.enabled || !Number.isFinite(policy.intervalMs) || policy.intervalMs <= 0) {
    return
  }
  const runOnce = async () => {
    if (emailJobRunning) {
      return
    }
    emailJobRunning = true
    try {
      await runEmailNotificationDeliveryOnce()
    } catch (error) {
      logger.warn(`notification email delivery failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      emailJobRunning = false
    }
  }
  runOnce().catch(() => undefined)
  setInterval(() => {
    runOnce().catch(() => undefined)
  }, policy.intervalMs)
}
