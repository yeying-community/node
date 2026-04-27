import { SingletonLogger } from '../facade/logger'
import { SingletonDataSource } from '../facade/datasource'
import { getConfig } from '../../config/runtime'
import { MpcRuntimeConfig } from '../../config'

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function getSchemaRef() {
  const conn = SingletonDataSource.get()
  if (conn.options.type !== 'postgres') {
    return ''
  }
  const schemaOption = (conn.options as { schema?: unknown }).schema
  const schema = typeof schemaOption === 'string' && schemaOption.trim() ? schemaOption : 'public'
  return quoteIdent(schema)
}

async function cleanupTable(table: string, cutoff: number) {
  const conn = SingletonDataSource.get()
  const isPostgres = conn.options.type === 'postgres'
  const schemaRef = getSchemaRef()
  const tableRef = isPostgres ? `${schemaRef}."${table}"` : `\`${table}\``
  const createdAtExpr = isPostgres
    ? "NULLIF(created_at, '')::bigint"
    : "CAST(NULLIF(created_at, '') AS UNSIGNED)"
  const marker = isPostgres ? '$1' : '?'
  const sql = `
    DELETE FROM ${tableRef}
    WHERE ${createdAtExpr} < ${marker}
  `
  await conn.query(sql, [cutoff])
}

async function cleanupAuditTable(table: string, cutoff: number) {
  const conn = SingletonDataSource.get()
  const isPostgres = conn.options.type === 'postgres'
  const schemaRef = getSchemaRef()
  const tableRef = isPostgres ? `${schemaRef}."${table}"` : `\`${table}\``
  const timeExpr = isPostgres
    ? "NULLIF(time, '')::bigint"
    : "CAST(NULLIF(time, '') AS UNSIGNED)"
  const marker = isPostgres ? '$1' : '?'
  const sql = `
    DELETE FROM ${tableRef}
    WHERE ${timeExpr} < ${marker}
  `
  await conn.query(sql, [cutoff])
}

export function startMpcCleanupJobs() {
  const logger = SingletonLogger.get()
  const config = (getConfig<MpcRuntimeConfig>('mpc') || {}) as MpcRuntimeConfig
  const intervalMs = config.cleanupIntervalMs ?? 15 * 60 * 1000
  const messageRetentionDays = config.messageRetentionDays ?? 7
  const auditRetentionDays = config.auditRetentionDays ?? 30

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return
  }

  const runOnce = async () => {
    try {
      const now = Date.now()
      if (Number.isFinite(messageRetentionDays) && messageRetentionDays > 0) {
        const cutoff = now - messageRetentionDays * 24 * 60 * 60 * 1000
        await cleanupTable('mpc_messages', cutoff)
      }
      if (Number.isFinite(auditRetentionDays) && auditRetentionDays > 0) {
        const cutoff = now - auditRetentionDays * 24 * 60 * 60 * 1000
        await cleanupAuditTable('mpc_audit_logs', cutoff)
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown'
      logger.warn(`mpc cleanup failed: ${errMsg}`)
    }
  }

  runOnce().catch(() => undefined)
  setInterval(() => {
    runOnce().catch(() => undefined)
  }, intervalMs)
}
