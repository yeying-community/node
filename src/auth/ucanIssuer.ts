import * as crypto from 'crypto';
import type { UcanIssuerMode } from '../config';
import { getConfig } from '../config/runtime';
import { getCurrentUtcString } from '../common/date';
import { SingletonDataSource } from '../domain/facade/datasource';
import {
  UcanIssueSessionDO,
  UcanIssuedTokenDO,
  UcanAuditLogDO,
  UcanTokenRevocationDO,
} from '../domain/mapper/entity';
import {
  getNodeIssuerDid,
  getNodeIssuerKeyRing,
  getNodeUcanIssuerKeys,
  type NodeIssuerKey,
} from '../security/nodeIssuer';
import { capabilitiesCover, type UcanCapability } from './ucanPolicy';

export type { UcanCapability } from './ucanPolicy';

export type UcanIssueResult = {
  ucan: string;
  tokenId: string;
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
  allowedAudiences: string[];
  allowedCapabilitiesByAudience: Record<string, UcanCapability[]>;
  issuerKeys: Array<{
    role: string;
    keyId: string;
    did: string;
  }>;
  error?: string;
};

export type CentralIssueSession = {
  sessionToken: string;
  subject: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  allowedAudiences: string[];
  allowedCapabilitiesByAudience: Record<string, UcanCapability[]>;
};

type IssuerRuntimeState = {
  enabled: boolean;
  mode: UcanIssuerMode;
  did: string;
  signingKey?: NodeIssuerKey;
  trustedIssuerDids: string[];
  ready: boolean;
  error?: string;
  sessionTtlMs: number;
  tokenTtlMs: number;
  defaultAudience: string;
  defaultCapabilities: UcanCapability[];
  allowedAudiences: string[];
  allowedCapabilitiesByAudience: Record<string, UcanCapability[]>;
  hasConfiguredIssuePolicy: boolean;
};

type ReadyIssueRuntime = IssuerRuntimeState & {
  enabled: true;
  ready: true;
  did: string;
  signingKey: NodeIssuerKey;
};

type IssueSessionRecord = {
  sessionToken: string;
  sessionHash: string;
  subject: string;
  issuer: string;
  issuedAt: number;
  expiresAt: number;
  allowedAudiences: string[];
  allowedCapabilitiesByAudience: Record<string, UcanCapability[]>;
};

type IssuedTokenRecord = {
  tokenId: string;
  tokenHash: string;
  sessionHash: string;
  subject: string;
  issuer: string;
  audience: string;
  capabilities: UcanCapability[];
  notBefore: number;
  expiresAt: number;
};

type TokenRevocationRecord = {
  tokenId: string;
  sessionHash: string;
  subject: string;
  issuer: string;
  revokedAt: string;
  reason: string;
};

type UcanAuditInput = {
  action: string;
  outcome?: string;
  sessionHash?: string;
  tokenId?: string;
  subject?: string;
  issuer?: string;
  audience?: string;
  capabilities?: UcanCapability[];
  metadata?: Record<string, unknown>;
};

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
const ISSUED_TOKENS = new Map<string, IssuedTokenRecord>();
const UCAN_TOKEN_REVOCATIONS = new Map<string, TokenRevocationRecord>();

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

type IssuePolicy = {
  allowedAudiences: string[];
  allowedCapabilitiesByAudience: Record<string, UcanCapability[]>;
};

function parseAudienceList(raw: unknown): string[] {
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
  return Array.from(
    new Set(
      parsed
        .map(item => String(item || '').trim())
        .filter(Boolean)
    )
  );
}

function parseCapabilitiesByAudience(raw: unknown): Record<string, UcanCapability[]> {
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return Object.create(null) as Record<string, UcanCapability[]>;
  }
  const result = Object.create(null) as Record<string, UcanCapability[]>;
  for (const [audience, value] of Object.entries(parsed)) {
    const normalizedAudience = String(audience || '').trim();
    const capabilities = parseCapabilityList(value);
    if (normalizedAudience && capabilities.length > 0) {
      result[normalizedAudience] = capabilities;
    }
  }
  return result;
}

