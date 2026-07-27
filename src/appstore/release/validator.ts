import crypto from 'crypto'

export type ReleaseBundleInput = {
  files: Record<string, Buffer | string>
}

export type ReleaseValidationOptions = {
  trustedPublisherKeys: Record<string, string>
}

export type ReleaseValidationResult = {
  appId: string
  version: string
  releaseDigest: string
  image: string
}

type ApplicationManifest = {
  api_version?: unknown
  kind?: unknown
  metadata?: { id?: unknown; name?: unknown; description?: unknown; license?: unknown }
  spec?: { version?: unknown; host?: { project?: unknown; protocol?: unknown }; entries?: unknown }
}

type RuntimeManifest = {
  api_version?: unknown
  kind?: unknown
  app_id?: unknown
  version?: unknown
  image?: unknown
  service?: { name?: unknown; container_port?: unknown; host_port?: unknown; route_prefix?: unknown }
  healthcheck?: { protocol?: unknown; path?: unknown; timeout_seconds?: unknown }
  environment?: unknown
}

type SignatureManifest = {
  algorithm?: unknown
  key_id?: unknown
  signed_digest?: unknown
  value?: unknown
}

const REQUIRED_FILES = [
  'application.json',
  'runtime.json',
  'config.schema.json',
  'permissions.json',
  'compose.yaml',
  'checksums.json',
  'signature.json',
]

function fail(message: string): never {
  throw new Error(`Invalid release bundle: ${message}`)
}

