export type NotificationStreamEvent =
  | {
      event: 'notification.created'
      recipient: string
      notificationUid: string
      unreadCount?: number
      timestamp: number
      id?: string
    }
  | {
      event: 'notification.read'
      recipient: string
      notificationUid: string
      unreadCount?: number
      timestamp: number
      id?: string
    }

type Listener = (event: NotificationStreamEvent) => void

const listenersByRecipient = new Map<string, Set<Listener>>()

function normalizeRecipient(input: unknown): string {
  return String(input || '').trim().toLowerCase()
}

export function publishNotificationEvent(event: NotificationStreamEvent): void {
  const recipient = normalizeRecipient(event.recipient)
  if (!recipient) {
    return
  }
  const listeners = listenersByRecipient.get(recipient)
  if (!listeners || listeners.size === 0) {
    return
  }
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // ignore listener failures
    }
  }
}

export function subscribeNotificationEvents(recipientInput: string, listener: Listener) {
  const recipient = normalizeRecipient(recipientInput)
  if (!recipient) {
    return () => {}
  }
  const listeners = listenersByRecipient.get(recipient) ?? new Set<Listener>()
  listeners.add(listener)
  listenersByRecipient.set(recipient, listeners)
  return () => {
    const current = listenersByRecipient.get(recipient)
    if (!current) {
      return
    }
    current.delete(listener)
    if (current.size === 0) {
      listenersByRecipient.delete(recipient)
    }
  }
}
