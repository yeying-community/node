import { getConfig } from '../config/runtime'

export type PasskeyAuthStatus = {
  enabled: boolean
  ready: boolean
  rpId: string
  rpName: string
  origin: string
  origins: string[]
  timeoutMs: number
  challengeTtlMs: number
  error?: string
}

export class PasskeyAuthError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'PasskeyAuthError'
  }
}

const DEFAULT_TIMEOUT_MS = 60 * 1000
const DEFAULT_CHALLENGE_TTL_MS = 2 * 60 * 1000

function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseOrigins(value: unknown, fallback: string): string[] {
  const input = Array.isArray(value) ? value : String(value || fallback || '').split(/[,\n]/)
  return [...new Set(input.map(item => String(item || '').trim()).filter(Boolean))]
}

export function getPasskeyAuthStatus(): PasskeyAuthStatus {
  const enabled = parseBoolean(getConfig<boolean>('identityAuth.passkey.enabled'), false)
  const rpId = String(getConfig<string>('identityAuth.passkey.rpId') || '').trim()
  const rpName = String(getConfig<string>('identityAuth.passkey.rpName') || 'YeYing Node').trim()
  const origin = String(getConfig<string>('identityAuth.passkey.origin') || '').trim()
  const origins = parseOrigins(getConfig<string[] | string>('identityAuth.passkey.origins'), origin)
  const timeoutMs = parsePositiveNumber(
    getConfig<number>('identityAuth.passkey.timeoutMs'),
    DEFAULT_TIMEOUT_MS
  )
  const challengeTtlMs = parsePositiveNumber(
    getConfig<number>('identityAuth.passkey.challengeTtlMs'),
    DEFAULT_CHALLENGE_TTL_MS
  )
  const ready = !enabled || Boolean(rpId && rpName && origins.length > 0)
  return {
    enabled,
    ready,
    rpId,
    rpName,
    origin: origins[0] || origin,
    origins,
    timeoutMs,
    challengeTtlMs,
    error: ready ? '' : 'PASSKEY_AUTH_RUNTIME_NOT_READY',
  }
}

export function assertPasskeyAuthReady(): PasskeyAuthStatus {
  const status = getPasskeyAuthStatus()
  if (!status.enabled) {
    throw new PasskeyAuthError(403, 'PASSKEY_AUTH_DISABLED', 'Passkey auth is disabled')
  }
  if (!status.ready) {
    throw new PasskeyAuthError(
      503,
      'PASSKEY_AUTH_RUNTIME_NOT_READY',
      status.error || 'Passkey auth runtime not ready'
    )
  }
  return status
}
