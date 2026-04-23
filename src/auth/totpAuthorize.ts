import * as crypto from 'crypto';
import { getConfig } from '../config/runtime';
import { ApplicationService } from '../domain/service/application';
import { getCentralIssuerStatus, type UcanCapability } from './ucanIssuer';
import {
  TotpAuthError,
  assertTotpAuthReady,
  buildTotpVerifyUrl,
  verifyTotpCodeForSubject,
} from './totpAuth';

export type TotpAuthorizeRequestStatus = 'pending' | 'used' | 'expired' | 'revoked';

export type TotpAuthorizeClient = {
  appId: string;
  redirectUris: string[];
  appName?: string;
  defaultAudience?: string;
  defaultCapabilities?: UcanCapability[];
};

export type TotpAuthorizeRequestCreateResult = {
  requestId: string;
  status: TotpAuthorizeRequestStatus;
  subject: string;
  subjectHint: string;
  appId: string;
  redirectUri: string;
  state?: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  createdAt: number;
  expiresAt: number;
  verifyUrl: string;
};

export type TotpAuthorizeRequestPublicResult = Omit<TotpAuthorizeRequestCreateResult, 'subject'>;

export type TotpAuthorizeRequestConsumeResult = {
  requestId: string;
  subject: string;
  appId: string;
  redirectUri: string;
  state?: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  sessionTtlMs?: number;
  tokenTtlMs?: number;
  approvedAt: number;
};

export type TotpAuthorizeCodeCreateResult = {
  code: string;
  expiresAt: number;
  redirectTo: string;
};

export type TotpAuthorizeCodeExchangeResult = {
  requestId: string;
  subject: string;
  appId: string;
  redirectUri: string;
  state?: string;
  token: string;
  expiresAt: number;
  refreshExpiresAt: number;
  ucan: string;
  issuer: string;
  audience: string;
  capabilities: UcanCapability[];
  notBefore: number;
  ucanExpiresAt: number;
  issuedAt: number;
};

type TotpAuthorizeRuntimeState = {
  exchangeCodeTtlMs: number;
};

type TotpAuthorizeRequestRecord = {
  requestId: string;
  status: TotpAuthorizeRequestStatus;
  subject: string;
  appId: string;
  redirectUri: string;
  state?: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  attempts: number;
  sessionTtlMs?: number;
  tokenTtlMs?: number;
};

type TotpAuthorizeCodeRecord = {
  code: string;
  requestId: string;
  subject: string;
  appId: string;
  redirectUri: string;
  state?: string;
  token: string;
  expiresAt: number;
  refreshExpiresAt: number;
  ucan: string;
  issuer: string;
  audience: string;
  capabilities: UcanCapability[];
  notBefore: number;
  ucanExpiresAt: number;
  issuedAt: number;
  createdAt: number;
  codeExpiresAt: number;
  used: boolean;
};

const MIN_REQUEST_TTL_MS = 60 * 1000;
const MAX_REQUEST_TTL_MS = 30 * 60 * 1000;
const DEFAULT_EXCHANGE_CODE_TTL_MS = 60 * 1000;
const MIN_EXCHANGE_CODE_TTL_MS = 10 * 1000;
const MAX_EXCHANGE_CODE_TTL_MS = 5 * 60 * 1000;
const MAX_STATE_LENGTH = 1024;
const MAX_APP_NAME_LENGTH = 128;
const GC_RETENTION_MS = 24 * 60 * 60 * 1000;
const DYNAMIC_CLIENT_CACHE_TTL_MS = 60 * 1000;
const APP_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUTHORIZE_REQUESTS = new Map<string, TotpAuthorizeRequestRecord>();
const AUTHORIZE_CODES = new Map<string, TotpAuthorizeCodeRecord>();
const AUTHORIZE_RUNTIME = loadAuthorizeRuntime();
const DYNAMIC_CLIENT_CACHE = new Map<
  string,
  {
    expiresAt: number;
    client: TotpAuthorizeClient | null;
  }
>();

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function clampRequestTtlMs(value: unknown, fallback: number): number {
  const parsed = parsePositiveNumber(value, fallback);
  return Math.min(Math.max(parsed, MIN_REQUEST_TTL_MS), MAX_REQUEST_TTL_MS);
}

