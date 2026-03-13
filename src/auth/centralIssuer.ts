import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { getConfig } from '../config/runtime';

export type CentralUcanCapability = {
  resource: string;
  action: string;
};

type CentralIssuerState = {
  did: string;
  privateKey: crypto.KeyObject;
};

type CentralSessionPayload = {
  subject: string;
  sid?: string;
};

type IssueCentralUcanOptions = {
  subject: string;
  audience: string;
  capabilities: CentralUcanCapability[];
  expiresInMs?: number;
  notBeforeMs?: number;
};

type CentralUcanPayload = {
  iss: string;
  sub: string;
  aud: string;
  cap: CentralUcanCapability[];
  exp: number;
  nbf?: number;
  iat: number;
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_TOKEN_TTL_MS = 60 * 60 * 1000;

const CENTRAL_ISSUER_ENABLED = parseBoolean(
  process.env.UCAN_CENTRAL_ISSUER_ENABLED ?? getConfig<boolean>('ucan.centralIssuerEnabled'),
  false
);
const CENTRAL_TRUSTED_DID = String(
  process.env.UCAN_CENTRAL_TRUSTED_DID || getConfig<string>('ucan.centralIssuerDid') || ''
).trim();
const CENTRAL_ISSUER_SEED = String(process.env.UCAN_CENTRAL_ISSUER_SEED || '').trim();
const CENTRAL_SESSION_SECRET = String(
  process.env.UCAN_CENTRAL_SESSION_SECRET ||
    process.env.JWT_SECRET ||
    getConfig<string>('auth.jwtSecret') ||
    'replace-this-in-production'
);
const CENTRAL_SESSION_TTL_MS = parseNumber(
  process.env.UCAN_CENTRAL_SESSION_TTL_MS,
  DEFAULT_SESSION_TTL_MS
);
const CENTRAL_TOKEN_TTL_MS = parseNumber(
  process.env.UCAN_CENTRAL_TOKEN_TTL_MS,
  DEFAULT_TOKEN_TTL_MS
);
const CENTRAL_TOKEN_MAX_TTL_MS = parseNumber(
  process.env.UCAN_CENTRAL_TOKEN_MAX_TTL_MS,
  DEFAULT_MAX_TOKEN_TTL_MS
);

let cachedState: CentralIssuerState | null = null;

function parseNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function base58Encode(input: Buffer): string {
  if (input.length === 0) return '';
  const digits: number[] = [0];
  for (const byte of input) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      const value = digits[i] * 256 + carry;
      digits[i] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === 0) {
    leadingZeros += 1;
  }
  const body = digits
    .reverse()
    .map(index => BASE58_ALPHABET[index])
    .join('');
  return '1'.repeat(leadingZeros) + body;
}

function decodeSeed(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Empty central issuer seed');
  }
  const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    return Buffer.from(hex, 'hex');
  }
  return base64UrlDecode(trimmed);
}

function createPrivateKeyFromSeed(seed: Buffer): crypto.KeyObject {
  if (seed.length !== 32) {
    throw new Error('Central issuer seed must be 32 bytes');
  }
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const der = Buffer.concat([prefix, seed]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function extractRawPublicKey(privateKey: crypto.KeyObject): Buffer {
  const exported = crypto.createPublicKey(privateKey).export({
    format: 'der',
    type: 'spki',
  });
  if (!Buffer.isBuffer(exported)) {
    throw new Error('Unable to export central issuer public key');
  }
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  if (exported.length !== prefix.length + 32 || !exported.subarray(0, prefix.length).equals(prefix)) {
    throw new Error('Unsupported central issuer public key format');
  }
  return exported.subarray(prefix.length);
}

function didKeyFromPublicKey(raw: Buffer): string {
  if (raw.length !== 32) {
    throw new Error('Invalid Ed25519 public key length');
  }
  const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), raw]);
  return `did:key:z${base58Encode(multicodec)}`;
}

