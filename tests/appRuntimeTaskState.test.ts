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
})