function hasConfiguredValue(value: unknown): boolean {
  return value !== undefined &&
    value !== null &&
    !(typeof value === 'string' && value.trim() === '');
}

function cloneCapabilities(capabilities: UcanCapability[]): UcanCapability[] {
  return capabilities.map(capability => ({ ...capability }));
}

function cloneIssuePolicy(policy: IssuePolicy): IssuePolicy {
  const allowedCapabilitiesByAudience = Object.create(null) as Record<string, UcanCapability[]>;
  for (const audience of policy.allowedAudiences) {
    allowedCapabilitiesByAudience[audience] = cloneCapabilities(
      policy.allowedCapabilitiesByAudience[audience] || []
    );
  }
  return {
    allowedAudiences: [...policy.allowedAudiences],
    allowedCapabilitiesByAudience,
  };
}

function defaultIssuePolicy(
  defaultAudience: string,
  defaultCapabilities: UcanCapability[],
): IssuePolicy {
  return {
    allowedAudiences: [defaultAudience],
    allowedCapabilitiesByAudience: {
      [defaultAudience]: cloneCapabilities(defaultCapabilities),
    },
  };
}

function loadConfiguredIssuePolicy(
  defaultAudience: string,
  defaultCapabilities: UcanCapability[],
  configuredAudiencesRaw = getConfig<unknown>('issuer.ucan.allowedAudiences'),
  configuredCapabilitiesRaw = getConfig<unknown>('issuer.ucan.allowedCapabilitiesByAudience'),
): IssuePolicy {
  const configuredAudiences = parseAudienceList(
    configuredAudiencesRaw
  );
  const configuredCapabilities = parseCapabilitiesByAudience(
    configuredCapabilitiesRaw
  );
  if (!hasConfiguredValue(configuredAudiencesRaw) && !hasConfiguredValue(configuredCapabilitiesRaw)) {
    return defaultIssuePolicy(defaultAudience, defaultCapabilities);
  }
  const candidates =
    configuredAudiences.length > 0
      ? configuredAudiences
      : Object.keys(configuredCapabilities);
  if (candidates.length === 0) {
    throw new Error('Invalid UCAN issuer policy: no allowed audiences');
  }

  const allowedAudiences: string[] = [];
  const allowedCapabilitiesByAudience = Object.create(null) as Record<string, UcanCapability[]>;
  for (const audience of candidates) {
    const capabilities = configuredCapabilities[audience] || [];
    if (!capabilities.length) {
      throw new Error(`Invalid UCAN issuer policy: missing capabilities for ${audience}`);
    }
    allowedAudiences.push(audience);
    allowedCapabilitiesByAudience[audience] = cloneCapabilities(capabilities);
  }
  return { allowedAudiences, allowedCapabilitiesByAudience };
}

