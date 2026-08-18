import { randomUUID } from 'crypto'
import * as jwt from 'jsonwebtoken'
import type { JwtPayload } from 'jsonwebtoken'
import { getDerivedRuntimeSecret } from '../security/secretVault'

const TOKEN_TYPE = 'custody-recovery'
const TTL_SECONDS = 5 * 60
const usedTokens = new Set<string>()
let testSecret = ''

function secret(): string {
  const value = testSecret || getDerivedRuntimeSecret('jwt-signing')
  if (!value || value.length < 32) throw new Error('Recovery token signing secret is not configured')
  return value
}

export type CustodyRecoveryClaims = {
  typ: typeof TOKEN_TYPE
  sub: string
  address: string
  appId: string
  requestId: string
  cap: string[]
  jti: string
  exp?: number
}

export function issueCustodyRecoveryToken(input: {
  subjectId: string
  walletAddress: string
  appId: string
  requestId: string
}): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + TTL_SECONDS
  const claims = {
    typ: TOKEN_TYPE,
    sub: input.subjectId,
    address: input.walletAddress,
    appId: input.appId,
    requestId: input.requestId,
    cap: ['custody:list', 'custody:read'],
    jti: randomUUID(),
  }
  return { token: jwt.sign(claims, secret(), { expiresIn: TTL_SECONDS }), expiresAt }
}

export function verifyCustodyRecoveryToken(token: string, consume = false): CustodyRecoveryClaims | null {
  try {
    const payload = jwt.verify(token, secret()) as JwtPayload & Partial<CustodyRecoveryClaims>
    if (payload.typ !== TOKEN_TYPE || typeof payload.sub !== 'string' || typeof payload.address !== 'string') return null
    if (typeof payload.jti !== 'string' || usedTokens.has(payload.jti)) return null
    if (!Array.isArray(payload.cap) || !payload.cap.includes('custody:read')) return null
    if (consume) usedTokens.add(payload.jti)
    return payload as CustodyRecoveryClaims
  } catch {
    return null
  }
}

export function consumeCustodyRecoveryToken(token: string) {
  return verifyCustodyRecoveryToken(token, true)
}

export function resetCustodyRecoveryTokensForTests() {
  usedTokens.clear()
}

export function setCustodyRecoveryTokenSecretForTests(value: string) {
  testSecret = value
}
