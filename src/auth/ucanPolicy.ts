export type UcanCapability = {
  with?: string
  can?: string
  resource?: string
  action?: string
  nb?: unknown
}

function normalizeActionExpression(raw: unknown): string {
  const normalized = String(raw || '').trim().toLowerCase().replace(/\|/g, ',')
  if (!normalized) return ''
  const items = normalized
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  if (!items.length) return ''
  return Array.from(new Set(items)).join(',')
}

function normalizeLoopbackAlias(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/127\.0\.0\.1/g, 'localhost')
}

function getCapabilityResource(cap: UcanCapability | null | undefined): string {
  if (!cap || typeof cap !== 'object') return ''
  if (typeof cap.with === 'string' && cap.with.trim()) {
    return cap.with.trim()
  }
  if (typeof cap.resource === 'string' && cap.resource.trim()) {
    return cap.resource.trim()
  }
  return ''
}

function getCapabilityAction(cap: UcanCapability | null | undefined): string {
  if (!cap || typeof cap !== 'object') return ''
  if (typeof cap.can === 'string' && cap.can.trim()) {
    return normalizeActionExpression(cap.can)
  }
  if (typeof cap.action === 'string' && cap.action.trim()) {
    return normalizeActionExpression(cap.action)
  }
  return ''
}

function matchPattern(pattern: string, value: string): boolean {
  const normalizedPattern = normalizeLoopbackAlias(pattern)
  const normalizedValue = normalizeLoopbackAlias(value)
  if (normalizedPattern === '*') return true
  if (normalizedPattern.endsWith('*')) {
    return normalizedValue.startsWith(normalizedPattern.slice(0, -1))
  }
  return normalizedPattern === normalizedValue
}

export function resourceCovers(availableResource: string, requiredResource: string): boolean {
  const available = String(availableResource || '').trim()
  const required = String(requiredResource || '').trim()
  if (!available || !required) return false
  return matchPattern(available, required)
}

export function actionCovers(availableAction: string, requiredAction: string): boolean {
  if (requiredAction === '*') return true
  if (availableAction === '*') return true
  const available = normalizeActionExpression(availableAction)
  const required = normalizeActionExpression(requiredAction)
  if (!available || !required) return false
  const availableSet = new Set(available.split(',').filter(Boolean))
  const requiredList = required.split(',').filter(Boolean)
  return requiredList.every(item => availableSet.has(item))
}

export function capabilityCovers(
  available: UcanCapability | null | undefined,
  required: UcanCapability | null | undefined,
): boolean {
  const availableResource = getCapabilityResource(available)
  const requiredResource = getCapabilityResource(required)
  const availableAction = getCapabilityAction(available)
  const requiredAction = getCapabilityAction(required)
  if (!availableResource || !requiredResource || !availableAction || !requiredAction) {
    return false
  }
  return resourceCovers(availableResource, requiredResource) &&
    actionCovers(availableAction, requiredAction)
}

export function capabilitiesCover(
  available: UcanCapability[] | undefined,
  required: UcanCapability[],
): boolean {
  if (!Array.isArray(available) || available.length === 0) return false
  return required.every(req => available.some(cap => capabilityCovers(cap, req)))
}
