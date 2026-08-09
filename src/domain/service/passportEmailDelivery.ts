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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatExpiry(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '请在验证码失效前完成验证'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(time))
}

function buildVerificationEmail(input: { code: string; expiresAt: string }) {
  const code = escapeHtml(String(input.code || '').trim())
  const expiresAt = escapeHtml(formatExpiry(input.expiresAt))
  const text = `你正在验证夜莺社区身份。验证码：${input.code}。请在 ${formatExpiry(input.expiresAt)} 前完成验证。请勿向任何人透露验证码。若非本人操作，请忽略此邮件。`
  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background:#f4f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:36px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dce3ed;border-radius:10px;overflow:hidden;">
          <tr><td style="padding:28px 32px 24px;background:#0f766e;color:#ffffff;">
            <div style="font-size:20px;font-weight:700;line-height:28px;letter-spacing:0;">夜莺社区</div>
            <div style="margin-top:5px;font-size:13px;line-height:20px;color:#d8f3ee;">YeYing Community Passport</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <div style="font-size:20px;font-weight:700;line-height:30px;">验证你的社区身份</div>
            <p style="margin:12px 0 0;font-size:14px;line-height:23px;color:#526075;">你正在为夜莺通行证绑定邮箱。请输入以下验证码以完成验证。</p>
            <div style="margin:28px 0 20px;padding:18px 16px;background:#f0fdfa;border:1px solid #b9e7df;border-radius:8px;text-align:center;">
              <div style="font-size:12px;line-height:18px;color:#47736d;">验证码</div>
              <div style="margin-top:5px;font-size:32px;font-weight:700;line-height:40px;letter-spacing:8px;color:#0f766e;white-space:nowrap;">${code}</div>
            </div>
            <p style="margin:0;font-size:13px;line-height:21px;color:#66758a;">有效期至：${expiresAt}</p>
            <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5eaf1;font-size:12px;line-height:20px;color:#7a8798;">请勿向任何人透露验证码。夜莺工作人员不会通过邮件、电话或聊天工具向你索要验证码。若非本人操作，请忽略此邮件。</div>
          </td></tr>
          <tr><td style="padding:16px 32px;background:#f8fafc;font-size:12px;line-height:20px;color:#8a96a6;">此邮件由 YeYing Node 自动发送，请勿直接回复。</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
  return { text, html }
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
  const content = buildVerificationEmail({ code, expiresAt })
  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: `【夜莺社区】身份绑定验证码：${code}`,
    text: content.text,
    html: content.html,
  })
}
