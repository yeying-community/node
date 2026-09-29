import { registerDeliveryProvider } from '../registry'
import { dingtalkDeliveryProvider } from './dingtalkProvider'
import { emailDeliveryProvider } from './emailProvider'
import { feishuDeliveryProvider } from './feishuProvider'
import { webhookDeliveryProvider } from './webhookProvider'

/**
 * Registers every built-in delivery provider. Import this module once at
 * startup (server.ts) before calling startAllDeliveryJobs() so the registry is
 * populated. `inbox` is delivered synchronously in NotificationService and is
 * intentionally not a background provider.
 */
let registered = false

export function registerBuiltinDeliveryProviders(): void {
  if (registered) {
    return
  }
  registered = true
  registerDeliveryProvider(emailDeliveryProvider)
  registerDeliveryProvider(webhookDeliveryProvider)
  registerDeliveryProvider(dingtalkDeliveryProvider)
  registerDeliveryProvider(feishuDeliveryProvider)
}