function normalizeCapabilities(caps: CentralUcanCapability[]): CentralUcanCapability[] {
  const seen = new Set<string>();
  const result: CentralUcanCapability[] = [];
  for (const cap of caps) {
    const resource = String(cap?.resource || '').trim();
    const action = String(cap?.action || '').trim();
    if (!resource || !action) continue;
    const key = `${resource}|${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ resource, action });
  }
  return result;
}

function clampTtl(requestedMs: number | undefined, fallbackMs: number): number {
  const requested = Number(requestedMs);
  if (!Number.isFinite(requested) || requested <= 0) {
    return fallbackMs;
  }
  return Math.min(requested, CENTRAL_TOKEN_MAX_TTL_MS);
}

function signUcanPayload(payload: CentralUcanPayload, privateKey: crypto.KeyObject): string {
  const header = { alg: 'EdDSA', typ: 'UCAN' };
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header), 'utf8'));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function ensureCentralIssuerState(): CentralIssuerState {
  if (!CENTRAL_ISSUER_ENABLED) {
    throw new Error('Central UCAN issuer disabled');
  }
  if (cachedState) return cachedState;
  const privateKey = CENTRAL_ISSUER_SEED
    ? createPrivateKeyFromSeed(decodeSeed(CENTRAL_ISSUER_SEED))
    : createPrivateKeyFromSeed(crypto.randomBytes(32));
  const did = didKeyFromPublicKey(extractRawPublicKey(privateKey));
  cachedState = { did, privateKey };
  return cachedState;
}

function nextSessionId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

export function isCentralIssuerEnabled(): boolean {
  return CENTRAL_ISSUER_ENABLED;
}

export function getCentralIssuerDid(): string | null {
  if (!CENTRAL_ISSUER_ENABLED) return null;
  return ensureCentralIssuerState().did;
}

export function getTrustedCentralIssuerDid(): string | null {
  if (CENTRAL_TRUSTED_DID) return CENTRAL_TRUSTED_DID;
  return getCentralIssuerDid();
}

export function issueCentralSessionToken(
  subject: string,
  ttlMs?: number
): { token: string; expiresAt: number } {
  if (!CENTRAL_ISSUER_ENABLED) {
    throw new Error('Central UCAN issuer disabled');
  }
  const normalizedSubject = String(subject || '').trim();
  if (!normalizedSubject) {
    throw new Error('Missing central session subject');
  }
  const effectiveTtlMs = clampTtl(ttlMs, CENTRAL_SESSION_TTL_MS);
  const expiresAt = Date.now() + effectiveTtlMs;
  const token = jwt.sign(
    {
      typ: 'central_session',
      sub: normalizedSubject,
      sid: nextSessionId(),
    },
    CENTRAL_SESSION_SECRET,
    {
      expiresIn: Math.max(1, Math.floor(effectiveTtlMs / 1000)),
    }
  );
  return { token, expiresAt };
}

export function verifyCentralSessionToken(token: string): CentralSessionPayload | null {
  try {
    const payload = jwt.verify(token, CENTRAL_SESSION_SECRET) as JwtPayload & {
      typ?: string;
      sub?: string;
      sid?: string;
    };
    if (payload.typ !== 'central_session' || typeof payload.sub !== 'string') {
      return null;
    }
    const subject = payload.sub.trim();
    if (!subject) return null;
    return {
      subject,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
    };
  } catch {
    return null;
  }
}

export function issueCentralUcanToken(
  options: IssueCentralUcanOptions
): { token: string; payload: CentralUcanPayload } {
  const state = ensureCentralIssuerState();
  const subject = String(options.subject || '').trim();
  const audience = String(options.audience || '').trim();
  const capabilities = normalizeCapabilities(options.capabilities || []);
  if (!subject) {
    throw new Error('Missing UCAN subject');
  }
  if (!audience) {
    throw new Error('Missing UCAN audience');
  }
  if (!capabilities.length) {
    throw new Error('Missing UCAN capabilities');
  }

  const now = Date.now();
  const effectiveTtlMs = clampTtl(options.expiresInMs, CENTRAL_TOKEN_TTL_MS);
  const exp = now + effectiveTtlMs;
  const nbfCandidate = Number(options.notBeforeMs);
  const nbf = Number.isFinite(nbfCandidate) ? Math.floor(nbfCandidate) : now;
  const payload: CentralUcanPayload = {
    iss: state.did,
    sub: subject,
    aud: audience,
    cap: capabilities,
    exp,
    nbf,
    iat: now,
  };
  const token = signUcanPayload(payload, state.privateKey);
  return { token, payload };
}
