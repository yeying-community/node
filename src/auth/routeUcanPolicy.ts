import type { UcanRuntimeConfig } from '../config'
import { getConfig } from '../config/runtime'
import type { UcanCapability } from './ucanPolicy'

export type RouteUcanPolicy = {
  anyOf: UcanCapability[][]
  strict: boolean
}

type RouteInput = {
  method?: string
  baseUrl?: string
  path?: string
  query?: Record<string, unknown>
}

const DEFAULT_MPC_UCAN_WITH = 'mpc'
const DEFAULT_MPC_UCAN_CAN = 'coordinate'

function mountedPath(input: RouteInput): string {
  const baseUrl = String(input.baseUrl || '').replace(/\/$/, '')
  const requestPath = String(input.path || '')
  return `${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`
}

function strictRoutePolicy(): boolean {
  const config = (getConfig<UcanRuntimeConfig>('ucan') || {}) as UcanRuntimeConfig
  return config.strictRoutePolicy === true
}

function routePolicyEnabled(): boolean {
  const config = (getConfig<UcanRuntimeConfig>('ucan') || {}) as UcanRuntimeConfig
  return config.routePolicyEnabled === true
}

function configuredMpcPolicy(): RouteUcanPolicy {
  const config = (getConfig<Record<string, unknown>>('mpc') || {}) as Record<string, unknown>
  const resource = String(config.ucanWith || DEFAULT_MPC_UCAN_WITH).trim()
  const action = String(config.ucanCan || DEFAULT_MPC_UCAN_CAN).trim()
  return {
    anyOf: [[{ with: resource || '*', can: action || '*' }]],
    strict: true,
  }
}

function single(withValue: string, can: string, strict: boolean): RouteUcanPolicy {
  return { anyOf: [[{ with: withValue, can }]], strict }
}

function applicationsPolicy(method: string): RouteUcanPolicy {
  if (method === 'GET') {
    return single('node:application:public', 'read', strictRoutePolicy())
  }
  return single('node:application:own', 'write', strictRoutePolicy())
}

function notificationsPolicy(method: string): RouteUcanPolicy {
  return single(
    'node:notification:own',
    method === 'GET' ? 'read' : 'write',
    strictRoutePolicy(),
  )
}

function auditsPolicy(method: string, path: string): RouteUcanPolicy {
  if (path === '/api/v1/public/audits/search' || method === 'GET') {
    return {
      anyOf: [
        [{ with: 'node:audit:own', can: 'read' }],
        [{ with: 'node:audit:approver', can: 'read' }],
      ],
      strict: strictRoutePolicy(),
    }
  }
  return single('node:audit:own', 'write', strictRoutePolicy())
}

function adminPolicy(path: string): RouteUcanPolicy {
  if (path.startsWith('/api/v1/admin/audits/')) {
    return {
      anyOf: [
        [{ with: 'node:audit:approver', can: 'write' }],
        [{ with: 'node:audit:admin', can: 'admin' }],
      ],
      strict: strictRoutePolicy(),
    }
  }
  if (path.startsWith('/api/v1/admin/users/')) {
    return single('node:admin:user', 'admin', strictRoutePolicy())
  }
  if (path.startsWith('/api/v1/admin/releases/')) {
    return single('node:application:admin', 'admin', strictRoutePolicy())
  }
  if (path.startsWith('/api/v1/admin/mail/')) {
    return single('node:admin:mail', 'admin', strictRoutePolicy())
  }
  return single('node:admin:user', 'admin', strictRoutePolicy())
}

export function getRouteUcanPolicy(input: RouteInput): RouteUcanPolicy | null {
  const path = mountedPath(input)
  const method = String(input.method || 'GET').toUpperCase()
  const notificationSource = String(input.query?.source || '').trim().toLowerCase()

  if (path === '/api/v1/public/notifications' && notificationSource === 'mpc') {
    return configuredMpcPolicy()
  }
  if (path.startsWith('/api/v1/public/mpc')) {
    return configuredMpcPolicy()
  }
  if (path.startsWith('/api/v1/public/custody/recovery')) {
    return { anyOf: [], strict: true }
  }
  if (path.startsWith('/api/v1/public/custody')) {
    return single('custody', 'write', true)
  }
  if (!routePolicyEnabled()) {
    return null
  }
  if (path.startsWith('/api/v1/public/applications')) {
    return applicationsPolicy(method)
  }
  if (path.startsWith('/api/v1/public/notifications')) {
    return notificationsPolicy(method)
  }
  if (path.startsWith('/api/v1/public/audits')) {
    return auditsPolicy(method, path)
  }
  if (path.startsWith('/api/v1/admin/')) {
    return adminPolicy(path)
  }
  return null
}

export function getRouteRequiredUcanCapabilities(input: RouteInput): UcanCapability[][] | null {
  return getRouteUcanPolicy(input)?.anyOf || null
}
