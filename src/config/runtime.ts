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
  return process.env.APP_CONFIG_PATH || path.join(process.cwd(), 'config.json')
}

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig
  }
  const configPath = resolveConfigPath()
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}. Create it from config.json.template`)
  }
  const raw = fs.readFileSync(configPath, 'utf-8')
  cachedConfig = JSON.parse(raw) as AppConfig
  return cachedConfig
}

export function getConfig<T = unknown>(key: string): T {
  const config = loadConfig() as unknown as Record<string, unknown>
  return key.split('.').reduce((acc, part) => (acc ? (acc as any)[part] : undefined), config) as T
}
