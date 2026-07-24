import { describe, expect, it } from 'vitest'
import { canTransitionRelease } from '../src/domain/service/appRelease'

describe('application release state machine', () => {
  it('permits the reviewed publishing lifecycle', () => {
    expect(canTransitionRelease('submitted', 'approved')).toBe(true)
    expect(canTransitionRelease('approved', 'published')).toBe(true)
    expect(canTransitionRelease('published', 'withdrawn')).toBe(true)
  })

  it('rejects skipped and terminal transitions', () => {
    expect(canTransitionRelease('submitted', 'published')).toBe(false)
    expect(canTransitionRelease('rejected', 'published')).toBe(false)
    expect(canTransitionRelease('withdrawn', 'published')).toBe(false)
  })
})
