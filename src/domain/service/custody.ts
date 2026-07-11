import { CustodyKeyRecordDO } from '../mapper/entity'
import { CustodyManager } from '../manager/custody'
import { getCurrentUtcString } from '../../common/date'

export type CustodyKeyRecordView = {
  walletId: string
  accountId: string
  address: string
  ciphertext?: string
  metadata: unknown
  createdAt: string
  updatedAt: string
  lastVerifiedAt: string
}

export type UpsertCustodyKeyRecordInput = {
  walletId: string
  accountId?: string
  address?: string
  ciphertext: string
  metadata?: unknown
}

function normalizeSubject(input: unknown): string {
  const value = String(input || '').trim()
  if (!value) return ''
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase()
  }
  return value
}

function parseMetadata(raw: string): unknown {
  const value = String(raw || '').trim()
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function stringifyMetadata(input: unknown): string {
  if (!input || typeof input !== 'object') {
    return '{}'
  }
  return JSON.stringify(input)
}

function toView(record: CustodyKeyRecordDO, includeCiphertext = false): CustodyKeyRecordView {
  return {
    walletId: record.walletId,
    accountId: record.accountId || '',
    address: record.address || '',
    ciphertext: includeCiphertext ? record.ciphertext : undefined,
    metadata: parseMetadata(record.metadataJson),
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || '',
    lastVerifiedAt: record.lastVerifiedAt || '',
  }
}

export class CustodyService {
  private manager: CustodyManager

  constructor() {
    this.manager = new CustodyManager()
  }

  async getStatus(subjectInput: unknown) {
    const subject = normalizeSubject(subjectInput)
    if (!subject) {
      throw new Error('INVALID_SUBJECT')
    }
    const [passkeyCount, records] = await Promise.all([
      this.manager.countActivePasskeys(subject),
      this.manager.listKeyRecords(subject),
    ])
    return {
      subject,
      passkeyBound: passkeyCount > 0,
      passkeyCount,
      enabled: records.length > 0,
      recordCount: records.length,
      records: records.map((record) => toView(record, false)),
    }
  }

  async listRecords(subjectInput: unknown) {
    const subject = normalizeSubject(subjectInput)
    if (!subject) {
      throw new Error('INVALID_SUBJECT')
    }
    const records = await this.manager.listKeyRecords(subject)
    return records.map((record) => toView(record, false))
  }

  async getRecord(subjectInput: unknown, walletIdInput: unknown) {
    const subject = normalizeSubject(subjectInput)
    const walletId = String(walletIdInput || '').trim()
    if (!subject) {
      throw new Error('INVALID_SUBJECT')
    }
    if (!walletId) {
      throw new Error('MISSING_WALLET_ID')
    }
    const record = await this.manager.getKeyRecord(subject, walletId)
    if (!record) {
      throw new Error('CUSTODY_RECORD_NOT_FOUND')
    }
    return toView(record, true)
  }

  async upsertRecord(subjectInput: unknown, input: UpsertCustodyKeyRecordInput) {
    const subject = normalizeSubject(subjectInput)
    if (!subject) {
      throw new Error('INVALID_SUBJECT')
    }
    const passkeyCount = await this.manager.countActivePasskeys(subject)
    if (passkeyCount <= 0) {
      throw new Error('PASSKEY_REQUIRED')
    }

    const walletId = String(input.walletId || '').trim()
    const ciphertext = String(input.ciphertext || '').trim()
    if (!walletId) {
      throw new Error('MISSING_WALLET_ID')
    }
    if (!ciphertext) {
      throw new Error('MISSING_CIPHERTEXT')
    }

    const now = getCurrentUtcString()
    const existing = await this.manager.getKeyRecord(subject, walletId)
    const record = existing || new CustodyKeyRecordDO()
    record.subjectType = 'wallet_address'
    record.subjectId = subject
    record.walletId = walletId
    record.accountId = String(input.accountId || '').trim()
    record.address = String(input.address || '').trim().toLowerCase()
    record.ciphertext = ciphertext
    record.metadataJson = stringifyMetadata(input.metadata)
    record.createdAt = existing?.createdAt || now
    record.updatedAt = now
    record.lastVerifiedAt = now

    const saved = await this.manager.saveKeyRecord(record)
    return toView(saved, false)
  }

  async deleteRecord(subjectInput: unknown, walletIdInput: unknown) {
    const subject = normalizeSubject(subjectInput)
    const walletId = String(walletIdInput || '').trim()
    if (!subject) {
      throw new Error('INVALID_SUBJECT')
    }
    if (!walletId) {
      throw new Error('MISSING_WALLET_ID')
    }
    await this.manager.deleteKeyRecord(subject, walletId)
    const status = await this.getStatus(subject)
    return { deleted: true, status }
  }
}

