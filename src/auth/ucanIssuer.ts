import * as crypto from 'crypto';
import type { UcanIssuerMode } from '../config';
import { getConfig } from '../config/runtime';
import { getRuntimeSecret } from '../security/secretVault';

export type UcanCapability = {
  with?: string;
  can?: string;
  resource?: string;
  action?: string;
  nb?: unknown;
};

export type UcanIssueResult = {
  ucan: string;
  issuer: string;
  audience: string;
  subject: string;
  capabilities: UcanCapability[];
  notBefore: number;
  expiresAt: number;
};

export type UcanIssuerStatus = {
  enabled: boolean;
  mode: UcanIssuerMode;
  ready: boolean;
  issuerDid?: string;
  sessionTtlMs: number;
  tokenTtlMs: number;
  defaultAudience: string;
  defaultCapabilities: UcanCapability[];
  error?: string;
};

export type CentralIssueSession = {
  sessionToken: string;
  subject: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
};

type IssuerRuntimeState = {
  enabled: boolean;
  mode: UcanIssuerMode;
  did: string;
  privateKey?: crypto.KeyObject;
  ready: boolean;
  error?: string;
  sessionTtlMs: number;
  tokenTtlMs: number;
  defaultAudience: string;
  defaultCapabilities: UcanCapability[];
};

type ReadyIssueRuntime = IssuerRuntimeState & {
  enabled: true;
  ready: true;
  did: string;
  privateKey: crypto.KeyObject;
};

type IssueSessionRecord = {
  sessionToken: string;
  subject: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_ISSUED_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_ISSUED_TOKEN_TTL_MS = 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_SESSION_TTL_MS = 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;

const DEFAULT_PORT = parsePositiveNumber(
  process.env.APP_PORT ?? getConfig<number>('app.port'),
  8100
);
const DEFAULT_UCAN_AUD =
  process.env.UCAN_AUD ||
  getConfig<string>('ucan.aud') ||
  `did:web:localhost:${DEFAULT_PORT}`;
const DEFAULT_UCAN_WITH =
  process.env.UCAN_WITH ||
  getConfig<string>('ucan.with') ||
  'app:all:localhost-*';
const DEFAULT_UCAN_CAN =
  process.env.UCAN_CAN ||
  getConfig<string>('ucan.can') ||
  'invoke';

let ISSUER_RUNTIME_CACHE: IssuerRuntimeState | null = null;
const ISSUE_SESSIONS = new Map<string, IssueSessionRecord>();

function getIssuerRuntime(): IssuerRuntimeState {
  if (!ISSUER_RUNTIME_CACHE) {
    ISSUER_RUNTIME_CACHE = loadIssuerRuntime();
  }
  return ISSUER_RUNTIME_CACHE;
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

function parseIssuerMode(value: unknown): UcanIssuerMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'issue' || normalized === 'hybrid' || normalized === 'verify') {
    return normalized;
  }
  return 'verify';
}

function normalizeSubject(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase();
  }
  return value;
}

function normalizeSessionToken(input: unknown): string {
  return String(input || '').trim();
}

function base58Encode(input: Buffer): string {
  if (input.length === 0) return '';
  const digits: number[] = [0];
  for (const byte of input) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  while (zeros < input.length && input[zeros] === 0) {
    zeros += 1;
  }
  let encoded = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    encoded += BASE58_ALPHABET[digits[i]];
  }
  return encoded;
}

function deriveDidFromPrivateKey(privateKey: crypto.KeyObject): string {
  const publicKey = crypto.createPublicKey(privateKey);
  const der = publicKey.export({ format: 'der', type: 'spki' });
  if (!Buffer.isBuffer(der)) {
    throw new Error('Unsupported issuer public key format');
  }
  if (
    der.length !== ED25519_SPKI_PREFIX.length + 32 ||
    !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    throw new Error('Only Ed25519 issuer keys are supported');
  }
  const rawPublic = der.subarray(ED25519_SPKI_PREFIX.length);
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), rawPublic]);
  return `did:key:z${base58Encode(multicodec)}`;
}

