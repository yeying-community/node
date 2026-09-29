import { runOnce } from './delivery/engine'
import { emailDeliveryProvider } from './delivery/providers/emailProvider'

/**
 * Compatibility shim. The email delivery logic now lives in the unified
 * delivery engine + emailDeliveryProvider. This module keeps the historical
 * entry point used by tests; background scheduling is driven by
 * registry.startAllDeliveryJobs() in server.ts.
 */
export { buildNotificationEmail } from './delivery/providers/emailProvider'

export async function runEmailNotificationDeliveryOnce(): Promise<void> {
  await runOnce(emailDeliveryProvider)
}
