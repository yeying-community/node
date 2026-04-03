import { generateUuid } from '@/utils/common'

export type ActionSignatureInput = {
  action: string
  actor: string
  timestamp: string
  requestId: string
  payload?: unknown
}

export type SignedActionMeta = {
  requestId: string
  timestamp: string
  signature: string
}

export type CreateSignedActionBodyInput<TPayload, TBody extends Record<string, unknown>> = {
  action: string
  actor: string
  payload: TPayload
  body?: TBody
  requestId?: string
  timestamp?: string
  sign: (message: string) => Promise<string>
}

const MESSAGE_PREFIX = 'YeYing Market'

function normalizeType(value: string): string {
  return String(value || '').trim().toLowerCase()
}

export function normalizeAddress(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(String(value))
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildActionPayloadHash(payload: unknown): Promise<string> {
  return sha256Hex(stableStringify(payload))
}

export async function buildActionSignatureMessage(input: ActionSignatureInput): Promise<string> {
  const payloadHash = await buildActionPayloadHash(input.payload ?? null)
  return [
    MESSAGE_PREFIX,
    `Action: ${normalizeType(input.action)}`,
    `Actor: ${normalizeAddress(input.actor)}`,
    `Timestamp: ${input.timestamp}`,
    `RequestId: ${input.requestId}`,
    `PayloadHash: ${payloadHash}`
  ].join('\n')
}

export async function createSignedActionBody<TPayload, TBody extends Record<string, unknown>>(
  input: CreateSignedActionBodyInput<TPayload, TBody>
): Promise<TBody & SignedActionMeta> {
  const requestId = input.requestId || generateUuid()
  const timestamp = input.timestamp || new Date().toISOString()
  const message = await buildActionSignatureMessage({
    action: input.action,
    actor: input.actor,
    timestamp,
    requestId,
    payload: input.payload
  })
  const signature = await input.sign(message)
  return {
    ...((input.body || (input.payload as TBody)) as TBody),
    requestId,
    timestamp,
    signature
  }
}