function parseJson<T>(files: Record<string, Buffer | string>, file: string): T {
  const source = files[file]
  if (source === undefined) fail(`missing ${file}`)
  try {
    return JSON.parse(Buffer.isBuffer(source) ? source.toString('utf8') : source) as T
  } catch {
    fail(`${file} is not valid JSON`)
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(source: Buffer | string): string {
  return crypto.createHash('sha256').update(source).digest('hex')
}

function requireString(value: unknown, field: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || (pattern && !pattern.test(value))) {
    fail(`invalid ${field}`)
  }
  return value
}

function validateApplication(application: ApplicationManifest): { appId: string; version: string } {
  if (application.api_version !== 'yeying.app/v1' || application.kind !== 'Application') {
    fail('application.json protocol header')
  }
  const appId = requireString(application.metadata?.id, 'application.metadata.id', /^[a-z][a-z0-9-]{1,63}$/)
  requireString(application.metadata?.license, 'application.metadata.license')
  if (!application.metadata?.name || typeof application.metadata.name !== 'object') fail('application.metadata.name')
  if (!application.metadata?.description || typeof application.metadata.description !== 'object') fail('application.metadata.description')
  const version = requireString(application.spec?.version, 'application.spec.version', /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/)
  requireString(application.spec?.host?.project, 'application.spec.host.project')
  requireString(application.spec?.host?.protocol, 'application.spec.host.protocol')
  if (!Array.isArray(application.spec?.entries)) fail('application.spec.entries')
  return { appId, version }
}

function validateRuntime(runtime: RuntimeManifest, appId: string, version: string): string {
  if (runtime.api_version !== 'yeying.app/v1' || runtime.kind !== 'Runtime') fail('runtime.json protocol header')
  if (runtime.app_id !== appId || runtime.version !== version) fail('application and runtime identity mismatch')
  const image = requireString(runtime.image, 'runtime.image', /^[^\s]+@sha256:[a-f0-9]{64}$/)
  requireString(runtime.service?.name, 'runtime.service.name', /^[a-z][a-z0-9-]{0,63}$/)
  if (!Number.isInteger(runtime.service?.container_port) || Number(runtime.service?.container_port) < 1 || Number(runtime.service?.container_port) > 65535) {
    fail('runtime.service.container_port')
  }
  if (!Number.isInteger(runtime.service?.host_port) || Number(runtime.service?.host_port) < 1024 || Number(runtime.service?.host_port) > 65535) {
    fail('runtime.service.host_port')
  }
  const routePrefix = requireString(runtime.service?.route_prefix, 'runtime.service.route_prefix', /^\/apps\/[a-z][a-z0-9-]{1,63}\/$/)
  if (routePrefix !== `/apps/${appId}/`) fail('runtime.service.route_prefix')
  if (runtime.environment !== undefined) {
    if (!Array.isArray(runtime.environment)) fail('runtime.environment')
    const allowedSources = new Set(['APP_URL', 'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD', 'DB_PREFIX', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'SEARCH_HOST', 'SEARCH_PORT', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_PREFIX', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
    const names = new Set<string>()
    for (const item of runtime.environment) {
      if (!item || typeof item !== 'object') fail('runtime.environment item')
      const value = item as { name?: unknown; from_env?: unknown; required?: unknown }
      const name = requireString(value.name, 'runtime.environment.name', /^[A-Z][A-Z0-9_]{0,63}$/)
      if (names.has(name) || !allowedSources.has(String(value.from_env)) || typeof value.required !== 'boolean') fail('runtime.environment item')
      names.add(name)
    }
  }
  if (!['http', 'https'].includes(String(runtime.healthcheck?.protocol || ''))) fail('runtime.healthcheck.protocol')
  requireString(runtime.healthcheck?.path, 'runtime.healthcheck.path', /^\//)
  if (!Number.isInteger(runtime.healthcheck?.timeout_seconds) || Number(runtime.healthcheck?.timeout_seconds) < 1 || Number(runtime.healthcheck?.timeout_seconds) > 300) {
    fail('runtime.healthcheck.timeout_seconds')
  }
  return image
}

function validateCompose(compose: string, image: string): void {
  const forbidden = [
    /\bprivileged\s*:\s*true\b/i,
    /\bnetwork_mode\s*:\s*["']?host\b/i,
    /\/var\/run\/docker\.sock/i,
    /\bpid\s*:\s*["']?host\b/i,
    /\bdevices\s*:/i,
  ]
  if (forbidden.some((rule) => rule.test(compose))) fail('compose.yaml contains a forbidden runtime capability')
  if (!compose.includes(image)) fail('compose.yaml does not use the declared digest image')
}

function validateChecksums(files: Record<string, Buffer | string>): string {
  const checksums = parseJson<Record<string, unknown>>(files, 'checksums.json')
  if (!checksums || typeof checksums !== 'object' || Array.isArray(checksums)) fail('checksums.json structure')
  for (const [path, expected] of Object.entries(checksums)) {
    if (path.includes('..') || path.startsWith('/') || path === 'checksums.json' || path === 'signature.json') fail('unsafe checksum path')
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) fail(`invalid checksum for ${path}`)
    const source = files[path]
    if (source === undefined || sha256(source) !== expected) fail(`checksum mismatch for ${path}`)
  }
  for (const required of REQUIRED_FILES.filter((file) => file !== 'checksums.json' && file !== 'signature.json')) {
    if (!(required in checksums)) fail(`checksums.json does not cover ${required}`)
  }
  return `sha256:${sha256(stableStringify(checksums))}`
}

function validateSignature(files: Record<string, Buffer | string>, options: ReleaseValidationOptions, digest: string): void {
  const signature = parseJson<SignatureManifest>(files, 'signature.json')
  if (signature.algorithm !== 'ed25519') fail('unsupported signature algorithm')
  const keyId = requireString(signature.key_id, 'signature.key_id')
  const value = requireString(signature.value, 'signature.value')
  if (signature.signed_digest !== digest) fail('signature digest mismatch')
  const publicKey = options.trustedPublisherKeys[keyId]
  if (!publicKey) fail('untrusted publisher key')
  let verified = false
  try {
    verified = crypto.verify(null, Buffer.from(digest), publicKey, Buffer.from(value, 'base64'))
  } catch {
    fail('invalid publisher public key or signature')
  }
  if (!verified) fail('signature verification failed')
}

export function validateReleaseBundle(input: ReleaseBundleInput, options: ReleaseValidationOptions): ReleaseValidationResult {
  const files = input.files
  for (const required of REQUIRED_FILES) {
    if (!(required in files)) fail(`missing ${required}`)
  }
  for (const path of Object.keys(files)) {
    if (!path || path.includes('..') || path.startsWith('/') || path.includes('\\')) fail(`unsafe bundle path ${path}`)
  }
  const application = parseJson<ApplicationManifest>(files, 'application.json')
  const { appId, version } = validateApplication(application)
  const runtime = parseJson<RuntimeManifest>(files, 'runtime.json')
  const image = validateRuntime(runtime, appId, version)
  const compose = Buffer.isBuffer(files['compose.yaml']) ? files['compose.yaml'].toString('utf8') : String(files['compose.yaml'])
  validateCompose(compose, image)
  const releaseDigest = validateChecksums(files)
  validateSignature(files, options, releaseDigest)
  return { appId, version, releaseDigest, image }
}
