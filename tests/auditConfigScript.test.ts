import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'

function createConfig(contents = `module.exports = {
  app: { env: 'test' },
  audit: { approvers: [], requiredApprovals: 1 }
}\n`) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yeying-node-audit-config-'))
  const configPath = path.join(root, 'config.js')
  fs.writeFileSync(configPath, contents)
  return { root, configPath }
}

function run(configPath: string, args: string[]) {
  return execFileSync('node', ['scripts/audit-config.cjs', ...args, '--config', configPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  })
}

function runCmd(configPath: string, args: string[]) {
  return execFileSync(path.resolve('cmd'), ['audit', ...args], {
    cwd: path.resolve('.'),
    env: { ...process.env, APP_CONFIG_PATH: configPath },
    encoding: 'utf8',
  })
}

function loadConfig(configPath: string) {
  delete require.cache[require.resolve(configPath)]
  return require(configPath)
}

describe('audit config command', () => {
  it('sets a normalized multi-approver policy without rewriting existing config content', () => {
    const fixture = createConfig()
    try {
      const output = run(fixture.configPath, [
        'set',
        '--approvers',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA,0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '--required-approvals',
        '2',
      ])
      const source = fs.readFileSync(fixture.configPath, 'utf8')
      const config = loadConfig(fixture.configPath)

      expect(output).toContain('Audit policy updated.')
      expect(source).toContain("app: { env: 'test' }")
      expect(source).toContain('BEGIN YEYING AUDIT CONFIG')
      expect(config.audit).toEqual({
        approvers: [
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ],
        requiredApprovals: 2,
      })
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('updates the existing managed block instead of appending duplicates', () => {
    const fixture = createConfig()
    try {
      run(fixture.configPath, [
        'set',
        '--approvers',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '--required-approvals',
        '1',
      ])
      runCmd(fixture.configPath, [
        'approver',
        'add',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ])
      const source = fs.readFileSync(fixture.configPath, 'utf8')
      expect(source.match(/BEGIN YEYING AUDIT CONFIG/g)).toHaveLength(1)
      expect(loadConfig(fixture.configPath).audit.approvers).toHaveLength(2)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('rejects an unsafe threshold and leaves the config unchanged', () => {
    const fixture = createConfig()
    try {
      const before = fs.readFileSync(fixture.configPath, 'utf8')
      const result = spawnSync(
        'node',
        [
          'scripts/audit-config.cjs',
          'set',
          '--approvers',
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '--required-approvals',
          '2',
          '--config',
          fixture.configPath,
        ],
        { cwd: path.resolve('.'), encoding: 'utf8' }
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('cannot exceed approver count')
      expect(fs.readFileSync(fixture.configPath, 'utf8')).toBe(before)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('refuses to remove an approver when the remaining policy would be invalid', () => {
    const fixture = createConfig(`module.exports = {
  audit: {
    approvers: [
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ],
    requiredApprovals: 2
  }
}\n`)
    try {
      const result = spawnSync(
        'node',
        [
          'scripts/audit-config.cjs',
          'approver',
          'remove',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          '--config',
          fixture.configPath,
        ],
        { cwd: path.resolve('.'), encoding: 'utf8' }
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('cannot exceed approver count')
      expect(loadConfig(fixture.configPath).audit.approvers).toHaveLength(2)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('preserves a config symlink while updating its target', () => {
    const fixture = createConfig()
    const symlinkPath = path.join(fixture.root, 'active-config.js')
    fs.symlinkSync(fixture.configPath, symlinkPath)
    try {
      run(symlinkPath, [
        'set',
        '--approvers',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '--required-approvals',
        '1',
      ])

      expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true)
      expect(loadConfig(fixture.configPath).audit.approvers).toEqual([
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ])
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
