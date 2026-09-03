import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { Repository } from 'typeorm'
import { getCurrentUtcString } from '../../common/date'
import { getDerivedRuntimeSecret } from '../../security/secretVault'
import { SingletonDataSource } from '../facade/datasource'
import { EmailTemplateDO, NotificationPreferenceDO, ProjectIdentityMappingDO, PusherAppDO, PusherEventDO } from '../mapper/entity'
import { NotificationService } from './notification'
import { publishPusherEvent, type PusherStreamEvent } from './pusherEvents'

const APP_SECRET_CIPHER_VERSION = 'v1'
const APP_SECRET_CONTEXT = Buffer.from('pusher-app-secret:v1', 'utf8')
const SIGNATURE_PREFIX = 'sha256='
const DEFAULT_SIGNATURE_SKEW_MS = 5 * 60 * 1000
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024

export type PusherAppRecord = {
  uid: string
  applicationUid: string
  owner: string
  appId: string
  key: string
  secretMasked: string
  allowedOrigins: string[]
  channelPatterns: string[]
  status: string
  createdAt: string
  updatedAt: string
}

export type PusherAppCreateResult = PusherAppRecord & {
  secret: string
}

export type PusherPublishInput = {
  appId: string
  key: string
  timestamp: string
  signature: string
  body: Record<string, unknown>
}

export type PusherPublishResult = {
  eventId: string
  accepted: boolean
  idempotent: boolean
  channels: string[]
  persisted: boolean
}

export type PusherBacklogItem = PusherStreamEvent

export type ProjectIdentityMappingRecord = {
  uid: string
  instanceId: string
  projectUserId: string
  identityDid: string
  walletAddress: string
  metadata: Record<string, unknown>
  status: string
  createdAt: string
  updatedAt: string
}

export type NotificationPreferenceRecord = {
  uid: string
  subject: string
  appId: string
  eventType: string
  inboxEnabled: boolean
  emailEnabled: boolean
  digestMode: string
  createdAt: string
  updatedAt: string
}

export type EmailTemplateRecord = {
  uid: string
  templateId: string
  version: number
  appId: string
  category: string
  eventTypes: string[]
  subject: Record<string, string>
  htmlBody: Record<string, string>
  textBody: Record<string, string>
  variables: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(input: string): Buffer {
  const normalized = String(input || '').trim().replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4 || 4)) % 4
  return Buffer.from(`${normalized}${'='.repeat(padLength)}`, 'base64')
}

function resolvePusherSecretMasterKey(): Buffer {
  const configured = getDerivedRuntimeSecret('pusher-app')
  if (!configured) {
    throw new Error('NODE_KEY_DERIVATION_SECRET is required in secrets.enc.json when pusher app secret is used')
  }
  return Buffer.from(configured, 'utf8')
}

function derivePusherSecretEncryptionKey(masterKey: Buffer): Buffer {
  return crypto.createHash('sha256').update(masterKey).update(APP_SECRET_CONTEXT).digest()
}

