import { describe, expect, it, beforeEach } from 'vitest'
import {
  issueCustodyRecoveryToken,
  consumeCustodyRecoveryToken,
  resetCustodyRecoveryTokensForTests,
  setCustodyRecoveryTokenSecretForTests,
} from '../src/auth/custodyRecoveryToken'

describe('custody recovery token', () => {
  beforeEach(() => {
    resetCustodyRecoveryTokensForTests()
    setCustodyRecoveryTokenSecretForTests('test-custody-recovery-signing-secret-32-bytes')
  })

  it('issues a read-only short-lived token', () => {
    const result = issueCustodyRecoveryToken({ subjectId: 'sub_1', walletAddress: '0xabc', appId: 'wallet-recovery', requestId: 'req_1' })
    expect(result.token).toBeTruthy()
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    const claims = consumeCustodyRecoveryToken(result.token)
    expect(claims?.typ).toBe('custody-recovery')
    expect(claims?.cap).toEqual(['custody:list', 'custody:read'])
  })

  it('rejects replay', () => {
    const { token } = issueCustodyRecoveryToken({ subjectId: 'sub_1', walletAddress: '0xabc', appId: 'wallet-recovery', requestId: 'req_1' })
    expect(consumeCustodyRecoveryToken(token)).not.toBeNull()
    expect(consumeCustodyRecoveryToken(token)).toBeNull()
  })
})
