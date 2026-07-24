import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { validateReleaseBundle } from '../src/appstore/release/validator'

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(source: string) {
  return crypto.createHash('sha256').update(source).digest('hex')
}

function createBundle(overrides: Record<string, string> = {}) {
  const image = `ghcr.io/yeying-community/ai@sha256:${'a'.repeat(64)}`
  const files: Record<string, string> = {
    'application.json': JSON.stringify({
      api_version: 'yeying.app/v1', kind: 'Application',
      metadata: { id: 'ai', name: { 'zh-CN': 'AI', 'en-US': 'AI' }, description: { 'zh-CN': 'AI', 'en-US': 'AI' }, license: 'MIT' },
      spec: { version: '0.1.0', host: { project: '>=1.0.0', protocol: '^1.0.0' }, entries: [] },
    }),
    'runtime.json': JSON.stringify({
      api_version: 'yeying.app/v1', kind: 'Runtime', app_id: 'ai', version: '0.1.0', image,
      service: { name: 'ai', container_port: 5001 },
      healthcheck: { protocol: 'http', path: '/health', timeout_seconds: 30 },
    }),
    'config.schema.json': JSON.stringify({ type: 'object' }),
    'permissions.json': JSON.stringify({ host_api: [] }),
    'compose.yaml': `services:\n  ai:\n    image: ${image}\n`,
    ...overrides,
  }
  const checksums = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, sha256(content)]))
  files['checksums.json'] = JSON.stringify(checksums)
  const digest = `sha256:${sha256(stableStringify(checksums))}`
  const keys = crypto.generateKeyPairSync('ed25519')
  files['signature.json'] = JSON.stringify({
    algorithm: 'ed25519', key_id: 'test-publisher', signed_digest: digest,
    value: crypto.sign(null, Buffer.from(digest), keys.privateKey).toString('base64'),
  })
  return { files, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}

describe('release bundle validator', () => {
  it('accepts a complete bundle signed by a trusted publisher', () => {
    const bundle = createBundle()
    const result = validateReleaseBundle({ files: bundle.files }, { trustedPublisherKeys: { 'test-publisher': bundle.publicKey } })
    expect(result.appId).toBe('ai')
    expect(result.version).toBe('0.1.0')
    expect(result.image).toContain('@sha256:')
  })

  it('rejects a checksum mismatch', () => {
    const bundle = createBundle()
    bundle.files['permissions.json'] = JSON.stringify({ host_api: ['project.tasks.read'] })
    expect(() => validateReleaseBundle({ files: bundle.files }, { trustedPublisherKeys: { 'test-publisher': bundle.publicKey } })).toThrow('checksum mismatch')
  })

  it('rejects compose files with Docker socket access', () => {
    const bundle = createBundle({ 'compose.yaml': `services:\n  ai:\n    image: ghcr.io/yeying-community/ai@sha256:${'a'.repeat(64)}\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n` })
    expect(() => validateReleaseBundle({ files: bundle.files }, { trustedPublisherKeys: { 'test-publisher': bundle.publicKey } })).toThrow('forbidden runtime capability')
  })

  it('rejects signatures from unknown keys', () => {
    const bundle = createBundle()
    expect(() => validateReleaseBundle({ files: bundle.files }, { trustedPublisherKeys: {} })).toThrow('untrusted publisher key')
  })
})