export function encryptPusherAppSecret(secret: string): string {
  const normalized = String(secret || '').trim()
  if (!normalized) {
    return ''
  }
  const key = derivePusherSecretEncryptionKey(resolvePusherSecretMasterKey())
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(normalized, 'utf8')), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${APP_SECRET_CIPHER_VERSION}.${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(ciphertext)}`
}

export function decryptPusherAppSecret(ciphertextInput: string): string {
  const ciphertext = String(ciphertextInput || '').trim()
  if (!ciphertext) {
    return ''
  }
  const [version, ivEncoded, authTagEncoded, payloadEncoded] = ciphertext.split('.')
  if (version !== APP_SECRET_CIPHER_VERSION || !ivEncoded || !authTagEncoded || !payloadEncoded) {
    throw new Error('Stored pusher app secret is invalid')
  }
  try {
    const key = derivePusherSecretEncryptionKey(resolvePusherSecretMasterKey())
    const iv = fromBase64Url(ivEncoded)
    const authTag = fromBase64Url(authTagEncoded)
    const payload = fromBase64Url(payloadEncoded)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Stored pusher app secret is invalid')
  }
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function buildPusherPublishSignature(input: {
  timestamp: string
  body: Record<string, unknown>
  secret: string
}): string {
  const payload = `${String(input.timestamp || '').trim()}.${canonicalJson(input.body || {})}`
  return `${SIGNATURE_PREFIX}${crypto.createHmac('sha256', input.secret).update(payload).digest('hex')}`
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function normalizeIdentifier(input: unknown, fallback: string): string {
  const value = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return value || fallback
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }
  return Array.from(new Set(input.map((item) => String(item || '').trim()).filter(Boolean)))
}

function maskSecret(secret: string): string {
  const normalized = String(secret || '').trim()
  if (normalized.length <= 10) {
    return '***'
  }
  return `${normalized.slice(0, 6)}***${normalized.slice(-4)}`
}

function globToRegExp(pattern: string): RegExp {
  const escaped = String(pattern || '')
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function matchesAnyPattern(channel: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false
  }
  return patterns.some((pattern) => globToRegExp(pattern).test(channel))
}

function parseCursor(input: string): { createdAt: string; uid: string } | null {
  const text = String(input || '').trim()
  if (!text) {
    return null
  }
  const separator = text.indexOf('|')
  if (separator <= 0) {
    return { createdAt: text, uid: '' }
  }
  try {
    return {
      createdAt: decodeURIComponent(text.slice(0, separator)),
      uid: decodeURIComponent(text.slice(separator + 1)),
    }
  } catch {
    return null
  }
}

function buildStreamEventId(event: Pick<PusherEventDO, 'createdAt' | 'uid'>): string {
  return `${encodeURIComponent(event.createdAt || '')}|${encodeURIComponent(event.uid || '')}`
}

function estimatePayloadBytes(body: Record<string, unknown>): number {
  return Buffer.byteLength(canonicalJson(body || {}), 'utf8')
}

function normalizeNotificationLevel(input: unknown): 'info' | 'success' | 'warning' | 'error' {
  const value = String(input || '').trim()
  if (value === 'success' || value === 'warning' || value === 'error') {
    return value
  }
  return 'info'
}

function isSecurityEventType(eventType: string): boolean {
  return eventType.startsWith('security.') || eventType.includes('.security.')
}

function parsePrivateProjectInstanceId(channel: string): string {
  const parts = String(channel || '').trim().split('.')
  if (parts[0] !== 'private-project' || !parts[1]) {
    return ''
  }
  return normalizeIdentifier(parts[1], '')
}

function normalizeOrigin(input: unknown): string {
  return String(input || '').trim().replace(/\/$/g, '').toLowerCase()
}

export class PusherService {
  private appRepository: Repository<PusherAppDO>
  private eventRepository: Repository<PusherEventDO>
  private projectIdentityRepository: Repository<ProjectIdentityMappingDO>
  private preferenceRepository: Repository<NotificationPreferenceDO>
  private emailTemplateRepository: Repository<EmailTemplateDO>
  private notificationService: NotificationService

  constructor(notificationService = new NotificationService()) {
    const dataSource = SingletonDataSource.get()
    this.appRepository = dataSource.getRepository(PusherAppDO)
    this.eventRepository = dataSource.getRepository(PusherEventDO)
    this.projectIdentityRepository = dataSource.getRepository(ProjectIdentityMappingDO)
    this.preferenceRepository = dataSource.getRepository(NotificationPreferenceDO)
    this.emailTemplateRepository = dataSource.getRepository(EmailTemplateDO)
    this.notificationService = notificationService
  }

  private mapApp(app: PusherAppDO): PusherAppRecord {
    return {
      uid: app.uid,
      applicationUid: app.applicationUid,
      owner: app.owner,
      appId: app.appId,
      key: app.key,
      secretMasked: app.secretMasked,
      allowedOrigins: parseJsonArray(app.allowedOriginsJson),
      channelPatterns: parseJsonArray(app.channelPatternsJson),
      status: app.status,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    }
  }

  private mapEvent(event: PusherEventDO): PusherStreamEvent {
    return {
      id: buildStreamEventId(event),
      appId: event.appId,
      type: event.type,
      channels: parseJsonArray(event.channelsJson),
      data: parseJsonObject(event.dataJson),
      source: event.source,
      actor: event.actor,
      createdAt: event.createdAt,
    }
  }

  private mapProjectIdentityMapping(mapping: ProjectIdentityMappingDO): ProjectIdentityMappingRecord {
    return {
      uid: mapping.uid,
      instanceId: mapping.instanceId,
      projectUserId: mapping.projectUserId,
      identityDid: mapping.identityDid,
      walletAddress: mapping.walletAddress,
      metadata: parseJsonObject(mapping.metadataJson),
      status: mapping.status,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    }
  }

  private mapPreference(preference: NotificationPreferenceDO): NotificationPreferenceRecord {
    return {
      uid: preference.uid,
      subject: preference.subject,
      appId: preference.appId,
      eventType: preference.eventType,
      inboxEnabled: Boolean(preference.inboxEnabled),
      emailEnabled: Boolean(preference.emailEnabled),
      digestMode: preference.digestMode,
      createdAt: preference.createdAt,
      updatedAt: preference.updatedAt,
    }
  }

  private mapEmailTemplate(template: EmailTemplateDO): EmailTemplateRecord {
    return {
      uid: template.uid,
      templateId: template.templateId,
      version: template.version,
      appId: template.appId,
      category: template.category,
      eventTypes: parseJsonArray(template.eventTypesJson),
      subject: parseJsonObject(template.subjectJson) as Record<string, string>,
      htmlBody: parseJsonObject(template.htmlBodyJson) as Record<string, string>,
      textBody: parseJsonObject(template.textBodyJson) as Record<string, string>,
      variables: parseJsonArray(template.variablesJson),
      enabled: Boolean(template.enabled),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }
  }

  private async requireActiveApp(appId: string): Promise<PusherAppDO> {
    const normalizedAppId = normalizeIdentifier(appId, '')
    const app = await this.appRepository.findOneBy({ appId: normalizedAppId })
    if (!app || app.status !== 'active') {
      throw new Error('Pusher app not found')
    }
    return app
  }

  async createApp(input: {
    appId?: string
    applicationUid?: string
    owner?: string
    allowedOrigins?: string[]
    channelPatterns?: string[]
  }): Promise<PusherAppCreateResult> {
    const now = getCurrentUtcString()
    const appId = normalizeIdentifier(input.appId, `app-${randomUUID()}`)
    const applicationUid = String(input.applicationUid || '').trim()
    const existing = await this.appRepository.findOneBy({ appId })
    if (existing) {
      throw new Error('Pusher app already exists')
    }
    if (applicationUid) {
      const existingForApplication = await this.appRepository.findOneBy({ applicationUid })
      if (existingForApplication) {
        throw new Error('Pusher app already exists for application')
      }
    }

    const secret = `ps_${toBase64Url(crypto.randomBytes(32))}`
    const app = this.appRepository.create({
      uid: randomUUID(),
      applicationUid,
      owner: String(input.owner || '').trim().toLowerCase(),
      appId,
      key: `pk_${toBase64Url(crypto.randomBytes(18))}`,
      secretMasked: maskSecret(secret),
      secretCiphertext: encryptPusherAppSecret(secret),
      allowedOriginsJson: JSON.stringify(normalizeStringArray(input.allowedOrigins)),
      channelPatternsJson: JSON.stringify(
        normalizeStringArray(input.channelPatterns).length > 0
          ? normalizeStringArray(input.channelPatterns)
          : ['public-*', 'private-user.*']
      ),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    const saved = await this.appRepository.save(app)
    return {
      ...this.mapApp(saved),
      secret,
    }
  }

  async getAppByApplicationUid(applicationUidInput: string): Promise<PusherAppRecord | null> {
    const applicationUid = String(applicationUidInput || '').trim()
    if (!applicationUid) {
      return null
    }
    const app = await this.appRepository.findOneBy({ applicationUid })
    return app ? this.mapApp(app) : null
  }

  async rotateAppCredentials(input: {
    applicationUid: string
    allowedOrigins?: string[]
  }): Promise<PusherAppCreateResult> {
    const applicationUid = String(input.applicationUid || '').trim()
    if (!applicationUid) {
      throw new Error('Application uid is required')
    }
    const app = await this.appRepository.findOneBy({ applicationUid })
    if (!app) {
      throw new Error('Pusher app not found for application')
    }

    const now = getCurrentUtcString()
    const secret = `ps_${toBase64Url(crypto.randomBytes(32))}`
    app.key = `pk_${toBase64Url(crypto.randomBytes(18))}`
    app.secretMasked = maskSecret(secret)
    app.secretCiphertext = encryptPusherAppSecret(secret)
    if (input.allowedOrigins !== undefined) {
      app.allowedOriginsJson = JSON.stringify(normalizeStringArray(input.allowedOrigins))
    }
    app.updatedAt = now

    const saved = await this.appRepository.save(app)
    return {
      ...this.mapApp(saved),
      secret,
    }
  }

  async listApps(): Promise<PusherAppRecord[]> {
    const rows = await this.appRepository.find({
      order: { createdAt: 'DESC' },
    })
    return rows.map((row) => this.mapApp(row))
  }

  async upsertProjectIdentityMapping(input: {
    instanceId: string
    projectUserId: string
    identityDid: string
    walletAddress?: string
    metadata?: Record<string, unknown>
    status?: string
  }): Promise<ProjectIdentityMappingRecord> {
    const instanceId = normalizeIdentifier(input.instanceId, '')
    const projectUserId = String(input.projectUserId || '').trim()
    const identityDid = String(input.identityDid || '').trim().toLowerCase()
    const walletAddress = String(input.walletAddress || '').trim().toLowerCase()
    if (!instanceId || !projectUserId || !identityDid) {
      throw new Error('Project identity mapping requires instanceId, projectUserId and identityDid')
    }
    const now = getCurrentUtcString()
    const existing = await this.projectIdentityRepository.findOneBy({ instanceId, projectUserId })
    const mapping = existing || this.projectIdentityRepository.create({ createdAt: now })
    mapping.instanceId = instanceId
    mapping.projectUserId = projectUserId
    mapping.identityDid = identityDid
    mapping.walletAddress = walletAddress
    mapping.metadataJson = JSON.stringify(input.metadata || {})
    mapping.status = String(input.status || 'active').trim() || 'active'
    mapping.updatedAt = now
    const saved = await this.projectIdentityRepository.save(mapping)
    return this.mapProjectIdentityMapping(saved)
  }

  async listProjectIdentityMappings(instanceIdInput: string): Promise<ProjectIdentityMappingRecord[]> {
    const instanceId = normalizeIdentifier(instanceIdInput, '')
    if (!instanceId) {
      return []
    }
    const rows = await this.projectIdentityRepository.find({
      where: { instanceId },
      order: { updatedAt: 'DESC' },
    })
    return rows.map((row) => this.mapProjectIdentityMapping(row))
  }

  async listNotificationPreferences(subjectInput: string): Promise<NotificationPreferenceRecord[]> {
    const subject = String(subjectInput || '').trim().toLowerCase()
    if (!subject) {
      return []
    }
    const rows = await this.preferenceRepository.find({
      where: { subject },
      order: { updatedAt: 'DESC' },
    })
    return rows.map((row) => this.mapPreference(row))
  }

  async upsertNotificationPreference(input: {
    subject: string
    appId?: string
    eventType?: string
    inboxEnabled?: boolean
    emailEnabled?: boolean
    digestMode?: string
  }): Promise<NotificationPreferenceRecord> {
    const subject = String(input.subject || '').trim().toLowerCase()
    if (!subject) {
      throw new Error('Notification preference subject is required')
    }
    const appId = normalizeIdentifier(input.appId, '')
    const eventType = String(input.eventType || '').trim()
    if (input.emailEnabled === false && isSecurityEventType(eventType)) {
      throw new Error('Security email notifications cannot be disabled')
    }
    const now = getCurrentUtcString()
    const existing = await this.preferenceRepository.findOneBy({ subject, appId, eventType })
    const preference = existing || this.preferenceRepository.create({ createdAt: now })
    preference.subject = subject
    preference.appId = appId
    preference.eventType = eventType
    preference.inboxEnabled = input.inboxEnabled !== false
    preference.emailEnabled = input.emailEnabled !== false
    preference.digestMode = String(input.digestMode || 'disabled').trim() || 'disabled'
    preference.updatedAt = now
    const saved = await this.preferenceRepository.save(preference)
    return this.mapPreference(saved)
  }

  async listEmailTemplates(): Promise<EmailTemplateRecord[]> {
    const rows = await this.emailTemplateRepository.find({
      order: { updatedAt: 'DESC' },
    })
    return rows.map((row) => this.mapEmailTemplate(row))
  }

  async upsertEmailTemplate(input: {
    templateId: string
    version?: number
    appId?: string
    category?: string
    eventTypes?: string[]
    subject?: Record<string, string>
    htmlBody?: Record<string, string>
    textBody?: Record<string, string>
    variables?: string[]
    enabled?: boolean
  }): Promise<EmailTemplateRecord> {
    const templateId = normalizeIdentifier(input.templateId, '')
    const version = Number.isFinite(input.version) && Number(input.version) > 0 ? Math.trunc(Number(input.version)) : 1
    if (!templateId) {
      throw new Error('Email template id is required')
    }
    const subject = input.subject || {}
    const htmlBody = input.htmlBody || {}
    const textBody = input.textBody || {}
    if (!subject['zh-CN'] || !htmlBody['zh-CN'] || !textBody['zh-CN']) {
      throw new Error('Email template requires zh-CN subject, htmlBody and textBody')
    }
    const now = getCurrentUtcString()
    const existing = await this.emailTemplateRepository.findOneBy({ templateId, version })
    const template = existing || this.emailTemplateRepository.create({ createdAt: now })
    template.templateId = templateId
    template.version = version
    template.appId = normalizeIdentifier(input.appId, '')
    template.category = String(input.category || 'transactional').trim() || 'transactional'
    template.eventTypesJson = JSON.stringify(normalizeStringArray(input.eventTypes))
    template.subjectJson = JSON.stringify(subject)
    template.htmlBodyJson = JSON.stringify(htmlBody)
    template.textBodyJson = JSON.stringify(textBody)
    template.variablesJson = JSON.stringify(normalizeStringArray(input.variables))
    template.enabled = input.enabled !== false
    template.updatedAt = now
    const saved = await this.emailTemplateRepository.save(template)
    return this.mapEmailTemplate(saved)
  }

  async publish(input: PusherPublishInput): Promise<PusherPublishResult> {
    const app = await this.requireActiveApp(input.appId)
    if (String(input.key || '').trim() !== app.key) {
      throw new Error('Invalid pusher key')
    }

    const timestampMs = Date.parse(String(input.timestamp || '').trim())
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > DEFAULT_SIGNATURE_SKEW_MS) {
      throw new Error('Invalid pusher timestamp')
    }

    if (estimatePayloadBytes(input.body) > DEFAULT_MAX_PAYLOAD_BYTES) {
      throw new Error('Pusher payload too large')
    }

    const secret = decryptPusherAppSecret(app.secretCiphertext)
    const expectedSignature = buildPusherPublishSignature({
      timestamp: input.timestamp,
      body: input.body,
      secret,
    })
    if (!timingSafeEqualString(String(input.signature || '').trim(), expectedSignature)) {
      throw new Error('Invalid pusher signature')
    }

    const type = String(input.body.type || input.body.name || '').trim()
    if (!type) {
      throw new Error('Pusher event type is required')
    }
    const channels = normalizeStringArray(input.body.channels)
    if (channels.length === 0) {
      throw new Error('Pusher channels are required')
    }
    if (channels.length > 20) {
      throw new Error('Too many pusher channels')
    }
    const patterns = parseJsonArray(app.channelPatternsJson)
    const unauthorizedChannel = channels.find((channel) => !matchesAnyPattern(channel, patterns))
    if (unauthorizedChannel) {
      throw new Error(`Pusher channel is not allowed: ${unauthorizedChannel}`)
    }

    const now = getCurrentUtcString()
    const eventId = normalizeIdentifier(input.body.eventId, `evt-${randomUUID()}`)
    const existing = await this.eventRepository.findOneBy({ appId: app.appId, eventId })
    if (existing) {
      return {
        eventId: existing.eventId,
        accepted: true,
        idempotent: true,
        channels: parseJsonArray(existing.channelsJson),
        persisted: Boolean(existing.persist),
      }
    }

    const data =
      input.body.data && typeof input.body.data === 'object' && !Array.isArray(input.body.data)
        ? (input.body.data as Record<string, unknown>)
        : {}
    const notification =
      input.body.notification && typeof input.body.notification === 'object' && !Array.isArray(input.body.notification)
        ? (input.body.notification as Record<string, unknown>)
        : {}
    const persist = input.body.persist === true || Object.keys(notification).length > 0
    const actor = String(input.body.actor || '').trim().toLowerCase()
    const source = String(input.body.source || app.appId).trim() || app.appId

    const event = this.eventRepository.create({
      appId: app.appId,
      eventId,
      type,
      source,
      actor,
      channelsJson: JSON.stringify(channels),
      dataJson: JSON.stringify(data),
      notificationJson: JSON.stringify(notification),
      persist,
      createdAt: now,
    })
    const saved = await this.eventRepository.save(event)

    const streamEvent = this.mapEvent(saved)
    publishPusherEvent(streamEvent)

    if (persist) {
      await this.persistNotification({
        event: saved,
        data,
        notification,
        recipients: normalizeStringArray(input.body.recipients),
      })
    }

    return {
      eventId,
      accepted: true,
      idempotent: false,
      channels,
      persisted: persist,
    }
  }

  async listBacklog(input: {
    appId: string
    channels: string[]
    cursor?: string
    limit?: number
  }): Promise<PusherBacklogItem[]> {
    await this.requireActiveApp(input.appId)
    const channels = normalizeStringArray(input.channels)
    if (channels.length === 0) {
      return []
    }
    const cursor = parseCursor(input.cursor || '')
    const limit = Math.min(Math.max(Math.trunc(Number(input.limit || 100)), 1), 200)
    const rows = await this.eventRepository.find({
      where: { appId: normalizeIdentifier(input.appId, '') },
      order: { createdAt: 'ASC' },
      take: limit * 5,
    })
    return rows
      .filter((event) => {
        if (!cursor) {
          return true
        }
        if (event.createdAt > cursor.createdAt) {
          return true
        }
        return event.createdAt === cursor.createdAt && event.uid > cursor.uid
      })
      .filter((event) => parseJsonArray(event.channelsJson).some((channel) => channels.includes(channel)))
      .slice(0, limit)
      .map((event) => this.mapEvent(event))
  }

  async assertCanSubscribe(input: { appId: string; channels: string[]; subject: string; origin?: string }): Promise<void> {
    const app = await this.requireActiveApp(input.appId)
    const allowedOrigins = parseJsonArray(app.allowedOriginsJson).map(normalizeOrigin).filter(Boolean)
    const origin = normalizeOrigin(input.origin)
    if (allowedOrigins.length > 0 && (!origin || !allowedOrigins.includes(origin))) {
      throw new Error('Pusher origin is not allowed')
    }
    const patterns = parseJsonArray(app.channelPatternsJson)
    const normalizedSubject = String(input.subject || '').trim().toLowerCase()
    if (!normalizedSubject) {
      throw new Error('Missing subscribe subject')
    }
    for (const channel of normalizeStringArray(input.channels)) {
      if (!matchesAnyPattern(channel, patterns)) {
        throw new Error(`Pusher channel is not allowed: ${channel}`)
      }
      if (channel.startsWith('private-user.')) {
        const expected = `private-user.${normalizedSubject}`
        if (channel.toLowerCase() !== expected) {
          throw new Error(`Pusher channel subscription denied: ${channel}`)
        }
        continue
      }
      if (channel.startsWith('private-')) {
        const instanceId = parsePrivateProjectInstanceId(channel)
        if (instanceId) {
          const byIdentity = await this.projectIdentityRepository.findOneBy({
            instanceId,
            identityDid: normalizedSubject,
            status: 'active',
          })
          if (byIdentity) {
            continue
          }
          const byWallet = await this.projectIdentityRepository.findOneBy({
            instanceId,
            walletAddress: normalizedSubject,
            status: 'active',
          })
          if (byWallet) {
            continue
          }
        }
        throw new Error(`Pusher private channel subscription denied: ${channel}`)
      }
    }
  }

  private async persistNotification(input: {
    event: PusherEventDO
    data: Record<string, unknown>
    notification: Record<string, unknown>
    recipients: string[]
  }): Promise<void> {
    const title = String(input.notification.title || input.event.type).trim()
    const recipients = normalizeStringArray(input.recipients)
    if (!title || recipients.length === 0) {
      return
    }
    await this.notificationService.create({
      type: input.event.type,
      source: input.event.source || input.event.appId,
      subjectType: String(input.notification.subjectType || 'pusher_event').trim() || 'pusher_event',
      subjectId: String(input.notification.subjectId || input.event.eventId).trim() || input.event.eventId,
      actor: input.event.actor,
      audienceType: 'user',
      recipients,
      level: normalizeNotificationLevel(input.notification.level),
      title,
      body: String(input.notification.body || '').trim(),
      payload: {
        pusherEventId: input.event.eventId,
        appId: input.event.appId,
        data: input.data,
      },
    })
  }
}
