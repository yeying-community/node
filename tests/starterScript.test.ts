import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'

function symlinkRuntimeDependency(root: string, name: string) {
  fs.symlinkSync(path.resolve('node_modules', name), path.join(root, 'node_modules', name), 'dir')
}

function createStarterFixture(appEnv: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yeying-node-starter-'))
  const runDir = path.join(root, 'run')
  const logDir = path.join(root, 'logs')
  const scriptDir = path.join(root, 'scripts')
  const distDir = path.join(root, 'dist')

  fs.mkdirSync(scriptDir, { recursive: true })
  fs.mkdirSync(distDir, { recursive: true })
  fs.mkdirSync(runDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.copyFileSync(path.resolve('scripts/starter.sh'), path.join(scriptDir, 'starter.sh'))
  symlinkRuntimeDependency(root, 'express')
  symlinkRuntimeDependency(root, 'typeorm')
  symlinkRuntimeDependency(root, 'cors')

  const configPath = path.join(root, 'config.js')
  const passwordFile = path.join(runDir, '.secrets-password')
  fs.writeFileSync(configPath, `module.exports = { app: { env: '${appEnv}' }, secrets: { file: 'run/secrets.enc.json', passwordFile: 'run/.secrets-password' } }\n`)
  fs.writeFileSync(path.join(runDir, 'secrets.enc.json'), '{"version":1,"format":"node-secrets"}')
  fs.writeFileSync(passwordFile, 'keep-me')
  fs.writeFileSync(path.join(distDir, 'server.js'), 'setInterval(() => {}, 1000)\n')

  return { root, runDir, logDir, scriptDir, configPath, passwordFile }
}

function runStarter(fixture: ReturnType<typeof createStarterFixture>, action: 'start' | 'stop', extraEnv: NodeJS.ProcessEnv = {}) {
  return execFileSync('bash', [path.join(fixture.scriptDir, 'starter.sh'), action], {
    cwd: fixture.root,
    env: {
      ...process.env,
      APP_CONFIG_PATH: fixture.configPath,
      RUN_DIR: fixture.runDir,
      LOG_DIR: fixture.logDir,
      START_WAIT_SECONDS: '1',
      ...extraEnv,
    },
    stdio: 'pipe',
  })
}

function stopAndRemoveFixture(fixture: ReturnType<typeof createStarterFixture>) {
  try {
    runStarter(fixture, 'stop')
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
}

describe('starter script environment handling', () => {
  it('preserves the configured secrets password file for config app.env test', () => {
    const fixture = createStarterFixture('test')

    try {
      runStarter(fixture, 'start', { NODE_ENV: '' })

      expect(fs.existsSync(fixture.passwordFile)).toBe(true)
      expect(fs.readFileSync(fixture.passwordFile, 'utf8')).toBe('keep-me')
    } finally {
      stopAndRemoveFixture(fixture)
    }
  })

  it('reuses and removes the configured secrets password file for config app.env production', () => {
    const fixture = createStarterFixture('production')

    try {
      runStarter(fixture, 'start', { NODE_ENV: '' })

      expect(fs.existsSync(fixture.passwordFile)).toBe(false)
    } finally {
      stopAndRemoveFixture(fixture)
    }
  })

})