function clampExchangeCodeTtlMs(value: unknown): number {
  const parsed = parsePositiveNumber(value, DEFAULT_EXCHANGE_CODE_TTL_MS);
  return Math.min(Math.max(parsed, MIN_EXCHANGE_CODE_TTL_MS), MAX_EXCHANGE_CODE_TTL_MS);
}

function normalizeSubject(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase();
  }
  return value;
}

function requireWalletAddress(input: unknown): string {
  const normalized = normalizeSubject(input);
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new TotpAuthError(400, 'TOTP_AUTH_ADDRESS_INVALID', 'Invalid blockchain address');
  }
  return normalized;
}

function normalizeRequestId(input: unknown): string {
  return String(input || '').trim();
}

function normalizeAppId(input: unknown): string {
  return String(input || '').trim();
}

function normalizeState(input: unknown): string | undefined {
  const value = String(input || '').trim();
  if (!value) return undefined;
  if (value.length > MAX_STATE_LENGTH) {
    throw new TotpAuthError(400, 'TOTP_AUTH_STATE_TOO_LONG', 'State is too long');
  }
  return value;
}

function normalizeAppName(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) return 'totp-client';
  if (value.length > MAX_APP_NAME_LENGTH) {
    return value.slice(0, MAX_APP_NAME_LENGTH);
  }
  return value;
}

function normalizeRedirectUri(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new TotpAuthError(400, 'TOTP_AUTH_REDIRECT_REQUIRED', 'Missing redirectUri');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TotpAuthError(400, 'TOTP_AUTH_REDIRECT_INVALID', 'Invalid redirectUri');
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'javascript:' || protocol === 'data:') {
    throw new TotpAuthError(400, 'TOTP_AUTH_REDIRECT_INVALID', 'Invalid redirectUri scheme');
  }
  parsed.hash = '';
  return parsed.toString();
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

function loadAuthorizeRuntime(): TotpAuthorizeRuntimeState {
  const exchangeCodeTtlMs = clampExchangeCodeTtlMs(
    process.env.TOTP_AUTH_EXCHANGE_CODE_TTL_MS ??
      getConfig<number>('totpAuth.exchangeCodeTtlMs')
  );
  return { exchangeCodeTtlMs };
}

function cleanupAuthorizeRecords(nowMs = Date.now()): void {
  for (const [appId, cacheItem] of DYNAMIC_CLIENT_CACHE.entries()) {
    if (cacheItem.expiresAt <= nowMs) {
      DYNAMIC_CLIENT_CACHE.delete(appId);
    }
  }

  for (const [requestId, record] of AUTHORIZE_REQUESTS.entries()) {
    if (record.status === 'pending' && nowMs > record.expiresAt) {
      record.status = 'expired';
      record.updatedAt = nowMs;
      AUTHORIZE_REQUESTS.set(requestId, record);
      continue;
    }
    if (record.status !== 'pending' && nowMs - record.updatedAt > GC_RETENTION_MS) {
      AUTHORIZE_REQUESTS.delete(requestId);
    }
  }

  for (const [code, record] of AUTHORIZE_CODES.entries()) {
    const shouldDelete =
      (record.used && nowMs - record.createdAt > GC_RETENTION_MS) ||
      nowMs > record.codeExpiresAt + GC_RETENTION_MS;
    if (shouldDelete) {
      AUTHORIZE_CODES.delete(code);
    }
  }
}

function parseRedirectUrisFromApplication(raw: unknown): string[] {
  const values: string[] = [];
  const pushValue = (input: unknown) => {
    const value = String(input || '').trim();
    if (!value) return;
    values.push(value);
  };

  if (Array.isArray(raw)) {
    raw.forEach((item) => pushValue(item));
  } else {
    const text = String(raw || '').trim();
    if (text) {
      if (text.startsWith('[')) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => pushValue(item));
          }
        } catch {
          // fallback to split mode
        }
      }
      if (values.length === 0) {
        text
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item) => pushValue(item));
      }
    }
  }

  const normalized = new Set<string>();
  values.forEach((uri) => {
    try {
      normalized.add(normalizeRedirectUri(uri));
    } catch {
      // ignore invalid redirect uri values
    }
  });
  return [...normalized];
}