function createPrivateKeyFromSeed(seed: Buffer): crypto.KeyObject {
  if (seed.length !== 32) {
    throw new Error('UCAN issuer private key seed must be 32 bytes');
  }
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function parseIssuerPrivateKey(raw: string): crypto.KeyObject {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    throw new Error('Missing UCAN issuer private key');
  }

  const pemValue = normalized.includes('\\n') ? normalized.replace(/\\n/g, '\n') : normalized;
  if (pemValue.includes('BEGIN')) {
    return crypto.createPrivateKey({ key: pemValue, format: 'pem' });
  }

  const hexValue = pemValue.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(hexValue)) {
    return createPrivateKeyFromSeed(Buffer.from(hexValue, 'hex'));
  }

  try {
    const bytes = Buffer.from(pemValue, 'base64');
    if (bytes.length === 32) {
      return createPrivateKeyFromSeed(bytes);
    }
  } catch {
    // ignore and throw a uniform error below
  }

  throw new Error('Unsupported UCAN issuer private key format');
}

function sanitizeCapability(entry: unknown): UcanCapability | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const value = entry as Record<string, unknown>;
  const resourceRaw =
    (typeof value.with === 'string' && value.with.trim()) ||
    (typeof value.resource === 'string' && value.resource.trim()) ||
    '';
  const actionRaw =
    (typeof value.can === 'string' && value.can.trim()) ||
    (typeof value.action === 'string' && value.action.trim()) ||
    '';
  if (!resourceRaw || !actionRaw) {
    return null;
  }
  return { with: resourceRaw, can: actionRaw };
}

