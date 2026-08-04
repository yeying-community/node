import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { validateReleaseBundle } from '../src/appstore/release/validator'

describe('AppStore smoke release script', () => {
  it('generates a signed bundle accepted by the release validator', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yeying-smoke-release-'))
    const out = path.join(dir, 'smoke.json')
    const stdout = execFileSync('node', [
      'scripts/create-appstore-smoke-release.cjs',
      '--image', `registry.example/smoke@sha256:${'b'.repeat(64)}`,
      '--publisher-key-id', 'test-smoke',
      '--publisher-owner', '0x0000000000000000000000000000000000000001',
      '--out', out,
    ], { encoding: 'utf8' })
    const publicKeyJson = stdout.match(/publicKey:\s*("(?:\\.|[^"])+")/)
    expect(publicKeyJson).not.toBeNull()
    const publicKey = JSON.parse(publicKeyJson?.[1] || '""')
    const payload = JSON.parse(fs.readFileSync(out, 'utf8')) as { publisher_key_id: string; files: Record<string, string> }
    const result = validateReleaseBundle({ files: payload.files }, { trustedPublisherKeys: { [payload.publisher_key_id]: publicKey } })
    expect(result.appId).toBe('smoke')
    expect(result.version).toBe('0.1.0')
    expect(result.image).toContain('@sha256:')
  })
})
