import * as crypto from 'crypto';
import type { UcanCapability } from './ucanIssuer';
import { getConfig } from '../config/runtime';

export type MobileBindRequestStatus = 'pending' | 'used' | 'expired' | 'revoked';

export type MobileAuthStatus = {
  enabled: boolean;
  ready: boolean;
  issuerName: string;
  verifyPath: string;
  portalBaseUrl: string;
  requestTtlMs: number;
  codeDigits: number;
  codePeriodSec: number;
  codeWindow: number;
  maxAttempts: number;
  error?: string;
};

export type MobileTotpProvision = {
  subject: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: 'SHA1';
  digits: number;
  period: number;
  otpauthUri: string;
};

export type MobileBindRequestCreateResult = {
  requestId: string;
  status: MobileBindRequestStatus;
  subject: string;
  subjectHint: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  redirectUri?: string;
  createdAt: number;
  expiresAt: number;
  verifyUrl: string;
};

export type MobileBindRequestPublicResult = Omit<MobileBindRequestCreateResult, 'subject'>;

export type MobileBindConsumeResult = {
  requestId: string;
  subject: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  redirectUri?: string;
  sessionTtlMs?: number;
  tokenTtlMs?: number;
  approvedAt: number;
};

export type CreateMobileBindRequestInput = {
  subject: string;
  audience: string;
  capabilities: UcanCapability[];
  appName?: string;
  redirectUri?: string;
  requestTtlMs?: number;
  sessionTtlMs?: number;
  tokenTtlMs?: number;
};

export class MobileAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'MobileAuthError';
  }
}

type MobileAuthRuntimeState = {
  enabled: boolean;
  ready: boolean;
  issuerName: string;
  verifyPath: string;
  portalBaseUrl: string;
  requestTtlMs: number;
  codeDigits: number;
  codePeriodSec: number;
  codeWindow: number;
  maxAttempts: number;
  masterKey?: Buffer;
  error?: string;
};

type MobileBindRequestRecord = {
  requestId: string;
  status: MobileBindRequestStatus;
  subject: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  redirectUri?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  attempts: number;
  sessionTtlMs?: number;
  tokenTtlMs?: number;
};

const DEFAULT_PORT = parsePositiveNumber(
  process.env.APP_PORT ?? getConfig<number>('app.port'),
  8100
);
const DEFAULT_ISSUER_NAME = 'YeYing Node';
const DEFAULT_VERIFY_PATH = '/mobile-auth';
const DEFAULT_PORTAL_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const DEFAULT_REQUEST_TTL_MS = 5 * 60 * 1000;
const MIN_REQUEST_TTL_MS = 60 * 1000;
const MAX_REQUEST_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CODE_DIGITS = 6;
const DEFAULT_CODE_PERIOD_SEC = 30;
const DEFAULT_CODE_WINDOW = 1;
const MAX_CODE_WINDOW = 5;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_MAX_ATTEMPTS = 20;
const GC_RETENTION_MS = 24 * 60 * 60 * 1000;

const MOBILE_BIND_REQUESTS = new Map<string, MobileBindRequestRecord>();
const MOBILE_AUTH_RUNTIME = loadMobileAuthRuntime();

function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function decodeMasterKey(raw: string): Buffer {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    throw new Error('Missing mobile auth TOTP master key');
  }

  const hex = normalized.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length >= 32 && hex.length % 2 === 0) {
    return Buffer.from(hex, 'hex');
  }

  try {
    const fromBase64 = Buffer.from(normalized, 'base64');
    if (fromBase64.length >= 16) {
      return fromBase64;
    }
  } catch {
    // fallback to utf8 below
  }

  return Buffer.from(normalized, 'utf8');
}

function normalizeVerifyPath(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) return DEFAULT_VERIFY_PATH;
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeBaseUrl(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

function normalizeSubject(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase();
  }
  return value;
}

function normalizeRequestId(input: unknown): string {
  return String(input || '').trim();
}

