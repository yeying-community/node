import { CorsOptions } from 'cors'
import { AppRuntimeConfig } from '../config'

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function parseAllowedOrigins(value: string | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  appConfig: AppRuntimeConfig,
  envValue = process.env.CORS_ALLOWED_ORIGINS
): boolean {
  if (!origin) {
    return true
  }

  const envOrigins = parseAllowedOrigins(envValue)
  const allowedOrigins = envOrigins.length > 0 ? envOrigins : (appConfig.corsAllowedOrigins || [])
  if (allowedOrigins.includes(origin)) {
    return true
  }

  return appConfig.env !== 'production' && LOCAL_ORIGIN_PATTERN.test(origin)
}

export function buildCorsOptions(appConfig: AppRuntimeConfig): CorsOptions {
  return {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
    origin(origin, callback) {
      callback(null, isCorsOriginAllowed(origin, appConfig))
    },
  }
}