function parseCapabilityList(raw: unknown): UcanCapability[] {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map(item => sanitizeCapability(item))
    .filter((item): item is UcanCapability => Boolean(item));
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function clampIssueTtlMs(value: unknown, fallback: number): number {
  const parsed = parsePositiveNumber(value, fallback);
  return Math.min(Math.max(parsed, MIN_ISSUED_TOKEN_TTL_MS), MAX_ISSUED_TOKEN_TTL_MS);
}

function clampSessionTtlMs(value: unknown, fallback: number): number {
  const parsed = parsePositiveNumber(value, fallback);
  return Math.min(Math.max(parsed, MIN_SESSION_TTL_MS), MAX_SESSION_TTL_MS);
}

function loadIssuerRuntime(): IssuerRuntimeState {
  const enabled = parseBoolean(
    process.env.UCAN_ISSUER_ENABLED ?? getConfig<boolean>('ucanIssuer.enabled'),
    false
  );
  const mode = parseIssuerMode(process.env.UCAN_ISSUER_MODE ?? getConfig<string>('ucanIssuer.mode'));
  const runtimeDid = getRuntimeSecret('UCAN_ISSUER_DID');
  const runtimePrivateKey = getRuntimeSecret('UCAN_ISSUER_PRIVATE_KEY');
  const configuredDid = String(
    runtimeDid || process.env.UCAN_ISSUER_DID || getConfig<string>('ucanIssuer.did') || ''
  ).trim();
  const privateKeyRaw = String(
    runtimePrivateKey ||
      process.env.UCAN_ISSUER_PRIVATE_KEY ||
      getConfig<string>('ucanIssuer.privateKey') ||
      ''
  ).trim();
  const defaultAudience = String(
    process.env.UCAN_ISSUER_DEFAULT_AUDIENCE ??
      getConfig<string>('ucanIssuer.defaultAudience') ??
      DEFAULT_UCAN_AUD
  ).trim();
  const defaultCapabilities = parseCapabilityList(
    process.env.UCAN_ISSUER_DEFAULT_CAPABILITIES ??
      getConfig<unknown>('ucanIssuer.defaultCapabilities')
  );

  const runtime: IssuerRuntimeState = {
    enabled,
    mode,
    did: configuredDid,
    ready: false,
    sessionTtlMs: parsePositiveNumber(
      process.env.UCAN_ISSUER_SESSION_TTL_MS ?? getConfig<number>('ucanIssuer.sessionTtlMs'),
      DEFAULT_SESSION_TTL_MS
    ),
    tokenTtlMs: parsePositiveNumber(
      process.env.UCAN_ISSUER_TOKEN_TTL_MS ?? getConfig<number>('ucanIssuer.tokenTtlMs'),
      DEFAULT_TOKEN_TTL_MS
    ),
    defaultAudience: defaultAudience || DEFAULT_UCAN_AUD,
    defaultCapabilities:
      defaultCapabilities.length > 0
        ? defaultCapabilities
        : [{ with: DEFAULT_UCAN_WITH, can: DEFAULT_UCAN_CAN }],
  };

  if (!enabled) {
    return runtime;
  }
  if (mode === 'verify') {
    runtime.ready = true;
    return runtime;
  }
  if (!privateKeyRaw) {
    runtime.error = 'UCAN issuer private key is required when issue mode is enabled';
    return runtime;
  }

  try {
    const privateKey = parseIssuerPrivateKey(privateKeyRaw);
    const derivedDid = deriveDidFromPrivateKey(privateKey);
    if (configuredDid && configuredDid !== derivedDid) {
      runtime.error = 'UCAN issuer DID does not match the configured private key';
      return runtime;
    }
    runtime.did = configuredDid || derivedDid;
    runtime.privateKey = privateKey;
    runtime.ready = true;
    return runtime;
  } catch (error) {
    runtime.error =
      error instanceof Error ? error.message : 'Failed to initialize UCAN issuer private key';
    return runtime;
  }
}

function isIssueModeEnabled(mode: UcanIssuerMode): boolean {
  return mode === 'issue' || mode === 'hybrid';
}

function validateIssueRuntime(): ReadyIssueRuntime {
  const issuerRuntime = getIssuerRuntime();
  if (!issuerRuntime.enabled) {
    throw new Error('UCAN issuer is disabled');
  }
  if (!isIssueModeEnabled(issuerRuntime.mode)) {
    throw new Error('UCAN issuer mode does not allow issue');
  }
  if (!issuerRuntime.ready || !issuerRuntime.privateKey || !issuerRuntime.did) {
    throw new Error(issuerRuntime.error || 'UCAN issuer is not ready');
  }
  return issuerRuntime as ReadyIssueRuntime;
}

function generateSessionToken(): string {
  const base = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `${base}${crypto.randomBytes(12).toString('hex')}`;
}

function cleanupExpiredIssueSessions(nowMs = Date.now()): void {
  for (const [sessionToken, record] of ISSUE_SESSIONS.entries()) {
    if (nowMs > record.expiresAt) {
      ISSUE_SESSIONS.delete(sessionToken);
    }
  }
}

function toIssueSession(record: IssueSessionRecord): CentralIssueSession {
  return {
    sessionToken: record.sessionToken,
    subject: record.subject,
    issuer: record.issuer,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
}

export function getCentralIssuerStatus(): UcanIssuerStatus {
  const issuerRuntime = getIssuerRuntime();
  return {
    enabled: issuerRuntime.enabled,
    mode: issuerRuntime.mode,
    ready: issuerRuntime.ready,
    issuerDid: issuerRuntime.did || undefined,
    sessionTtlMs: issuerRuntime.sessionTtlMs,
    tokenTtlMs: issuerRuntime.tokenTtlMs,
    defaultAudience: issuerRuntime.defaultAudience,
    defaultCapabilities: [...issuerRuntime.defaultCapabilities],
    error: issuerRuntime.error,
  };
}

export function isCentralUcanIssueEnabled(): boolean {
  const issuerRuntime = getIssuerRuntime();
  return (
    issuerRuntime.enabled &&
    issuerRuntime.ready &&
    isIssueModeEnabled(issuerRuntime.mode)
  );
}

export function createCentralIssueSession(input: {
  subject: string;
  expiresInMs?: number;
}): CentralIssueSession {
  const runtime = validateIssueRuntime();
  cleanupExpiredIssueSessions();

  const subject = normalizeSubject(input.subject);
  if (!subject) {
    throw new Error('Missing UCAN subject');
  }

  const ttlMs = clampSessionTtlMs(input.expiresInMs, runtime.sessionTtlMs);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const sessionToken = generateSessionToken();

  const record: IssueSessionRecord = {
    sessionToken,
    subject,
    issuer: runtime.did,
    issuedAt,
    expiresAt,
  };
  ISSUE_SESSIONS.set(sessionToken, record);
  return toIssueSession(record);
}

export function getCentralIssueSession(sessionToken: string): CentralIssueSession | null {
  cleanupExpiredIssueSessions();
  const normalized = normalizeSessionToken(sessionToken);
  if (!normalized) {
    return null;
  }
  const record = ISSUE_SESSIONS.get(normalized);
  if (!record) {
    return null;
  }
  return toIssueSession(record);
}

export function revokeCentralIssueSession(sessionToken: string): boolean {
  const normalized = normalizeSessionToken(sessionToken);
  if (!normalized) {
    return false;
  }
  return ISSUE_SESSIONS.delete(normalized);
}

export function issueCentralUcan(input: {
  subject: string;
  audience?: string;
  capabilities?: UcanCapability[];
  expiresInMs?: number;
}): UcanIssueResult {
  const runtime = validateIssueRuntime();
  const subject = normalizeSubject(input.subject);
  if (!subject) {
    throw new Error('Missing UCAN subject');
  }
  const audience = String(input.audience || runtime.defaultAudience).trim();
  if (!audience) {
    throw new Error('Missing UCAN audience');
  }
  const requestedCapabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const capabilities = (requestedCapabilities.length > 0
    ? requestedCapabilities
    : runtime.defaultCapabilities
  )
    .map(item => sanitizeCapability(item))
    .filter((item): item is UcanCapability => Boolean(item));
  if (capabilities.length === 0) {
    throw new Error('Missing UCAN capabilities');
  }

  const ttlMs = clampIssueTtlMs(input.expiresInMs, runtime.tokenTtlMs);
  const nowMs = Date.now();
  const notBefore = Math.floor(nowMs / 1000);
  const expiresAt = Math.floor((nowMs + ttlMs) / 1000);

  const header = {
    alg: 'EdDSA',
    typ: 'UCAN',
    ucv: '0.10.0',
  };
  const payload = {
    iss: runtime.did,
    aud: audience,
    sub: subject,
    cap: capabilities,
    nbf: notBefore,
    exp: expiresAt,
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
    JSON.stringify(payload)
  )}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), runtime.privateKey);
  const token = `${signingInput}.${toBase64Url(signature)}`;

  return {
    ucan: token,
    issuer: runtime.did,
    audience,
    subject,
    capabilities,
    notBefore,
    expiresAt,
  };
}

export function issueCentralUcanBySession(input: {
  sessionToken: string;
  audience?: string;
  capabilities?: UcanCapability[];
  expiresInMs?: number;
}): UcanIssueResult {
  const session = getCentralIssueSession(input.sessionToken);
  if (!session) {
    throw new Error('Invalid or expired session token');
  }
  return issueCentralUcan({
    subject: session.subject,
    audience: input.audience,
    capabilities: input.capabilities,
    expiresInMs: input.expiresInMs,
  });
}

export function tryIssueCentralUcan(input: {
  subject: string;
  audience?: string;
  capabilities?: UcanCapability[];
  expiresInMs?: number;
}): UcanIssueResult | null {
  if (!isCentralUcanIssueEnabled()) {
    return null;
  }
  try {
    return issueCentralUcan(input);
  } catch {
    return null;
  }
}
