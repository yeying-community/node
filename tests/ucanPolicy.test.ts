import { describe, expect, it } from 'vitest'
import {
  actionCovers,
  capabilitiesCover,
  capabilityCovers,
  resourceCovers,
} from '../src/auth/ucanPolicy'

describe('UCAN capability coverage', () => {
  it('allows a token wildcard to cover a concrete resource', () => {
    expect(resourceCovers('node:application:*', 'node:application:own')).toBe(true)
    expect(resourceCovers('app:all:localhost-*', 'app:all:localhost-8100')).toBe(true)
  })

  it('does not let a concrete token resource satisfy a wildcard requirement', () => {
    expect(resourceCovers('node:application:own', 'node:application:*')).toBe(false)
    expect(
      capabilityCovers(
        { with: 'node:application:own', can: 'read' },
        { with: 'node:application:*', can: 'read' },
      ),
    ).toBe(false)
  })

  it('keeps action coverage bounded by the token action', () => {
    expect(actionCovers('read,write', 'write')).toBe(true)
    expect(actionCovers('read', 'write')).toBe(false)
    expect(actionCovers('*', 'admin')).toBe(true)
  })

  it('requires every requested capability to be covered', () => {
    expect(
      capabilitiesCover(
        [{ with: 'node:application:*', can: 'read,write' }],
        [
          { with: 'node:application:own', can: 'read' },
          { with: 'node:application:own', can: 'write' },
        ],
      ),
    ).toBe(true)
    expect(
      capabilitiesCover(
        [{ with: 'node:application:own', can: 'read' }],
        [{ with: 'node:application:*', can: 'read' }],
      ),
    ).toBe(false)
  })
})