async function resolveAuthorizeAppByAppId(appId: string): Promise<TotpAuthorizeClient | null> {
  if (!APP_ID_REGEX.test(appId)) {
    return null;
  }
  const nowMs = Date.now();
  const cached = DYNAMIC_CLIENT_CACHE.get(appId);
  if (cached && cached.expiresAt > nowMs) {
    return cached.client;
  }

  const service = new ApplicationService();
  const app = await service.queryByUid(appId);
  if (!app || !app.uid || !app.isOnline) {
    DYNAMIC_CLIENT_CACHE.set(appId, { client: null, expiresAt: nowMs + DYNAMIC_CLIENT_CACHE_TTL_MS });
    return null;
  }

  const redirectUris = parseRedirectUrisFromApplication(app.redirectUris);
  if (redirectUris.length === 0) {
    throw new TotpAuthError(
      403,
      'TOTP_AUTH_REDIRECT_NOT_CONFIGURED',
      'redirectUris are not configured for this app'
    );
  }

  const issuerStatus = getCentralIssuerStatus();
  const defaultCapabilities =
    Array.isArray(issuerStatus.defaultCapabilities) && issuerStatus.defaultCapabilities.length > 0
      ? issuerStatus.defaultCapabilities
      : undefined;

  const client: TotpAuthorizeClient = {
    appId,
    appName: normalizeAppName(app.name || app.code || appId),
    redirectUris,
    defaultAudience: issuerStatus.defaultAudience || undefined,
    defaultCapabilities,
  };
  DYNAMIC_CLIENT_CACHE.set(appId, { client, expiresAt: nowMs + DYNAMIC_CLIENT_CACHE_TTL_MS });
  return client;
}

async function getAuthorizeApp(appIdInput: unknown): Promise<TotpAuthorizeClient> {
  const appId = normalizeAppId(appIdInput);
  if (!appId) {
    throw new TotpAuthError(400, 'TOTP_AUTH_APP_REQUIRED', 'Missing appId');
  }
  const appClient = await resolveAuthorizeAppByAppId(appId);
  if (appClient) {
    return appClient;
  }
  throw new TotpAuthError(403, 'TOTP_AUTH_APP_DENIED', 'Unauthorized appId (must be published AppId)');
}

function requireAppRedirect(app: TotpAuthorizeClient, redirectUriInput: unknown): string {
  const redirectUri = normalizeRedirectUri(redirectUriInput);
  if (!app.redirectUris.includes(redirectUri)) {
    throw new TotpAuthError(403, 'TOTP_AUTH_REDIRECT_DENIED', 'redirectUri is not allowed');
  }
  return redirectUri;
}

function generateRequestId(): string {
  const base =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  return `${base}${crypto.randomBytes(8).toString('hex')}`;
}

function generateAuthorizationCode(): string {
  return crypto
    .randomBytes(24)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function maskSubject(subject: string): string {
  if (!subject) return '';
  if (/^0x[0-9a-f]{40}$/.test(subject)) {
    return `${subject.slice(0, 8)}...${subject.slice(-6)}`;
  }
  if (subject.length <= 12) return subject;
  return `${subject.slice(0, 6)}...${subject.slice(-4)}`;
}

function requirePendingRequest(
  record: TotpAuthorizeRequestRecord,
  nowMs: number
): TotpAuthorizeRequestRecord {
  if (record.status === 'pending' && nowMs > record.expiresAt) {
    record.status = 'expired';
    record.updatedAt = nowMs;
  }
  if (record.status === 'pending') {
    return record;
  }
  if (record.status === 'expired') {
    throw new TotpAuthError(410, 'TOTP_AUTH_REQUEST_EXPIRED', 'totp authorize request expired');
  }
  if (record.status === 'used') {
    throw new TotpAuthError(409, 'TOTP_AUTH_REQUEST_USED', 'totp authorize request already used');
  }
  throw new TotpAuthError(403, 'TOTP_AUTH_REQUEST_REVOKED', 'totp authorize request revoked');
}

function toPublicResult(record: TotpAuthorizeRequestRecord): TotpAuthorizeRequestPublicResult {
  return {
    requestId: record.requestId,
    status: record.status,
    subjectHint: maskSubject(record.subject),
    appId: record.appId,
    redirectUri: record.redirectUri,
    state: record.state,
    audience: record.audience,
    capabilities: [...record.capabilities],
    appName: record.appName,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    verifyUrl: buildTotpVerifyUrl(record.requestId),
  };
}

function appendQuery(baseUrl: string, query: Record<string, string>): string {
  const parsed = new URL(baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    if (value) {
      parsed.searchParams.set(key, value);
    }
  });
  return parsed.toString();
}

