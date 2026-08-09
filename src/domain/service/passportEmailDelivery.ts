import nodemailer from 'nodemailer'
import { getConfig } from '../../config/runtime'
import type { PassportEmailVerificationDelivery } from './passport'

type MailConfig = {
  host?: string
  port?: number
  secure?: boolean
  from?: string
  auth?: { user?: string; pass?: string }
}

function getMailConfig(): Required<Pick<MailConfig, 'host' | 'port' | 'secure' | 'from'>> & { auth?: { user: string; pass: string } } {
  const config = getConfig<MailConfig>('mail') || {}
  const host = String(config.host || '').trim()
  const port = Number(config.port)
  const user = String(config.auth?.user || '').trim()
  const pass = String(config.auth?.pass || '').trim()
  const from = String(config.from || user).trim()
  if (!host || host === 'smtp.example.com' || !Number.isInteger(port) || port <= 0 || !from || (user && !pass) || (!user && pass) || pass === 'CHANGE_ME') {
    throw new Error('Passport email delivery is not configured')
  }
  return { host, port, secure: Boolean(config.secure), from, ...(user ? { auth: { user, pass } } : {}) }
}

export const deliverPassportEmailVerification: PassportEmailVerificationDelivery = async ({ email, code, expiresAt }) => {
  const config = getMailConfig()
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  })
  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: 'YeYing Passport email verification code',
    text: `Your YeYing Passport email verification code is ${code}. It expires at ${expiresAt}. Do not share this code with anyone.`,
  })
}
