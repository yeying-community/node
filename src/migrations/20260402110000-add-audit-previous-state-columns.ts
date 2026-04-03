import { MigrationInterface, QueryRunner } from 'typeorm'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

type AuditRow = {
  uid: string
  app_or_service_metadata: string | null
  audit_type: string | null
  target_type: string | null
  target_did: string | null
  target_version: number | string | null
  target_name: string | null
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

async function updateAuditRow(
  queryRunner: QueryRunner,
  schemaRef: string,
  uid: string,
  updates: Record<string, unknown>
) {
  const entries = Object.entries(updates)
  if (entries.length === 0) {
    return
  }
  const setClause = entries
    .map(([key], index) => `${quoteIdent(key)} = $${index + 1}`)
    .join(', ')
  await queryRunner.query(
    `UPDATE ${schemaRef}."audits" SET ${setClause} WHERE uid = $${entries.length + 1}`,
    [...entries.map(([, value]) => value), uid]
  )
}

export class AddAuditPreviousStateColumns20260402110000 implements MigrationInterface {
  name = 'AddAuditPreviousStateColumns20260402110000'

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddAuditPreviousStateColumns20260402110000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."audits"
      ADD COLUMN IF NOT EXISTS previous_target_status varchar(64) NOT NULL DEFAULT 'BUSINESS_STATUS_PENDING'
    `)
    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."audits"
      ADD COLUMN IF NOT EXISTS previous_target_is_online boolean NOT NULL DEFAULT false
    `)

    const audits = (await queryRunner.query(
      `SELECT uid,
              app_or_service_metadata,
              audit_type,
              target_type,
              target_did,
              target_version,
              target_name
         FROM ${schemaRef}."audits"`
    )) as AuditRow[]

    for (const audit of audits) {
      const metadata = parseMetadata(audit.app_or_service_metadata)
      const updates: Record<string, unknown> = {}
      if (metadata) {
        const targetType = String(audit.target_type || metadata.operateType || audit.audit_type || '').trim()
        const targetDid = String(audit.target_did || metadata.did || '').trim()
        const explicitVersion = toNumber(audit.target_version)
        const metadataVersion = toNumber(metadata.version)
        const targetVersion = Number.isFinite(explicitVersion) && explicitVersion > 0 ? explicitVersion : metadataVersion
        const targetName = String(audit.target_name || metadata.name || '').trim()

        if (targetType && audit.target_type !== targetType) {
          updates.target_type = targetType
        }
        if (targetDid && audit.target_did !== targetDid) {
          updates.target_did = targetDid
        }
        if (Number.isFinite(targetVersion) && Number(audit.target_version) !== targetVersion) {
          updates.target_version = targetVersion
        }
        if (targetName && audit.target_name !== targetName) {
          updates.target_name = targetName
        }

        if (typeof metadata.status === 'string' && metadata.status.trim() !== '') {
          updates.previous_target_status = metadata.status.trim()
          updates.previous_target_is_online = Object.prototype.hasOwnProperty.call(metadata, 'isOnline')
            ? Boolean(metadata.isOnline)
            : metadata.status.trim() === 'BUSINESS_STATUS_ONLINE'
        }
      }
      await updateAuditRow(queryRunner, schemaRef, audit.uid, updates)
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type
    if (dbType !== 'postgres') {
      throw new Error(`AddAuditPreviousStateColumns20260402110000 only supports postgres, got ${dbType}`)
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public'
    const schemaRef = quoteIdent(schema)

    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."audits"
      DROP COLUMN IF EXISTS previous_target_is_online
    `)
    await queryRunner.query(`
      ALTER TABLE ${schemaRef}."audits"
      DROP COLUMN IF EXISTS previous_target_status
    `)
  }
}