export async function createTotpAuthorizeRequest(input: {
  subject: string;
  appId: string;
  redirectUri: string;
  state?: string;
  audience?: string;
  capabilities?: UcanCapability[];
  appName?: string;
  requestTtlMs?: number;
  sessionTtlMs?: number;
  tokenTtlMs?: number;
}): Promise<TotpAuthorizeRequestCreateResult> {
  const totpStatus = assertTotpAuthReady();
  cleanupAuthorizeRecords();

  const subject = requireWalletAddress(input.subject);
  const app = await getAuthorizeApp(input.appId);
  const redirectUri = requireAppRedirect(app, input.redirectUri);
  const state = normalizeState(input.state);
  const capabilitiesInput = Array.isArray(input.capabilities) ? input.capabilities : [];
  const capabilities = capabilitiesInput
    .map(entry => sanitizeCapability(entry))
    .filter((entry): entry is UcanCapability => Boolean(entry));
  const resolvedCapabilities =
    capabilities.length > 0 ? capabilities : app.defaultCapabilities || [];
  if (resolvedCapabilities.length === 0) {
    throw new TotpAuthError(
      400,
      'TOTP_AUTH_CAPABILITIES_REQUIRED',
      'Missing capabilities for authorize request'
    );
  }

  const audience = String(input.audience || app.defaultAudience || '').trim();
  if (!audience) {
    throw new TotpAuthError(
      400,
      'TOTP_AUTH_AUDIENCE_REQUIRED',
      'Missing audience for authorize request'
    );
  }

  const nowMs = Date.now();
  const requestId = generateRequestId();
  const expiresAt = nowMs + clampRequestTtlMs(input.requestTtlMs, totpStatus.requestTtlMs);

  const record: TotpAuthorizeRequestRecord = {
    requestId,
    status: 'pending',
    subject,
    appId: app.appId,
    redirectUri,
    state,
    audience,
    capabilities: resolvedCapabilities,
    appName: normalizeAppName(input.appName || app.appName || app.appId),
    createdAt: nowMs,
    updatedAt: nowMs,
    expiresAt,
    attempts: 0,
    sessionTtlMs: parseOptionalPositiveNumber(input.sessionTtlMs),
    tokenTtlMs: parseOptionalPositiveNumber(input.tokenTtlMs),
  };

  AUTHORIZE_REQUESTS.set(requestId, record);
  return {
    ...toPublicResult(record),
    subject: record.subject,
  };
}

export function getTotpAuthorizeRequest(
  requestIdInput: string
): TotpAuthorizeRequestPublicResult | null {
  assertTotpAuthReady();
  cleanupAuthorizeRecords();
  const requestId = normalizeRequestId(requestIdInput);
  if (!requestId) return null;
  const record = AUTHORIZE_REQUESTS.get(requestId);
  if (!record) return null;
  return toPublicResult(record);
}

