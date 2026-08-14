import { buildCorsOptions, isCorsOriginAllowed } from '../src/security/cors'

describe('CORS policy', () => {
  it('rejects unconfigured browser origins in production', () => {
    const config = { env: 'production', port: 8100, corsAllowedOrigins: ['https://portal.example.com'] }

    expect(isCorsOriginAllowed('https://portal.example.com', config)).toBe(true)
    expect(isCorsOriginAllowed('https://attacker.example.com', config)).toBe(false)
    expect(isCorsOriginAllowed('http://localhost:5173', config)).toBe(false)
    expect(isCorsOriginAllowed(undefined, config)).toBe(true)
  })

  it('allows localhost origins in non-production environments', () => {
    const config = { env: 'dev', port: 8100 }

    expect(isCorsOriginAllowed('http://localhost:5173', config)).toBe(true)
    expect(isCorsOriginAllowed('http://127.0.0.1:5173', config)).toBe(true)
    expect(isCorsOriginAllowed('https://attacker.example.com', config)).toBe(false)
  })

  it('uses only the config file allowlist in production', () => {
    const config = { env: 'production', port: 8100, corsAllowedOrigins: ['https://portal.example.com'] }

    expect(isCorsOriginAllowed('https://portal.example.com', config)).toBe(true)
    expect(isCorsOriginAllowed('https://new.example.com', config)).toBe(false)
  })

  it('enables credentials without accepting an arbitrary origin', () => {
    const options = buildCorsOptions({ env: 'production', port: 8100 })
    expect(options.credentials).toBe(true)
    expect(options.origin).toBeTypeOf('function')
  })
})
