import { NotificationRuntimeConfig } from '../../../config'
import { getConfig } from '../../../config/runtime'
import { DeliveryPolicy } from './types'

function parsePositiveNumber(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export type PolicyDefaults = Omit<DeliveryPolicy, 'enabled'>

/**
 * Resolve a channel's runtime policy from the `notification` config block using
 * the established key naming: `${prefix}DeliveryEnabled/IntervalMs/BatchSize/
 * TimeoutMs`, `${prefix}ClaimTimeoutMs`, `${prefix}MaxAttempts`,
 * `${prefix}RetryBaseDelayMs`, `${prefix}RetryMaxDelayMs`.
 */
export function resolveChannelPolicy(prefix: string, defaults: PolicyDefaults): DeliveryPolicy {
  const config = (getConfig<NotificationRuntimeConfig>('notification') || {}) as Record<string, unknown>
  const read = (suffix: string) => config[`${prefix}${suffix}`]
  return {
    enabled: read('DeliveryEnabled') !== false,
    intervalMs: parsePositiveNumber(read('DeliveryIntervalMs'), defaults.intervalMs),
    batchSize: parsePositiveNumber(read('DeliveryBatchSize'), defaults.batchSize),
    deliveryTimeoutMs: parsePositiveNumber(read('DeliveryTimeoutMs'), defaults.deliveryTimeoutMs),
    claimTimeoutMs: parsePositiveNumber(read('ClaimTimeoutMs'), defaults.claimTimeoutMs),
    maxAttempts: parsePositiveNumber(read('MaxAttempts'), defaults.maxAttempts),
    retryBaseDelayMs: parsePositiveNumber(read('RetryBaseDelayMs'), defaults.retryBaseDelayMs),
    retryMaxDelayMs: parsePositiveNumber(read('RetryMaxDelayMs'), defaults.retryMaxDelayMs),
  }
}