function normalizeCode(input: unknown): string {
  return String(input || '').replace(/[^0-9]/g, '');
}

function clampRequestTtlMs(value: unknown, fallback: number): number {
  const parsed = parsePositiveNumber(value, fallback);
  return Math.min(Math.max(parsed, MIN_REQUEST_TTL_MS), MAX_REQUEST_TTL_MS);
}

function clampWindow(value: unknown): number {
  const parsed = parseInteger(value, DEFAULT_CODE_WINDOW);
  return Math.min(Math.max(parsed, 0), MAX_CODE_WINDOW);
}

function clampDigits(value: unknown): number {
  const parsed = parseInteger(value, DEFAULT_CODE_DIGITS);
  if (parsed < 6) return 6;
  if (parsed > 10) return 10;
  return parsed;
}

function clampMaxAttempts(value: unknown): number {
  const parsed = parseInteger(value, DEFAULT_MAX_ATTEMPTS);
  return Math.min(Math.max(parsed, 1), MAX_MAX_ATTEMPTS);
}

function loadMobileAuthRuntime(): MobileAuthRuntimeState {
  const enabled = parseBoolean(
    process.env.MOBILE_AUTH_ENABLED ?? getConfig<boolean>('mobileAuth.enabled'),
    false
  );

  const runtime: MobileAuthRuntimeState = {
    enabled,
    ready: false,
    issuerName: String(
      process.env.MOBILE_AUTH_ISSUER_NAME ??
        getConfig<string>('mobileAuth.issuerName') ??
        DEFAULT_ISSUER_NAME
    ).trim() || DEFAULT_ISSUER_NAME,
    verifyPath: normalizeVerifyPath(
      process.env.MOBILE_AUTH_VERIFY_PATH ?? getConfig<string>('mobileAuth.verifyPath')
    ),
    portalBaseUrl:
      normalizeBaseUrl(
        process.env.MOBILE_AUTH_PORTAL_BASE_URL ?? getConfig<string>('mobileAuth.portalBaseUrl')
      ) || DEFAULT_PORTAL_BASE_URL,
    requestTtlMs: clampRequestTtlMs(
      process.env.MOBILE_AUTH_REQUEST_TTL_MS ?? getConfig<number>('mobileAuth.requestTtlMs'),
      DEFAULT_REQUEST_TTL_MS
    ),
    codeDigits: clampDigits(
      process.env.MOBILE_AUTH_CODE_DIGITS ?? getConfig<number>('mobileAuth.codeDigits')
    ),
    codePeriodSec: parsePositiveNumber(
      process.env.MOBILE_AUTH_CODE_PERIOD_SEC ?? getConfig<number>('mobileAuth.codePeriodSec'),
      DEFAULT_CODE_PERIOD_SEC
    ),
    codeWindow: clampWindow(
      process.env.MOBILE_AUTH_CODE_WINDOW ?? getConfig<number>('mobileAuth.codeWindow')
    ),
    maxAttempts: clampMaxAttempts(
      process.env.MOBILE_AUTH_MAX_ATTEMPTS ?? getConfig<number>('mobileAuth.maxAttempts')
    ),
  };

  if (!enabled) {
    return runtime;
  }

  const masterKeyRaw = String(
    process.env.MOBILE_AUTH_TOTP_MASTER_KEY ?? getConfig<string>('mobileAuth.totpMasterKey') ?? ''
  ).trim();
  if (!masterKeyRaw) {
    runtime.error = 'MOBILE_AUTH_TOTP_MASTER_KEY is required when mobile auth is enabled';
    return runtime;
  }

  try {
    runtime.masterKey = decodeMasterKey(masterKeyRaw);
    runtime.ready = true;
  } catch (error) {
    runtime.error =
      error instanceof Error ? error.message : 'Failed to initialize mobile auth runtime';
  }
  return runtime;
}

