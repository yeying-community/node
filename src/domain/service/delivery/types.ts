import { NotificationDO, NotificationDeliveryDO, NotificationWebhookDO } from '../../mapper/entity'

/**
 * Runtime policy for one delivery channel. Mirrors the per-channel
 * `notification.{channel}Delivery*` config knobs used by the legacy workers.
 */
export type DeliveryPolicy = {
  enabled: boolean
  intervalMs: number
  batchSize: number
  claimTimeoutMs: number
  maxAttempts: number
  retryBaseDelayMs: number
  retryMaxDelayMs: number
  /** HTTP request timeout for network providers (webhook family). Ignored by email. */
  deliveryTimeoutMs: number
}

/**
 * Everything a provider needs to render and dispatch a single delivery.
 * `webhook` is preloaded by the engine only for providers that set
 * `requiresWebhook = true` (the webhook family: webhook / dingtalk / feishu).
 */
export type DeliveryContext = {
  delivery: NotificationDeliveryDO
  notification: NotificationDO
  webhook?: NotificationWebhookDO
}

export type DeliveryResult = {
  providerMessageId?: string
}

/**
 * A delivery channel implementation. The engine owns claiming, retry, backoff
 * and status transitions; a provider only turns one delivery into one outbound
 * side effect. Throw from `send` to signal failure — the engine schedules a retry.
 */
export interface DeliveryProvider {
  /** Value stored in notification_deliveries.channel, e.g. 'email' | 'webhook' | 'dingtalk' | 'feishu'. */
  readonly channel: string
  /**
   * When true the engine only claims rows whose `webhook_uid` is set and
   * preloads the NotificationWebhookDO into the DeliveryContext.
   */
  readonly requiresWebhook?: boolean
  /** Resolve the current runtime policy from config (called per run). */
  resolvePolicy(): DeliveryPolicy
  send(context: DeliveryContext): Promise<DeliveryResult>
}
