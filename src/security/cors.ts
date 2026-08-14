import { CorsOptions } from 'cors'
import { AppRuntimeConfig } from '../config'

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function isCorsOriginAllowed(
  origin: string | undefined,
  appConfig: AppRuntimeConfig
): boolean {
  if (!origin) {
    return true
  }

  const allowedOrigins = appConfig.corsAllowedOrigins || []
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