function ensureMobileAuthReady(): MobileAuthRuntimeState {
  if (!MOBILE_AUTH_RUNTIME.enabled) {
    throw new MobileAuthError(403, 'MOBILE_AUTH_DISABLED', 'Mobile auth is disabled');
  }
  if (!MOBILE_AUTH_RUNTIME.ready || !MOBILE_AUTH_RUNTIME.masterKey) {
    throw new MobileAuthError(
      503,
      'MOBILE_AUTH_NOT_READY',
      MOBILE_AUTH_RUNTIME.error || 'Mobile auth is not ready'
    );
  }
  return MOBILE_AUTH_RUNTIME;
}

function createRequestId(): string {
  const base =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  return `${base}${crypto.randomBytes(8).toString('hex')}`;
}

function cleanupBindRequests(nowMs = Date.now()): void {
  for (const [requestId, record] of MOBILE_BIND_REQUESTS.entries()) {
    if (record.status === 'pending' && nowMs > record.expiresAt) {
      record.status = 'expired';
      record.updatedAt = nowMs;
      MOBILE_BIND_REQUESTS.set(requestId, record);
      continue;
    }
    if (record.status !== 'pending' && nowMs - record.updatedAt > GC_RETENTION_MS) {
      MOBILE_BIND_REQUESTS.delete(requestId);
    }
  }
}

function maskSubject(subject: string): string {
  if (!subject) return '';
  if (/^0x[0-9a-f]{40}$/.test(subject)) {
    return `${subject.slice(0, 8)}...${subject.slice(-6)}`;
  }
  if (subject.length <= 12) {
    return subject;
  }
  return `${subject.slice(0, 6)}...${subject.slice(-4)}`;
}

function sanitizeCapability(entry: unknown): UcanCapability | null {
  if (!entry || typeof entry !== 'object') return null;
  const value = entry as Record<string, unknown>;
  const withValue =
    (typeof value.with === 'string' && value.with.trim()) ||
    (typeof value.resource === 'string' && value.resource.trim()) ||
    '';
  const canValue =
    (typeof value.can === 'string' && value.can.trim()) ||
    (typeof value.action === 'string' && value.action.trim()) ||
    '';
  if (!withValue || !canValue) {
    return null;
  }
  return { with: withValue, can: canValue };
}

function sanitizeCapabilities(caps: UcanCapability[]): UcanCapability[] {
  return caps
    .map(entry => sanitizeCapability(entry))
    .filter((entry): entry is UcanCapability => Boolean(entry));
}

function toPublicBindResult(record: MobileBindRequestRecord): MobileBindRequestPublicResult {
  return {
    requestId: record.requestId,
    status: record.status,
    subjectHint: maskSubject(record.subject),
    audience: record.audience,
    capabilities: [...record.capabilities],
    appName: record.appName,
    redirectUri: record.redirectUri,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    verifyUrl: buildVerifyUrl(record.requestId),
  };
}

function toCreateBindResult(record: MobileBindRequestRecord): MobileBindRequestCreateResult {
  return {
    ...toPublicBindResult(record),
    subject: record.subject,
  };
}

function buildVerifyUrl(requestId: string): string {
  const pathWithQuery = `${MOBILE_AUTH_RUNTIME.verifyPath}?requestId=${encodeURIComponent(requestId)}`;
  const base = MOBILE_AUTH_RUNTIME.portalBaseUrl;
  if (!base) return pathWithQuery;
  return `${base}${pathWithQuery}`;
}

