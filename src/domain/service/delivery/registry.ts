import { startJob } from './engine'
import { DeliveryProvider } from './types'

/**
 * Central registry of delivery providers. Providers register themselves at
 * module load (see ./providers/index) and the server starts one polling job
 * per registered channel via startAllDeliveryJobs().
 */
const providers = new Map<string, DeliveryProvider>()

export function registerDeliveryProvider(provider: DeliveryProvider): void {
  providers.set(provider.channel, provider)
}

export function getDeliveryProvider(channel: string): DeliveryProvider | undefined {
  return providers.get(String(channel || '').trim())
}

export function listDeliveryProviders(): DeliveryProvider[] {
  return Array.from(providers.values())
}

/** Channels that are stored as notification_webhooks rows (webhook family). */
export function isWebhookFamilyChannel(channel: string): boolean {
  const provider = getDeliveryProvider(channel)
  return provider?.requiresWebhook === true
}

export function startAllDeliveryJobs(): void {
  for (const provider of providers.values()) {
    startJob(provider)
  }
}