export function consumeTotpAuthorizeRequest(input: {
  requestId: string;
  code: string;
}): TotpAuthorizeRequestConsumeResult {
  const totpStatus = assertTotpAuthReady();
  cleanupAuthorizeRecords();

  const requestId = normalizeRequestId(input.requestId);
  if (!requestId) {
    throw new TotpAuthError(400, 'TOTP_AUTH_REQUEST_REQUIRED', 'Missing requestId');
  }
  const record = AUTHORIZE_REQUESTS.get(requestId);
  if (!record) {
    throw new TotpAuthError(404, 'TOTP_AUTH_REQUEST_NOT_FOUND', 'totp authorize request not found');
  }
  const nowMs = Date.now();
  const pending = requirePendingRequest(record, nowMs);

  if (!verifyTotpCodeForSubject(pending.subject, input.code)) {
    pending.attempts += 1;
    pending.updatedAt = nowMs;
    if (pending.attempts >= totpStatus.maxAttempts) {
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
  AUTHORIZE_REQUESTS.set(requestId, pending);

  return {
    requestId: pending.requestId,
    subject: pending.subject,
    appId: pending.appId,
    redirectUri: pending.redirectUri,
    state: pending.state,
    audience: pending.audience,
    capabilities: [...pending.capabilities],
    appName: pending.appName,
    sessionTtlMs: pending.sessionTtlMs,
    tokenTtlMs: pending.tokenTtlMs,
    approvedAt: nowMs,
  };
}

export async function createTotpAuthorizeCode(input: {
  requestId: string;
  subject: string;
  appId: string;
  redirectUri: string;
  state?: string;
  token: string;
  expiresAt: number;
  refreshExpiresAt: number;
  ucan: string;
  issuer: string;
  audience: string;
  capabilities: UcanCapability[];
  notBefore: number;
  ucanExpiresAt: number;
  issuedAt?: number;
  codeTtlMs?: number;
}): Promise<TotpAuthorizeCodeCreateResult> {
  assertTotpAuthReady();
  cleanupAuthorizeRecords();

  const app = await getAuthorizeApp(input.appId);
  const redirectUri = requireAppRedirect(app, input.redirectUri);
  const requestId = normalizeRequestId(input.requestId);
  if (!requestId) {
    throw new TotpAuthError(400, 'TOTP_AUTH_REQUEST_REQUIRED', 'Missing requestId');
  }
  const subject = requireWalletAddress(input.subject);
  const token = String(input.token || '').trim();
  const ucan = String(input.ucan || '').trim();
  if (!token || !ucan) {
    throw new TotpAuthError(500, 'TOTP_AUTH_CODE_PAYLOAD_INVALID', 'Missing token payload');
  }

  const state = normalizeState(input.state);
  const nowMs = Date.now();
  const codeTtlMs = clampExchangeCodeTtlMs(input.codeTtlMs ?? AUTHORIZE_RUNTIME.exchangeCodeTtlMs);
  const codeExpiresAt = nowMs + codeTtlMs;
  const code = generateAuthorizationCode();

  const record: TotpAuthorizeCodeRecord = {
    code,
    requestId,
    subject,
    appId: app.appId,
    redirectUri,
    state,
    token,
    expiresAt: input.expiresAt,
    refreshExpiresAt: input.refreshExpiresAt,
    ucan,
    issuer: String(input.issuer || '').trim(),
    audience: String(input.audience || '').trim(),
    capabilities: [...input.capabilities],
    notBefore: input.notBefore,
    ucanExpiresAt: input.ucanExpiresAt,
    issuedAt: input.issuedAt || nowMs,
    createdAt: nowMs,
    codeExpiresAt,
    used: false,
  };
  AUTHORIZE_CODES.set(code, record);

  const redirectTo = appendQuery(redirectUri, {
    code,
    state: state || '',
  });
  return {
    code,
    expiresAt: codeExpiresAt,
    redirectTo,
  };
}

export async function exchangeTotpAuthorizeCode(input: {
  code: string;
  appId: string;
  redirectUri: string;
}): Promise<TotpAuthorizeCodeExchangeResult> {
  assertTotpAuthReady();
  cleanupAuthorizeRecords();

  const code = String(input.code || '').trim();
  if (!code) {
    throw new TotpAuthError(400, 'TOTP_AUTH_CODE_REQUIRED', 'Missing authorization code');
  }
  const app = await getAuthorizeApp(input.appId);
  const redirectUri = requireAppRedirect(app, input.redirectUri);
  const record = AUTHORIZE_CODES.get(code);
  if (!record) {
    throw new TotpAuthError(404, 'TOTP_AUTH_CODE_NOT_FOUND', 'Authorization code not found');
  }

  const nowMs = Date.now();
  if (record.used) {
    throw new TotpAuthError(409, 'TOTP_AUTH_CODE_USED', 'Authorization code already used');
  }
  if (nowMs > record.codeExpiresAt) {
    throw new TotpAuthError(410, 'TOTP_AUTH_CODE_EXPIRED', 'Authorization code expired');
  }
  if (record.appId !== app.appId || record.redirectUri !== redirectUri) {
    throw new TotpAuthError(
      403,
      'TOTP_AUTH_CODE_APP_MISMATCH',
      'Authorization code does not match app binding'
    );
  }

  record.used = true;
  AUTHORIZE_CODES.set(code, record);

  return {
    requestId: record.requestId,
    subject: record.subject,
    appId: record.appId,
    redirectUri: record.redirectUri,
    state: record.state,
    token: record.token,
    expiresAt: record.expiresAt,
    refreshExpiresAt: record.refreshExpiresAt,
    ucan: record.ucan,
    issuer: record.issuer,
    audience: record.audience,
    capabilities: [...record.capabilities],
    notBefore: record.notBefore,
    ucanExpiresAt: record.ucanExpiresAt,
    issuedAt: record.issuedAt,
  };
}
