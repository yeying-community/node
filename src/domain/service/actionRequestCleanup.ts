import { IdempotencyRuntimeConfig } from '../../config'
import { getConfig } from '../../config/runtime'
import { SingletonDataSource } from '../facade/datasource'
import { SingletonLogger } from '../facade/logger'
import { getCurrentUtcString } from '../../common/date'
import { ActionRequestDO } from '../mapper/entity'

function parsePositiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function parseNonNegativeNumber(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

async function deleteCompletedRequestsByStatusCodeRange(input: {
  cutoffIso: string
  minCode: number
  maxCode?: number
}) {
  const repository = SingletonDataSource.get().getRepository(ActionRequestDO)
  const builder = repository
    .createQueryBuilder()
    .delete()
    .from(ActionRequestDO)
    .where('status = :status', { status: 'completed' })
    .andWhere("completed_at <> ''")
    .andWhere('completed_at < :cutoffIso', { cutoffIso: input.cutoffIso })
    .andWhere('response_code >= :minCode', { minCode: input.minCode })

  if (input.maxCode !== undefined) {
    builder.andWhere('response_code < :maxCode', { maxCode: input.maxCode })
  }

  await builder.execute()
}

async function deleteExpiredPendingRequests(cutoffIso: string) {
  const repository = SingletonDataSource.get().getRepository(ActionRequestDO)
  await repository
    .createQueryBuilder()
    .delete()
    .from(ActionRequestDO)
    .where('status = :status', { status: 'pending' })
    .andWhere("created_at <> ''")
    .andWhere('created_at < :cutoffIso', { cutoffIso })
    .execute()
}

function toUtcIso(timestampMs: number) {
  const value = new Date(timestampMs).toISOString()
  return value || getCurrentUtcString()
}

function resolveIdempotencyCleanupPolicy() {
  const config = (getConfig<IdempotencyRuntimeConfig>('idempotency') || {}) as IdempotencyRuntimeConfig
  const responseRetentionDays = parseNonNegativeNumber(config.responseRetentionDays, 7)
  const successRetentionDays = parseNonNegativeNumber(
    config.successRetentionDays,
    responseRetentionDays
  )
  const failureRetentionDays = parseNonNegativeNumber(
    config.failureRetentionDays,
    Math.min(responseRetentionDays, 1)
  )
  const pendingTimeoutMs = parsePositiveNumber(config.pendingTimeoutMs, 15 * 60 * 1000)
  const cleanupIntervalMs = parsePositiveNumber(config.cleanupIntervalMs, 15 * 60 * 1000)
  return {
    successRetentionDays,
    failureRetentionDays,
    pendingTimeoutMs,
    cleanupIntervalMs
  }
}

export async function runActionRequestCleanupOnce(now = Date.now()) {
  const {
    successRetentionDays,
    failureRetentionDays,
    pendingTimeoutMs
  } = resolveIdempotencyCleanupPolicy()

  if (successRetentionDays > 0) {
    const successCutoff = toUtcIso(now - successRetentionDays * 24 * 60 * 60 * 1000)
    await deleteCompletedRequestsByStatusCodeRange({
      cutoffIso: successCutoff,
      minCode: 200,
      maxCode: 400
    })
  }

  if (failureRetentionDays > 0) {
    const failureCutoff = toUtcIso(now - failureRetentionDays * 24 * 60 * 60 * 1000)
    await deleteCompletedRequestsByStatusCodeRange({
      cutoffIso: failureCutoff,
      minCode: 400
    })
  }

  if (pendingTimeoutMs > 0) {
    const pendingCutoff = toUtcIso(now - pendingTimeoutMs)
    await deleteExpiredPendingRequests(pendingCutoff)
  }
}

export function startActionRequestCleanupJobs() {
  const logger = SingletonLogger.get()
  const { cleanupIntervalMs } = resolveIdempotencyCleanupPolicy()

  if (!Number.isFinite(cleanupIntervalMs) || cleanupIntervalMs <= 0) {
    return
  }

  const runOnce = async () => {
    try {
      await runActionRequestCleanupOnce(Date.now())
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'unknown'
      logger.warn(`action request cleanup failed: ${errMsg}`)
    }
  }

  runOnce().catch(() => undefined)
  setInterval(() => {
    runOnce().catch(() => undefined)
  }, cleanupIntervalMs)
}