function resolveSessionPolicy(
  input: {
    allowedAudiences?: unknown;
    allowedCapabilitiesByAudience?: unknown;
  },
  runtime: IssuerRuntimeState,
): IssuePolicy {
  const hasExplicitPolicy =
    input.allowedAudiences !== undefined ||
    input.allowedCapabilitiesByAudience !== undefined;
  if (!hasExplicitPolicy) {
    return cloneIssuePolicy(runtime);
  }

  const allowedAudiences = parseAudienceList(input.allowedAudiences);
  const requestedCapabilities = parseCapabilitiesByAudience(
    input.allowedCapabilitiesByAudience
  );
  if (allowedAudiences.length === 0) {
    throw new Error('Invalid UCAN session policy');
  }

  const allowedCapabilitiesByAudience = Object.create(null) as Record<string, UcanCapability[]>;
  for (const audience of allowedAudiences) {
    const capabilities = requestedCapabilities[audience] || [];
    if (capabilities.length === 0) {
      throw new Error('UCAN capabilities exceed issuer policy');
    }
    if (runtime.hasConfiguredIssuePolicy) {
      if (!runtime.allowedAudiences.includes(audience)) {
        throw new Error('UCAN audience is not allowed by issuer policy');
      }
      const issuerCapabilities = runtime.allowedCapabilitiesByAudience[audience] || [];
      if (!capabilitiesCover(issuerCapabilities, capabilities)) {
        throw new Error('UCAN capabilities exceed issuer policy');
      }
    }
    allowedCapabilitiesByAudience[audience] = cloneCapabilities(capabilities);
  }
  return { allowedAudiences, allowedCapabilitiesByAudience };
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
    getConfig<boolean>('issuer.ucan.enabled'),
    false
  );
  const mode = parseIssuerMode(getConfig<string>('issuer.ucan.mode'));
  const configuredDid = getNodeIssuerDid();
  const defaultAudience = String(
    getConfig<string>('issuer.ucan.defaultAudience') ??
      DEFAULT_UCAN_AUD
  ).trim();
  const defaultCapabilities = parseCapabilityList(
    getConfig<unknown>('issuer.ucan.defaultCapabilities')
  );
  const resolvedDefaultAudience = defaultAudience || DEFAULT_UCAN_AUD;
  const resolvedDefaultCapabilities =
    defaultCapabilities.length > 0
      ? defaultCapabilities
      : [{ with: DEFAULT_UCAN_WITH, can: DEFAULT_UCAN_CAN }];
  const configuredAudiencesRaw = getConfig<unknown>('issuer.ucan.allowedAudiences');
  const configuredCapabilitiesRaw = getConfig<unknown>(
    'issuer.ucan.allowedCapabilitiesByAudience'
  );
  const hasConfiguredIssuePolicy =
    hasConfiguredValue(configuredAudiencesRaw) ||
    hasConfiguredValue(configuredCapabilitiesRaw);
  let issuePolicy: IssuePolicy;
  let issuePolicyError: string | undefined;
  try {
    issuePolicy = loadConfiguredIssuePolicy(
      resolvedDefaultAudience,
      resolvedDefaultCapabilities,
      configuredAudiencesRaw,
      configuredCapabilitiesRaw,
    );
  } catch (error) {
    issuePolicy = {
      allowedAudiences: [],
      allowedCapabilitiesByAudience: Object.create(null) as Record<string, UcanCapability[]>,
    };
    issuePolicyError =
      error instanceof Error ? error.message : 'Invalid UCAN issuer policy';
  }

  const runtime: IssuerRuntimeState = {
    enabled,
    mode,
    did: configuredDid,
    trustedIssuerDids: [],
    ready: false,
    sessionTtlMs: parsePositiveNumber(
      getConfig<number>('issuer.ucan.sessionTtlMs'),
      DEFAULT_SESSION_TTL_MS
    ),
    tokenTtlMs: parsePositiveNumber(
      getConfig<number>('issuer.ucan.tokenTtlMs'),
      DEFAULT_TOKEN_TTL_MS
    ),
    defaultAudience: resolvedDefaultAudience,
    defaultCapabilities: resolvedDefaultCapabilities,
    allowedAudiences: issuePolicy.allowedAudiences,
    allowedCapabilitiesByAudience: issuePolicy.allowedCapabilitiesByAudience,
    hasConfiguredIssuePolicy,
    error: issuePolicyError,
  };

  if (!enabled) {
    return runtime;
  }
  if (mode === 'verify') {
    runtime.ready = true;
    return runtime;
  }
  if (issuePolicyError) {
    return runtime;
  }
  try {
    const keys = getNodeIssuerKeyRing();
    const signingKey = keys[0];
    // UCAN `iss` carries the Ed25519 verification key. Keep the current,
    // staged-next and previous keys trusted during a rotation window.
    runtime.did = signingKey.did;
    runtime.signingKey = signingKey;
    runtime.trustedIssuerDids = keys.map(key => key.did);
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
  if (!issuerRuntime.ready || !issuerRuntime.signingKey || !issuerRuntime.did) {
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

function hashSessionToken(sessionToken: string): string {
  return crypto.createHash('sha256').update(sessionToken).digest('hex');
}

function getIssueSessionRepository() {
  const dataSource = SingletonDataSource.get();
  if (!dataSource?.isInitialized) {
    return null;
  }
  return dataSource.getRepository(UcanIssueSessionDO);
}

function getIssuedTokenRepository() {
  const dataSource = SingletonDataSource.get();
  if (!dataSource?.isInitialized) {
    return null;
  }
  return dataSource.getRepository(UcanIssuedTokenDO);
}

function getTokenRevocationRepository() {
  const dataSource = SingletonDataSource.get();
  if (!dataSource?.isInitialized) {
    return null;
  }
  return dataSource.getRepository(UcanTokenRevocationDO);
}

function getUcanAuditRepository() {
  const dataSource = SingletonDataSource.get();
  if (!dataSource?.isInitialized) {
    return null;
  }
  return dataSource.getRepository(UcanAuditLogDO);
}

async function recordUcanAudit(input: UcanAuditInput): Promise<void> {
  const repository = getUcanAuditRepository();
  if (!repository) {
    return;
  }
  const row = repository.create({
    action: String(input.action || '').trim().slice(0, 64),
    outcome: String(input.outcome || 'success').trim().slice(0, 32),
    sessionHash: String(input.sessionHash || '').trim(),
    tokenId: String(input.tokenId || '').trim(),
    subject: String(input.subject || '').trim(),
    issuerDid: String(input.issuer || '').trim(),
    audience: String(input.audience || '').trim(),
    capabilitiesJson: JSON.stringify(input.capabilities || []),
    metadataJson: JSON.stringify(input.metadata || {}),
    createdAt: getCurrentUtcString(),
  });
  await repository.save(row);
}

function cleanupExpiredIssueSessions(nowMs = Date.now()): void {
  for (const [sessionToken, record] of ISSUE_SESSIONS.entries()) {
    if (nowMs > record.expiresAt) {
      ISSUE_SESSIONS.delete(sessionToken);
    }
  }
  for (const [tokenId, record] of ISSUED_TOKENS.entries()) {
    if (nowMs > record.expiresAt * 1000) {
      ISSUED_TOKENS.delete(tokenId);
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
    allowedAudiences: [...record.allowedAudiences],
    allowedCapabilitiesByAudience: cloneIssuePolicy({
      allowedAudiences: record.allowedAudiences,
      allowedCapabilitiesByAudience: record.allowedCapabilitiesByAudience,
    }).allowedCapabilitiesByAudience,
  };
}

function tokenDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

async function persistIssuedToken(record: IssuedTokenRecord): Promise<void> {
  const repository = getIssuedTokenRepository();
  if (!repository) {
    ISSUED_TOKENS.set(record.tokenId, record);
    return;
  }
  const row = repository.create({
    tokenId: record.tokenId,
    sessionHash: record.sessionHash,
    subject: record.subject,
    issuerDid: record.issuer,
    audience: record.audience,
    capabilitiesJson: JSON.stringify(record.capabilities),
    tokenHash: record.tokenHash,
    createdAt: tokenDate(record.notBefore),
    notBefore: tokenDate(record.notBefore),
    expiresAt: tokenDate(record.expiresAt),
  });
  await repository.save(row);
}

async function getIssuedTokenRecord(tokenId: string): Promise<IssuedTokenRecord | null> {
  const normalized = String(tokenId || '').trim();
  if (!normalized) {
    return null;
  }
  const repository = getIssuedTokenRepository();
  if (!repository) {
    return ISSUED_TOKENS.get(normalized) || null;
  }
  const row = await repository.findOneBy({ tokenId: normalized });
  if (!row) {
    return null;
  }
  return {
    tokenId: row.tokenId,
    tokenHash: row.tokenHash,
    sessionHash: row.sessionHash,
    subject: row.subject,
    issuer: row.issuerDid,
    audience: row.audience,
    capabilities: parseCapabilityList(row.capabilitiesJson),
    notBefore: Math.floor(Date.parse(row.notBefore) / 1000),
    expiresAt: Math.floor(Date.parse(row.expiresAt) / 1000),
  };
}

async function persistTokenRevocation(
  record: TokenRevocationRecord
): Promise<boolean> {
  const repository = getTokenRevocationRepository();
  if (!repository) {
    if (UCAN_TOKEN_REVOCATIONS.has(record.tokenId)) {
      return false;
    }
    UCAN_TOKEN_REVOCATIONS.set(record.tokenId, record);
    return true;
  }
  const existing = await repository.findOneBy({ tokenId: record.tokenId });
  if (existing) {
    return false;
  }
  const row = repository.create({
    tokenId: record.tokenId,
    sessionHash: record.sessionHash,
    subject: record.subject,
    issuerDid: record.issuer,
    revokedAt: record.revokedAt,
    reason: record.reason,
  });
  await repository.save(row);
  return true;
}

async function revokeIssuedTokenRecord(
  record: Pick<IssuedTokenRecord, 'tokenId' | 'sessionHash' | 'subject' | 'issuer'> &
    Partial<Pick<IssuedTokenRecord, 'audience' | 'capabilities'>>,
  reason: string
): Promise<boolean> {
  const revoked = await persistTokenRevocation({
    tokenId: record.tokenId,
    sessionHash: record.sessionHash,
    subject: record.subject,
    issuer: record.issuer,
    revokedAt: getCurrentUtcString(),
    reason: String(reason || '').trim().slice(0, 128),
  });
  if (revoked) {
    await recordUcanAudit({
      action: 'token_revoked',
      sessionHash: record.sessionHash,
      tokenId: record.tokenId,
      subject: record.subject,
      issuer: record.issuer,
      audience: record.audience,
      capabilities: record.capabilities,
      metadata: { reason: String(reason || '').trim().slice(0, 128) },
    });
  }
  return revoked;
}

async function revokeIssuedTokensBySession(
  sessionHash: string,
  reason: string
): Promise<number> {
  const normalized = String(sessionHash || '').trim();
  if (!normalized) {
    return 0;
  }
  const repository = getIssuedTokenRepository();
  if (repository) {
    const rows = await repository.findBy({ sessionHash: normalized });
    let revoked = 0;
    for (const row of rows) {
      if (
        await revokeIssuedTokenRecord(
          {
            tokenId: row.tokenId,
            sessionHash: row.sessionHash,
            subject: row.subject,
            issuer: row.issuerDid,
            audience: row.audience,
            capabilities: parseCapabilityList(row.capabilitiesJson),
          },
          reason
        )
      ) {
        revoked += 1;
      }
    }
    return revoked;
  }

  let revoked = 0;
  for (const record of ISSUED_TOKENS.values()) {
    if (record.sessionHash !== normalized) {
      continue;
    }
    if (await revokeIssuedTokenRecord(record, reason)) {
      revoked += 1;
    }
  }
  return revoked;
}

async function isIssueSessionActiveByHash(sessionHash: string): Promise<boolean> {
  const normalized = String(sessionHash || '').trim();
  if (!normalized) {
    return false;
  }
  const repository = getIssueSessionRepository();
  if (repository) {
    const row = await repository.findOneBy({ sessionHash: normalized });
    return Boolean(
      row &&
        !String(row.revokedAt || '').trim() &&
        Number.isFinite(Date.parse(row.expiresAt)) &&
        Date.parse(row.expiresAt) > Date.now()
    );
  }
  return Array.from(ISSUE_SESSIONS.values()).some(
    record =>
      record.sessionHash === normalized &&
      record.expiresAt > Date.now()
  );
}

export async function isCentralUcanTokenRevoked(tokenId: string): Promise<boolean> {
  const normalized = String(tokenId || '').trim();
  if (!normalized) {
    return false;
  }
  const repository = getTokenRevocationRepository();
  if (repository) {
    return Boolean(await repository.findOneBy({ tokenId: normalized }));
  }
  return UCAN_TOKEN_REVOCATIONS.has(normalized);
}

export async function revokeCentralUcanToken(
  tokenId: string,
  reason = 'manual_revoke'
): Promise<boolean> {
  const normalized = String(tokenId || '').trim();
  if (!normalized) {
    return false;
  }
  const record = await getIssuedTokenRecord(normalized);
  return revokeIssuedTokenRecord(
    record || {
      tokenId: normalized,
      sessionHash: '',
      subject: '',
      issuer: '',
    },
    reason
  );
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
    allowedAudiences: [...issuerRuntime.allowedAudiences],
    allowedCapabilitiesByAudience: cloneIssuePolicy({
      allowedAudiences: issuerRuntime.allowedAudiences,
      allowedCapabilitiesByAudience: issuerRuntime.allowedCapabilitiesByAudience,
    }).allowedCapabilitiesByAudience,
    issuerKeys:
      issuerRuntime.ready && isIssueModeEnabled(issuerRuntime.mode)
        ? getNodeUcanIssuerKeys()
        : [],
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

export async function createCentralIssueSession(input: {
  subject: string;
  expiresInMs?: number;
  allowedAudiences?: string[];
  allowedCapabilitiesByAudience?: Record<string, UcanCapability[]>;
}): Promise<CentralIssueSession> {
  const runtime = validateIssueRuntime();
  cleanupExpiredIssueSessions();

  const subject = normalizeSubject(input.subject);
  if (!subject) {
    throw new Error('Missing UCAN subject');
  }

  const issuePolicy = resolveSessionPolicy(input, runtime);
  const ttlMs = clampSessionTtlMs(input.expiresInMs, runtime.sessionTtlMs);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const sessionToken = generateSessionToken();

  const record: IssueSessionRecord = {
    sessionToken,
    sessionHash: hashSessionToken(sessionToken),
    subject,
    issuer: runtime.did,
    issuedAt,
    expiresAt,
    allowedAudiences: issuePolicy.allowedAudiences,
    allowedCapabilitiesByAudience: issuePolicy.allowedCapabilitiesByAudience,
  };
  const repository = getIssueSessionRepository();
  if (repository) {
    const row = repository.create({
      sessionHash: record.sessionHash,
      subject: record.subject,
      issuerDid: record.issuer,
      allowedAudiencesJson: JSON.stringify(record.allowedAudiences),
      allowedCapabilitiesJson: JSON.stringify(record.allowedCapabilitiesByAudience),
      createdAt: new Date(record.issuedAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(),
      lastUsedAt: '',
      revokedAt: '',
    });
  await repository.save(row);
  await recordUcanAudit({
    action: 'session_created',
    sessionHash: record.sessionHash,
    subject: record.subject,
    issuer: record.issuer,
    metadata: {
      expiresAt: new Date(record.expiresAt).toISOString(),
      allowedAudiences: record.allowedAudiences,
      allowedCapabilitiesByAudience: record.allowedCapabilitiesByAudience,
    },
  });
  } else {
    ISSUE_SESSIONS.set(sessionToken, record);
    await recordUcanAudit({
      action: 'session_created',
      sessionHash: record.sessionHash,
      subject: record.subject,
      issuer: record.issuer,
      metadata: {
        expiresAt: new Date(record.expiresAt).toISOString(),
        allowedAudiences: record.allowedAudiences,
        allowedCapabilitiesByAudience: record.allowedCapabilitiesByAudience,
      },
    });
  }
  return toIssueSession(record);
}

export async function getCentralIssueSession(sessionToken: string): Promise<CentralIssueSession | null> {
  cleanupExpiredIssueSessions();
  const normalized = normalizeSessionToken(sessionToken);
  if (!normalized) {
    return null;
  }
  const repository = getIssueSessionRepository();
  if (repository) {
    const row = await repository.findOneBy({ sessionHash: hashSessionToken(normalized) });
    if (
      !row ||
      String(row.revokedAt || '').trim() ||
      !Number.isFinite(Date.parse(row.expiresAt)) ||
      Date.parse(row.expiresAt) <= Date.now()
    ) {
      return null;
    }
    const runtime = getIssuerRuntime();
    const persistedAudiences = parseAudienceList(row.allowedAudiencesJson);
    const persistedCapabilities = parseCapabilitiesByAudience(row.allowedCapabilitiesJson);
    let issuePolicy: IssuePolicy;
    try {
      issuePolicy =
        persistedAudiences.length > 0
          ? resolveSessionPolicy({
              allowedAudiences: persistedAudiences,
              allowedCapabilitiesByAudience: persistedCapabilities,
            }, runtime)
          : cloneIssuePolicy(runtime);
    } catch {
      return null;
    }
    return {
      sessionToken: normalized,
      subject: row.subject,
      issuer: row.issuerDid,
      issuedAt: Date.parse(row.createdAt),
      expiresAt: Date.parse(row.expiresAt),
      allowedAudiences: issuePolicy.allowedAudiences,
      allowedCapabilitiesByAudience: issuePolicy.allowedCapabilitiesByAudience,
    };
  }
  const record = ISSUE_SESSIONS.get(normalized);
  return record ? toIssueSession(record) : null;
}

export async function revokeCentralIssueSession(sessionToken: string): Promise<boolean> {
  const normalized = normalizeSessionToken(sessionToken);
  if (!normalized) {
    return false;
  }
  const sessionHash = hashSessionToken(normalized);
  const repository = getIssueSessionRepository();
  if (repository) {
    const existing = await repository.findOneBy({ sessionHash });
    const result = await repository.update(
      { sessionHash, revokedAt: '' },
      { revokedAt: getCurrentUtcString() },
    );
    const affected = Number(result.affected || 0);
    if (affected > 0) {
      const revokedTokens = await revokeIssuedTokensBySession(sessionHash, 'session_revoked');
      await recordUcanAudit({
        action: 'session_revoked',
        sessionHash,
        subject: existing?.subject,
        issuer: existing?.issuerDid,
        metadata: { revokedTokens },
      });
      return true;
    }
    if (existing) {
      // Retry token blacklisting if a previous revoke completed the session
      // update but was interrupted before all token rows were recorded.
      await revokeIssuedTokensBySession(sessionHash, 'session_revoked');
    }
    return false;
  }
  const record = ISSUE_SESSIONS.get(normalized);
  if (!record) {
    return false;
  }
  ISSUE_SESSIONS.delete(normalized);
  const revokedTokens = await revokeIssuedTokensBySession(record.sessionHash, 'session_revoked');
  await recordUcanAudit({
    action: 'session_revoked',
    sessionHash: record.sessionHash,
    subject: record.subject,
    issuer: record.issuer,
    metadata: { revokedTokens },
  });
  return true;
}

export async function issueCentralUcan(input: {
  subject: string;
  audience?: string;
  capabilities?: UcanCapability[];
  expiresInMs?: number;
  sessionHash?: string;
}): Promise<UcanIssueResult> {
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
    kid: runtime.signingKey.keyId,
  };
  const tokenId = crypto.randomUUID();
  const payload = {
    iss: runtime.did,
    aud: audience,
    sub: subject,
    cap: capabilities,
    jti: tokenId,
    nbf: notBefore,
    exp: expiresAt,
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
    JSON.stringify(payload)
  )}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), runtime.signingKey.privateKey);
  const token = `${signingInput}.${toBase64Url(signature)}`;

  const normalizedSessionHash = String(input.sessionHash || '').trim();
  await persistIssuedToken({
    tokenId,
    tokenHash: hashSessionToken(token),
    sessionHash: normalizedSessionHash,
    subject,
    issuer: runtime.did,
    audience,
    capabilities,
    notBefore,
    expiresAt,
  });
  await recordUcanAudit({
    action: 'token_issued',
    sessionHash: normalizedSessionHash,
    tokenId,
    subject,
    issuer: runtime.did,
    audience,
    capabilities,
    metadata: {
      notBefore: tokenDate(notBefore),
      expiresAt: tokenDate(expiresAt),
    },
  });
  if (
    normalizedSessionHash &&
    !(await isIssueSessionActiveByHash(normalizedSessionHash))
  ) {
    await revokeCentralUcanToken(tokenId, 'session_revoked');
    throw new Error('Invalid or expired session token');
  }

  return {
    ucan: token,
    tokenId,
    issuer: runtime.did,
    audience,
    subject,
    capabilities,
    notBefore,
    expiresAt,
  };
}

export async function issueCentralUcanBySession(input: {
  sessionToken: string;
  audience?: string;
  capabilities?: UcanCapability[];
  expiresInMs?: number;
}): Promise<UcanIssueResult> {
  const runtime = validateIssueRuntime();
  const session = await getCentralIssueSession(input.sessionToken);
  if (!session) {
    throw new Error('Invalid or expired session token');
  }
  const audience = String(input.audience || session.allowedAudiences[0] || '').trim();
  if (!audience || !session.allowedAudiences.includes(audience)) {
    throw new Error('UCAN audience is not allowed by session');
  }

  const allowedCapabilities =
    session.allowedCapabilitiesByAudience[audience] || [];
  const requestedCapabilities = Array.isArray(input.capabilities)
    ? input.capabilities
        .map(item => sanitizeCapability(item))
        .filter((item): item is UcanCapability => Boolean(item))
    : [];
  const capabilities =
    requestedCapabilities.length > 0
      ? requestedCapabilities
      : cloneCapabilities(allowedCapabilities);
  if (capabilities.length === 0) {
    throw new Error('Missing UCAN capabilities');
  }
  if (!capabilitiesCover(allowedCapabilities, capabilities)) {
    throw new Error('UCAN capabilities are not allowed by session');
  }

  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const sessionExpiresAtSeconds = Math.floor(session.expiresAt / 1000);
  const remainingMs = Math.max(0, sessionExpiresAtSeconds - nowSeconds) * 1000;
  const hasRequestedTtl =
    input.expiresInMs !== undefined;
  const requestedTtl = parsePositiveNumber(
    input.expiresInMs,
    runtime.tokenTtlMs
  );
  if (
    hasRequestedTtl &&
    Math.floor((nowMs + requestedTtl) / 1000) > sessionExpiresAtSeconds
  ) {
    throw new Error('UCAN TTL exceeds session expiry');
  }
  const ttlMs = Math.min(requestedTtl, runtime.tokenTtlMs, remainingMs);
  if (ttlMs < MIN_ISSUED_TOKEN_TTL_MS) {
    throw new Error('UCAN session expires too soon');
  }

  return issueCentralUcan({
    subject: session.subject,
    audience,
    capabilities,
    expiresInMs: ttlMs,
    sessionHash: hashSessionToken(normalizeSessionToken(input.sessionToken)),
  });
}

export async function tryIssueCentralUcan(input: {
  subject: string;
  audience?: string;
  capabilities?: UcanCapability[];
  expiresInMs?: number;
}): Promise<UcanIssueResult | null> {
  if (!isCentralUcanIssueEnabled()) {
    return null;
  }
  try {
    return await issueCentralUcan(input);
  } catch {
    return null;
  }
}
