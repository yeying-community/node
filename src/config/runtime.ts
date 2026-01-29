import fs from 'fs'
import path from 'path'
import { AppRuntimeConfig, AuthRuntimeConfig, AuditRuntimeConfig, DatabaseConfig, UcanRuntimeConfig } from './index'
import { LoggerConfig } from '../infrastructure/logger'

export interface AppConfig {
  app: AppRuntimeConfig
  database: DatabaseConfig
  logger: LoggerConfig
  auth: AuthRuntimeConfig
  ucan: UcanRuntimeConfig
  audit?: AuditRuntimeConfig
}

let cachedConfig: AppConfig | null = null

function resolveConfigPath() {
  return process.env.APP_CONFIG_PATH || path.join(process.cwd(), 'config.js')
}

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig
  }
  const configPath = resolveConfigPath()
  const resolvedPath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}. Create it from config.js.template`)
  }
  const ext = path.extname(resolvedPath).toLowerCase()
  if (ext === '.js' || ext === '.cjs') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(resolvedPath)
    cachedConfig = (loaded && loaded.default ? loaded.default : loaded) as AppConfig
  } else {
    const raw = fs.readFileSync(resolvedPath, 'utf-8')
    cachedConfig = JSON.parse(raw) as AppConfig
  }
  return cachedConfig
}

export function getConfig<T = unknown>(key: string): T {
  const config = loadConfig() as unknown as Record<string, unknown>
  return key.split('.').reduce((acc, part) => (acc ? (acc as any)[part] : undefined), config) as T
}
