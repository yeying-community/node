import { describe, expect, it } from 'vitest'
import { canReportRuntimeTask } from '../src/domain/service/appRuntimeTask'

describe('runtime task state machine', () => {
  it('permits the install verification path', () => {
    expect(canReportRuntimeTask('claimed', 'applying')).toBe(true)
    expect(canReportRuntimeTask('applying', 'verifying')).toBe(true)
    expect(canReportRuntimeTask('verifying', 'succeeded')).toBe(true)
  })
  it('does not permit success before verification', () => {
    expect(canReportRuntimeTask('claimed', 'succeeded')).toBe(false)
    expect(canReportRuntimeTask('applying', 'succeeded')).toBe(false)
    expect(canReportRuntimeTask('succeeded', 'applying')).toBe(false)
  })
  it('permits an explicit rollback path', () => {
    expect(canReportRuntimeTask('verifying', 'rolling_back')).toBe(true)
    expect(canReportRuntimeTask('rolling_back', 'rolled_back')).toBe(true)
    expect(canReportRuntimeTask('rolling_back', 'rollback_failed')).toBe(true)
    expect(canReportRuntimeTask('rolled_back', 'succeeded')).toBe(false)
  })
})
