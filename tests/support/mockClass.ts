import { vi } from 'vitest'

export function mockClass<T extends object>(factory: () => T) {
  return vi.fn(function MockedClass() {
    return factory()
  })
}
