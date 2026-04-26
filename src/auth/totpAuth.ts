import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import type { UcanCapability } from './ucanIssuer';
import { getConfig } from '../config/runtime';
import { SingletonDataSource } from '../domain/facade/datasource';
import { TotpSubjectSecretDO } from '../domain/mapper/entity';
import { getRuntimeSecret } from '../security/secretVault';

export type TotpBindRequestStatus = 'pending' | 'used' | 'expired' | 'revoked';

export type TotpAuthStatus = {
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

export type TotpProvision = {
  subject: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: 'SHA1';
  digits: number;
  period: number;
  otpauthUri: string;
};

export type TotpBindRequestCreateResult = {
  requestId: string;
  status: TotpBindRequestStatus;
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

export type TotpBindRequestPublicResult = Omit<TotpBindRequestCreateResult, 'subject'>;

export type TotpBindConsumeResult = {
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

export type CreateTotpBindRequestInput = {
  subject: string;
  audience: string;
  capabilities: UcanCapability[];
  appName?: string;
  redirectUri?: string;
  requestTtlMs?: number;
  sessionTtlMs?: number;
  tokenTtlMs?: number;
};

export class TotpAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'TotpAuthError';
  }
}

type TotpAuthRuntimeState = {
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

type TotpBindRequestRecord = {
  requestId: string;
  status: TotpBindRequestStatus;
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
const DEFAULT_VERIFY_PATH = '/totp-auth';
const DEFAULT_PORTAL_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const DEFAULT_REQUEST_TTL_MS = 2 * 60 * 1000;
const MIN_REQUEST_TTL_MS = 60 * 1000;
const MAX_REQUEST_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CODE_DIGITS = 6;
const DEFAULT_CODE_PERIOD_SEC = 30;
const DEFAULT_CODE_WINDOW = 1;
const MAX_CODE_WINDOW = 5;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_MAX_ATTEMPTS = 20;
const GC_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOTP_SECRET_BYTES = 20;
const SECRET_CIPHER_VERSION = 'v1';
const SECRET_ENCRYPTION_CONTEXT = 'totp-auth-secret:v1';

const TOTP_BIND_REQUESTS = new Map<string, TotpBindRequestRecord>();
let TOTP_AUTH_RUNTIME_CACHE: TotpAuthRuntimeState | null = null;

function getTotpRuntime(): TotpAuthRuntimeState {
  if (!TOTP_AUTH_RUNTIME_CACHE) {
    TOTP_AUTH_RUNTIME_CACHE = loadTotpAuthRuntime();
  }
  return TOTP_AUTH_RUNTIME_CACHE;
}

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
    throw new Error('Missing totp auth TOTP master key');
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

  const utf8 = Buffer.from(normalized, 'utf8');
  if (utf8.length < 16) {
    throw new Error('totp auth master key must be at least 16 bytes');
  }
  return utf8;
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

function loadTotpAuthRuntime(): TotpAuthRuntimeState {
  const enabled = parseBoolean(
    process.env.TOTP_AUTH_ENABLED ?? getConfig<boolean>('totpAuth.enabled'),
    false
  );

  const runtime: TotpAuthRuntimeState = {
    enabled,
    ready: false,
    issuerName: String(
      process.env.TOTP_AUTH_ISSUER_NAME ??
        getConfig<string>('totpAuth.issuerName') ??
        DEFAULT_ISSUER_NAME
    ).trim() || DEFAULT_ISSUER_NAME,
    verifyPath: normalizeVerifyPath(
      process.env.TOTP_AUTH_VERIFY_PATH ?? getConfig<string>('totpAuth.verifyPath')
    ),
    portalBaseUrl:
      normalizeBaseUrl(
        process.env.TOTP_AUTH_PORTAL_BASE_URL ?? getConfig<string>('totpAuth.portalBaseUrl')
      ) || DEFAULT_PORTAL_BASE_URL,
    requestTtlMs: clampRequestTtlMs(
      process.env.TOTP_AUTH_REQUEST_TTL_MS ?? getConfig<number>('totpAuth.requestTtlMs'),
      DEFAULT_REQUEST_TTL_MS
    ),
    codeDigits: clampDigits(
      process.env.TOTP_AUTH_CODE_DIGITS ?? getConfig<number>('totpAuth.codeDigits')
    ),
    codePeriodSec: parsePositiveNumber(
      process.env.TOTP_AUTH_CODE_PERIOD_SEC ?? getConfig<number>('totpAuth.codePeriodSec'),
      DEFAULT_CODE_PERIOD_SEC
    ),
    codeWindow: clampWindow(
      process.env.TOTP_AUTH_CODE_WINDOW ?? getConfig<number>('totpAuth.codeWindow')
    ),
    maxAttempts: clampMaxAttempts(
      process.env.TOTP_AUTH_MAX_ATTEMPTS ?? getConfig<number>('totpAuth.maxAttempts')
    ),
  };

  if (!enabled) {
    return runtime;
  }

  const masterKeyRaw = String(
    getRuntimeSecret('TOTP_AUTH_TOTP_MASTER_KEY') ||
      process.env.TOTP_AUTH_TOTP_MASTER_KEY ||
      getConfig<string>('totpAuth.totpMasterKey') ||
      ''
  ).trim();
  if (!masterKeyRaw) {
    runtime.error = 'TOTP_AUTH_TOTP_MASTER_KEY is required when totp auth is enabled';
    return runtime;
  }

  try {
    runtime.masterKey = decodeMasterKey(masterKeyRaw);
    runtime.ready = true;
  } catch (error) {
    runtime.error =
      error instanceof Error ? error.message : 'Failed to initialize totp auth runtime';
  }
  return runtime;
}

function ensureTotpAuthReady(): TotpAuthRuntimeState {
  const runtime = getTotpRuntime();
  if (!runtime.enabled) {
    throw new TotpAuthError(403, 'TOTP_AUTH_DISABLED', 'TOTP auth is disabled');
  }
  if (!runtime.ready || !runtime.masterKey) {
    throw new TotpAuthError(
      503,
      'TOTP_AUTH_NOT_READY',
      runtime.error || 'TOTP auth is not ready'
    );
  }
  return runtime;
}

function createRequestId(): string {
  const base =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  return `${base}${crypto.randomBytes(8).toString('hex')}`;
}

function cleanupBindRequests(nowMs = Date.now()): void {
  for (const [requestId, record] of TOTP_BIND_REQUESTS.entries()) {
    if (record.status === 'pending' && nowMs > record.expiresAt) {
      record.status = 'expired';
      record.updatedAt = nowMs;
      TOTP_BIND_REQUESTS.set(requestId, record);
      continue;
    }
    if (record.status !== 'pending' && nowMs - record.updatedAt > GC_RETENTION_MS) {
      TOTP_BIND_REQUESTS.delete(requestId);
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

function toPublicBindResult(record: TotpBindRequestRecord): TotpBindRequestPublicResult {
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

function toCreateBindResult(record: TotpBindRequestRecord): TotpBindRequestCreateResult {
  return {
    ...toPublicBindResult(record),
    subject: record.subject,
  };
}

function buildVerifyUrl(requestId: string): string {
  const runtime = getTotpRuntime();
  const pathWithQuery = `${runtime.verifyPath}?requestId=${encodeURIComponent(requestId)}`;
  const base = runtime.portalBaseUrl;
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

function toBase64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): Buffer {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function getTotpSecretRepository(): Repository<TotpSubjectSecretDO> {
  try {
    const dataSource = SingletonDataSource.get();
    if (!dataSource || !dataSource.isInitialized) {
      throw new Error('datasource not ready');
    }
    return dataSource.getRepository(TotpSubjectSecretDO);
  } catch {
    throw new TotpAuthError(503, 'TOTP_AUTH_STORAGE_NOT_READY', 'TOTP auth storage is not ready');
  }
}

function getTotpSecretEncryptionKey(runtime: TotpAuthRuntimeState): Buffer {
  return crypto
    .createHash('sha256')
    .update(runtime.masterKey as Buffer)
    .update(SECRET_ENCRYPTION_CONTEXT)
    .digest();
}

function encryptTotpSecret(secret: Buffer): string {
  const runtime = ensureTotpAuthReady();
  const key = getTotpSecretEncryptionKey(runtime);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_CIPHER_VERSION}.${toBase64Url(iv)}.${toBase64Url(tag)}.${toBase64Url(ciphertext)}`;
}

function decryptTotpSecret(ciphertextInput: string): Buffer {
  const runtime = ensureTotpAuthReady();
  const key = getTotpSecretEncryptionKey(runtime);
  const ciphertext = String(ciphertextInput || '').trim();
  const [version, ivEncoded, tagEncoded, dataEncoded] = ciphertext.split('.');
  if (
    version !== SECRET_CIPHER_VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !dataEncoded
  ) {
    throw new TotpAuthError(
      500,
      'TOTP_AUTH_SECRET_CORRUPTED',
      'Stored TOTP secret is invalid'
    );
  }
  try {
    const iv = fromBase64Url(ivEncoded);
    const tag = fromBase64Url(tagEncoded);
    const data = fromBase64Url(dataEncoded);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    throw new TotpAuthError(
      500,
      'TOTP_AUTH_SECRET_CORRUPTED',
      'Stored TOTP secret is invalid'
    );
  }
}

function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString();
}

function isDuplicateRecordError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('duplicate') ||
    message.includes('unique') ||
    message.includes('constraint')
  );
}

async function getTotpSecretRecord(subject: string): Promise<TotpSubjectSecretDO | null> {
  const repository = getTotpSecretRepository();
  return await repository.findOneBy({ subject });
}

async function ensureTotpSecretRecord(subject: string): Promise<TotpSubjectSecretDO> {
  const repository = getTotpSecretRepository();
  const existing = await repository.findOneBy({ subject });
  if (existing) {
    return existing;
  }
  const now = nowIso();
  const created = repository.create({
    subject,
    secretCiphertext: encryptTotpSecret(crypto.randomBytes(TOTP_SECRET_BYTES)),
    isBound: false,
    createdAt: now,
    updatedAt: now,
    boundAt: '',
  });
  try {
    return await repository.save(created);
  } catch (error) {
    if (!isDuplicateRecordError(error)) {
      throw error;
    }
    const latest = await repository.findOneBy({ subject });
    if (latest) {
      return latest;
    }
    throw error;
  }
}

async function markTotpSecretBound(subject: string): Promise<void> {
  const repository = getTotpSecretRepository();
  const record = await repository.findOneBy({ subject });
  if (!record || record.isBound) {
    return;
  }
  const now = nowIso();
  record.isBound = true;
  record.boundAt = now;
  record.updatedAt = now;
  await repository.save(record);
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

function verifyTotpCode(secret: Buffer, code: string, nowMs = Date.now()): boolean {
  const runtime = ensureTotpAuthReady();
  const normalizedCode = normalizeCode(code);
  if (normalizedCode.length !== runtime.codeDigits) {
    return false;
  }
  const currentCounter = Math.floor(nowMs / (runtime.codePeriodSec * 1000));
  for (let offset = -runtime.codeWindow; offset <= runtime.codeWindow; offset += 1) {
    const candidate = generateTotpCode(secret, currentCounter + offset, runtime.codeDigits);
    if (codeEquals(candidate, normalizedCode)) {
      return true;
    }
  }
  return false;
}

function requirePendingRequest(record: TotpBindRequestRecord, nowMs: number): TotpBindRequestRecord {
  if (record.status === 'pending' && nowMs > record.expiresAt) {
    record.status = 'expired';
    record.updatedAt = nowMs;
  }
  if (record.status === 'pending') {
    return record;
  }
  if (record.status === 'expired') {
    throw new TotpAuthError(410, 'TOTP_AUTH_REQUEST_EXPIRED', 'totp bind request expired');
  }
  if (record.status === 'used') {
    throw new TotpAuthError(409, 'TOTP_AUTH_REQUEST_USED', 'totp bind request already used');
  }
  throw new TotpAuthError(403, 'TOTP_AUTH_REQUEST_REVOKED', 'totp bind request revoked');
}

export function getTotpAuthStatus(): TotpAuthStatus {
  const runtime = getTotpRuntime();
  return {
    enabled: runtime.enabled,
    ready: runtime.ready,
    issuerName: runtime.issuerName,
    verifyPath: runtime.verifyPath,
    portalBaseUrl: runtime.portalBaseUrl,
    requestTtlMs: runtime.requestTtlMs,
    codeDigits: runtime.codeDigits,
    codePeriodSec: runtime.codePeriodSec,
    codeWindow: runtime.codeWindow,
    maxAttempts: runtime.maxAttempts,
    error: runtime.error,
  };
}

export function assertTotpAuthReady(): TotpAuthStatus {
  const status = getTotpAuthStatus();
  if (!status.enabled) {
    throw new TotpAuthError(403, 'TOTP_AUTH_DISABLED', 'TOTP auth is disabled');
  }
  if (!status.ready) {
    throw new TotpAuthError(503, 'TOTP_AUTH_NOT_READY', status.error || 'TOTP auth is not ready');
  }
  return status;
}

export function buildTotpVerifyUrl(requestIdInput: string): string {
  assertTotpAuthReady();
  const requestId = normalizeRequestId(requestIdInput);
  if (!requestId) {
    throw new TotpAuthError(400, 'TOTP_AUTH_REQUEST_REQUIRED', 'Missing requestId');
  }
  return buildVerifyUrl(requestId);
}

export async function hasTotpEnrollmentForSubject(subjectInput: string): Promise<boolean> {
  assertTotpAuthReady();
  const subject = normalizeSubject(subjectInput);
  if (!subject) {
    return false;
  }
  const record = await getTotpSecretRecord(subject);
  return Boolean(record);
}

export async function markTotpEnrollmentBoundForSubject(subjectInput: string): Promise<void> {
  assertTotpAuthReady();
  const subject = normalizeSubject(subjectInput);
  if (!subject) {
    return;
  }
  await markTotpSecretBound(subject);
}

export async function verifyTotpCodeForSubject(
  subjectInput: string,
  codeInput: string
): Promise<boolean> {
  assertTotpAuthReady();
  const subject = normalizeSubject(subjectInput);
  if (!subject) {
    return false;
  }
  const record = await getTotpSecretRecord(subject);
  if (!record) {
    return false;
  }
  return verifyTotpCode(decryptTotpSecret(record.secretCiphertext), codeInput);
}

export async function getTotpProvision(subjectInput: string): Promise<TotpProvision> {
  const runtime = ensureTotpAuthReady();
  const subject = normalizeSubject(subjectInput);
  if (!subject) {
    throw new TotpAuthError(400, 'TOTP_AUTH_SUBJECT_REQUIRED', 'Missing subject');
  }
  const record = await ensureTotpSecretRecord(subject);
  const secretBuffer = decryptTotpSecret(record.secretCiphertext);
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

export function createTotpBindRequest(
  input: CreateTotpBindRequestInput
): TotpBindRequestCreateResult {
  const runtime = ensureTotpAuthReady();
  cleanupBindRequests();

  const subject = normalizeSubject(input.subject);
  if (!subject) {
    throw new TotpAuthError(400, 'TOTP_AUTH_SUBJECT_REQUIRED', 'Missing subject');
  }

  const audience = String(input.audience || '').trim();
  if (!audience) {
    throw new TotpAuthError(400, 'TOTP_AUTH_AUDIENCE_REQUIRED', 'Missing audience');
  }

  const capabilities = sanitizeCapabilities(input.capabilities || []);
  if (capabilities.length === 0) {
    throw new TotpAuthError(400, 'TOTP_AUTH_CAPABILITIES_REQUIRED', 'Missing capabilities');
  }

  const nowMs = Date.now();
  const requestId = createRequestId();
  const expiresAt = nowMs + clampRequestTtlMs(input.requestTtlMs, runtime.requestTtlMs);
  const appName = String(input.appName || '').trim() || 'totp-client';
  const redirectUri = String(input.redirectUri || '').trim() || undefined;

  const record: TotpBindRequestRecord = {
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

  TOTP_BIND_REQUESTS.set(requestId, record);
  return toCreateBindResult(record);
}

export function getTotpBindRequest(requestIdInput: string): TotpBindRequestPublicResult | null {
  ensureTotpAuthReady();
  cleanupBindRequests();
  const requestId = normalizeRequestId(requestIdInput);
  if (!requestId) return null;
  const record = TOTP_BIND_REQUESTS.get(requestId);
  if (!record) return null;
  return toPublicBindResult(record);
}

export async function consumeTotpBindRequest(input: {
  requestId: string;
  code: string;
  expectedSubject?: string;
}): Promise<TotpBindConsumeResult> {
  const runtime = ensureTotpAuthReady();
  cleanupBindRequests();

  const requestId = normalizeRequestId(input.requestId);
  if (!requestId) {
    throw new TotpAuthError(400, 'TOTP_AUTH_REQUEST_REQUIRED', 'Missing requestId');
  }
  const record = TOTP_BIND_REQUESTS.get(requestId);
  if (!record) {
    throw new TotpAuthError(404, 'TOTP_AUTH_REQUEST_NOT_FOUND', 'totp bind request not found');
  }
  const nowMs = Date.now();
  const pending = requirePendingRequest(record, nowMs);

  const expectedSubject = normalizeSubject(input.expectedSubject || '');
  if (expectedSubject && expectedSubject !== pending.subject) {
    throw new TotpAuthError(403, 'TOTP_AUTH_SUBJECT_MISMATCH', 'Subject mismatch');
  }

  const code = normalizeCode(input.code);
  if (!code) {
    throw new TotpAuthError(400, 'TOTP_AUTH_CODE_REQUIRED', 'Missing TOTP code');
  }
  const secretRecord = await getTotpSecretRecord(pending.subject);
  if (!secretRecord) {
    throw new TotpAuthError(
      403,
      'TOTP_AUTH_NOT_ENROLLED',
      'TOTP authenticator is not configured for this address'
    );
  }
  if (!verifyTotpCode(decryptTotpSecret(secretRecord.secretCiphertext), code, nowMs)) {
    pending.attempts += 1;
    pending.updatedAt = nowMs;
    if (pending.attempts >= runtime.maxAttempts) {
      pending.status = 'revoked';
      throw new TotpAuthError(
        429,
        'TOTP_AUTH_ATTEMPTS_EXCEEDED',
        'Too many invalid TOTP attempts'
      );
    }
    throw new TotpAuthError(401, 'TOTP_AUTH_CODE_INVALID', 'Invalid TOTP code');
  }

  pending.status = 'used';
  pending.updatedAt = nowMs;
  TOTP_BIND_REQUESTS.set(requestId, pending);
  await markTotpSecretBound(pending.subject);

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
