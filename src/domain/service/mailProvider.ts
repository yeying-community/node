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

export function getSharedMailConfig(): MailRuntime {
  const config = getConfig<MailConfig>('mail') || {}
  const host = String(config.host || '').trim()
  const port = Number(config.port)
  const user = getRuntimeSecret('MAIL_SMTP_USER')
  const pass = getRuntimeSecret('MAIL_SMTP_PASSWORD')
  const from = String(config.from || user).trim()
  const replyTo = String(config.replyTo || '').trim()
  if (!host || host === 'smtp.example.com' || !Number.isInteger(port) || port <= 0 || !from || (user && !pass) || (!user && pass)) {
    throw new Error('Mail delivery is not configured')
  }
  return { host, port, secure: Boolean(config.secure), from, ...(replyTo ? { replyTo } : {}), ...(user ? { auth: { user, pass } } : {}) }
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
