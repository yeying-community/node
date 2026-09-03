import nodemailer from 'nodemailer'
import { getConfig } from '../../config/runtime'
import { getRuntimeSecret } from '../../security/secretVault'

type MailConfig = {
  host?: string
  port?: number
  secure?: boolean
  from?: string
  replyTo?: string
}

type NotificationEmailConfig = {
  emailDeliveryEnabled?: boolean
  emailDeliveryIntervalMs?: number
  emailDeliveryBatchSize?: number
  emailMaxAttempts?: number
  emailRetryBaseDelayMs?: number
  emailRetryMaxDelayMs?: number
}

export type MailProviderStatus = {
  provider: 'smtp'
  configured: boolean
  host: string
  port: number
  secure: boolean
  from: string
  replyTo: string
  hasAuthUser: boolean
  hasAuthPassword: boolean
  issues: string[]
  delivery: {
    enabled: boolean
    intervalMs: number
    batchSize: number
    maxAttempts: number
    retryBaseDelayMs: number
    retryMaxDelayMs: number
  }
}

export type MailMessage = {
  to: string
  subject: string
  text: string
  html: string
  replyTo?: string
}

export type MailRuntime = Required<Pick<MailConfig, 'host' | 'port' | 'secure' | 'from'>> & {
  replyTo?: string
  auth?: { user: string; pass: string }
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}

function resolveMailSnapshot() {
  const config = getConfig<MailConfig>('mail') || {}
  const notification = getConfig<NotificationEmailConfig>('notification') || {}
  const host = String(config.host || '').trim()
  const port = Number(config.port)
  const user = getRuntimeSecret('MAIL_SMTP_USER')
  const pass = getRuntimeSecret('MAIL_SMTP_PASSWORD')
  const from = String(config.from || user).trim()
  const replyTo = String(config.replyTo || '').trim()
  const issues: string[] = []

  if (!host || host === 'smtp.example.com') {
    issues.push('MAIL_SMTP_HOST_NOT_CONFIGURED')
  }
  if (!Number.isInteger(port) || port <= 0) {
    issues.push('MAIL_SMTP_PORT_INVALID')
  }
  if (!from) {
    issues.push('MAIL_FROM_NOT_CONFIGURED')
  }
  if ((user && !pass) || (!user && pass)) {
    issues.push('MAIL_SMTP_AUTH_INCOMPLETE')
  }

  return {
    config,
    host,
    port,
    user,
    pass,
    from,
    replyTo,
    issues,
    delivery: {
      enabled: notification.emailDeliveryEnabled !== false,
      intervalMs: parsePositiveInteger(notification.emailDeliveryIntervalMs, 30 * 1000),
      batchSize: parsePositiveInteger(notification.emailDeliveryBatchSize, 20),
      maxAttempts: parsePositiveInteger(notification.emailMaxAttempts, 5),
      retryBaseDelayMs: parsePositiveInteger(notification.emailRetryBaseDelayMs, 30 * 1000),
      retryMaxDelayMs: parsePositiveInteger(notification.emailRetryMaxDelayMs, 15 * 60 * 1000),
    },
  }
}

export function getMailProviderStatus(): MailProviderStatus {
  const snapshot = resolveMailSnapshot()
  return {
    provider: 'smtp',
    configured: snapshot.issues.length === 0,
    host: snapshot.host,
    port: Number.isInteger(snapshot.port) && snapshot.port > 0 ? snapshot.port : 0,
    secure: Boolean(snapshot.config.secure),
    from: snapshot.from,
    replyTo: snapshot.replyTo,
    hasAuthUser: Boolean(snapshot.user),
    hasAuthPassword: Boolean(snapshot.pass),
    issues: snapshot.issues,
    delivery: snapshot.delivery,
  }
}

export function getSharedMailConfig(): MailRuntime {
  const snapshot = resolveMailSnapshot()
  if (snapshot.issues.length > 0) {
    throw new Error('Mail delivery is not configured')
  }
  return {
    host: snapshot.host,
    port: snapshot.port,
    secure: Boolean(snapshot.config.secure),
    from: snapshot.from,
    ...(snapshot.replyTo ? { replyTo: snapshot.replyTo } : {}),
    ...(snapshot.user ? { auth: { user: snapshot.user, pass: snapshot.pass } } : {}),
  }
}

export async function sendMail(message: MailMessage): Promise<string> {
  const config = getSharedMailConfig()
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  })
  const result = await transporter.sendMail({
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: message.replyTo || config.replyTo,
  })
  return String(result.messageId || '')
}