function base32Encode(input: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function deriveSubjectSecret(subject: string): Buffer {
  const runtime = ensureMobileAuthReady();
  return crypto
    .createHmac('sha256', runtime.masterKey as Buffer)
    .update(`mobile-auth:${subject}`)
    .digest()
    .subarray(0, 20);
}

function buildTotpUri(input: {
  issuer: string;
  accountName: string;
  secret: string;
  period: number;
  digits: number;
}): string {
  const label = `${input.issuer}:${input.accountName}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(input.digits),
    period: String(input.period),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function generateTotpCode(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  counterBuffer.writeUInt32BE(high >>> 0, 0);
  counterBuffer.writeUInt32BE(low >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, '0');
}

function codeEquals(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifyTotpCode(subject: string, code: string, nowMs = Date.now()): boolean {
  const runtime = ensureMobileAuthReady();
  const normalizedCode = normalizeCode(code);
  if (normalizedCode.length !== runtime.codeDigits) {
    return false;
  }
  const secret = deriveSubjectSecret(subject);
  const currentCounter = Math.floor(nowMs / (runtime.codePeriodSec * 1000));
  for (let offset = -runtime.codeWindow; offset <= runtime.codeWindow; offset += 1) {
    const candidate = generateTotpCode(secret, currentCounter + offset, runtime.codeDigits);
    if (codeEquals(candidate, normalizedCode)) {
      return true;
    }
  }
  return false;
}

function requirePendingRequest(record: MobileBindRequestRecord, nowMs: number): MobileBindRequestRecord {
  if (record.status === 'pending' && nowMs > record.expiresAt) {
    record.status = 'expired';
    record.updatedAt = nowMs;
  }
  if (record.status === 'pending') {
    return record;
  }
  if (record.status === 'expired') {
    throw new MobileAuthError(410, 'MOBILE_AUTH_REQUEST_EXPIRED', 'Mobile bind request expired');
  }
  if (record.status === 'used') {
    throw new MobileAuthError(409, 'MOBILE_AUTH_REQUEST_USED', 'Mobile bind request already used');
  }
  throw new MobileAuthError(403, 'MOBILE_AUTH_REQUEST_REVOKED', 'Mobile bind request revoked');
}

export function getMobileAuthStatus(): MobileAuthStatus {
  return {
    enabled: MOBILE_AUTH_RUNTIME.enabled,
    ready: MOBILE_AUTH_RUNTIME.ready,
    issuerName: MOBILE_AUTH_RUNTIME.issuerName,
    verifyPath: MOBILE_AUTH_RUNTIME.verifyPath,
    portalBaseUrl: MOBILE_AUTH_RUNTIME.portalBaseUrl,
    requestTtlMs: MOBILE_AUTH_RUNTIME.requestTtlMs,
    codeDigits: MOBILE_AUTH_RUNTIME.codeDigits,
    codePeriodSec: MOBILE_AUTH_RUNTIME.codePeriodSec,
    codeWindow: MOBILE_AUTH_RUNTIME.codeWindow,
    maxAttempts: MOBILE_AUTH_RUNTIME.maxAttempts,
    error: MOBILE_AUTH_RUNTIME.error,
  };
}

export function getMobileTotpProvision(subjectInput: string): MobileTotpProvision {
  const runtime = ensureMobileAuthReady();
  const subject = normalizeSubject(subjectInput);
  if (!subject) {
    throw new MobileAuthError(400, 'MOBILE_AUTH_SUBJECT_REQUIRED', 'Missing subject');
  }
  const secretBuffer = deriveSubjectSecret(subject);
  const secret = base32Encode(secretBuffer);
  const accountName = subject;
  return {
    subject,
    issuer: runtime.issuerName,
    accountName,
    secret,
    algorithm: 'SHA1',
    digits: runtime.codeDigits,
    period: runtime.codePeriodSec,
    otpauthUri: buildTotpUri({
      issuer: runtime.issuerName,
      accountName,
      secret,
      period: runtime.codePeriodSec,
      digits: runtime.codeDigits,
    }),
  };
}

export function createMobileBindRequest(
  input: CreateMobileBindRequestInput
): MobileBindRequestCreateResult {
  const runtime = ensureMobileAuthReady();
  cleanupBindRequests();

  const subject = normalizeSubject(input.subject);
  if (!subject) {
    throw new MobileAuthError(400, 'MOBILE_AUTH_SUBJECT_REQUIRED', 'Missing subject');
  }

  const audience = String(input.audience || '').trim();
  if (!audience) {
    throw new MobileAuthError(400, 'MOBILE_AUTH_AUDIENCE_REQUIRED', 'Missing audience');
  }

  const capabilities = sanitizeCapabilities(input.capabilities || []);
  if (capabilities.length === 0) {
    throw new MobileAuthError(400, 'MOBILE_AUTH_CAPABILITIES_REQUIRED', 'Missing capabilities');
  }

  const nowMs = Date.now();
  const requestId = createRequestId();
  const expiresAt = nowMs + clampRequestTtlMs(input.requestTtlMs, runtime.requestTtlMs);
  const appName = String(input.appName || '').trim() || 'mobile-client';
  const redirectUri = String(input.redirectUri || '').trim() || undefined;

  const record: MobileBindRequestRecord = {
    requestId,
    status: 'pending',
    subject,
    audience,
    capabilities,
    appName,
    redirectUri,
    createdAt: nowMs,
    updatedAt: nowMs,
    expiresAt,
    attempts: 0,
    sessionTtlMs:
      input.sessionTtlMs !== undefined ? parsePositiveNumber(input.sessionTtlMs, 0) || undefined : undefined,
    tokenTtlMs:
      input.tokenTtlMs !== undefined ? parsePositiveNumber(input.tokenTtlMs, 0) || undefined : undefined,
  };

  MOBILE_BIND_REQUESTS.set(requestId, record);
  return toCreateBindResult(record);
}

export function getMobileBindRequest(requestIdInput: string): MobileBindRequestPublicResult | null {
  ensureMobileAuthReady();
  cleanupBindRequests();
  const requestId = normalizeRequestId(requestIdInput);
  if (!requestId) return null;
  const record = MOBILE_BIND_REQUESTS.get(requestId);
  if (!record) return null;
  return toPublicBindResult(record);
}

export function consumeMobileBindRequest(input: {
  requestId: string;
  code: string;
  expectedSubject?: string;
}): MobileBindConsumeResult {
  const runtime = ensureMobileAuthReady();
  cleanupBindRequests();

  const requestId = normalizeRequestId(input.requestId);
  if (!requestId) {
    throw new MobileAuthError(400, 'MOBILE_AUTH_REQUEST_REQUIRED', 'Missing requestId');
  }
  const record = MOBILE_BIND_REQUESTS.get(requestId);
  if (!record) {
    throw new MobileAuthError(404, 'MOBILE_AUTH_REQUEST_NOT_FOUND', 'Mobile bind request not found');
  }
  const nowMs = Date.now();
  const pending = requirePendingRequest(record, nowMs);

  const expectedSubject = normalizeSubject(input.expectedSubject || '');
  if (expectedSubject && expectedSubject !== pending.subject) {
    throw new MobileAuthError(403, 'MOBILE_AUTH_SUBJECT_MISMATCH', 'Subject mismatch');
  }

  const code = normalizeCode(input.code);
  if (!code) {
    throw new MobileAuthError(400, 'MOBILE_AUTH_CODE_REQUIRED', 'Missing TOTP code');
  }
  if (!verifyTotpCode(pending.subject, code, nowMs)) {
    pending.attempts += 1;
    pending.updatedAt = nowMs;
    if (pending.attempts >= runtime.maxAttempts) {
      pending.status = 'revoked';
      throw new MobileAuthError(
        429,
        'MOBILE_AUTH_ATTEMPTS_EXCEEDED',
        'Too many invalid TOTP attempts'
      );
    }
    throw new MobileAuthError(401, 'MOBILE_AUTH_CODE_INVALID', 'Invalid TOTP code');
  }

  pending.status = 'used';
  pending.updatedAt = nowMs;
  MOBILE_BIND_REQUESTS.set(requestId, pending);

  return {
    requestId: pending.requestId,
    subject: pending.subject,
    audience: pending.audience,
    capabilities: [...pending.capabilities],
    appName: pending.appName,
    redirectUri: pending.redirectUri,
    sessionTtlMs: pending.sessionTtlMs,
    tokenTtlMs: pending.tokenTtlMs,
    approvedAt: nowMs,
  };
}
