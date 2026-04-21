import * as crypto from 'crypto';
import { verifyMessage } from 'ethers';
import { getConfig } from '../config/runtime';

export type UcanCapability = {
  with?: string;
  can?: string;
  resource?: string;
  action?: string;
  nb?: unknown;
};

export type UcanRootProof = {
  type: 'siwe';
  iss: string;
  aud: string;
  cap: UcanCapability[];
  exp: number;
  nbf?: number;
  siwe: {
    message: string;
    signature: string;
  };
};

export type UcanProof = UcanRootProof | string;

export type UcanInvocationSource = 'wallet' | 'central';

type UcanTokenPayload = {
  iss?: string;
  aud?: string;
  sub?: string;
  cap?: UcanCapability[];
  exp?: number;
  nbf?: number;
  prf?: UcanProof[];
};

const DEFAULT_PORT = parseNumber(
  process.env.APP_PORT ?? getConfig<number>('app.port'),
  8100
);
const UCAN_AUD =
  process.env.UCAN_AUD ||
  getConfig<string>('ucan.aud') ||
  `did:web:localhost:${DEFAULT_PORT}`;
const UCAN_WITH =
  process.env.UCAN_WITH ||
  getConfig<string>('ucan.with') ||
  'app:all:localhost-*';
const UCAN_CAN =
  process.env.UCAN_CAN ||
  getConfig<string>('ucan.can') ||
  'invoke';
const REQUIRED_UCAN_CAP: UcanCapability = {
  with: UCAN_WITH,
  can: UCAN_CAN
};
const UCAN_ISSUER_ENABLED = parseBoolean(
  process.env.UCAN_ISSUER_ENABLED ?? getConfig<boolean>('ucanIssuer.enabled'),
  false
);
const UCAN_ISSUER_MODE = parseIssuerMode(
  process.env.UCAN_ISSUER_MODE ?? getConfig<string>('ucanIssuer.mode')
);
const UCAN_ISSUER_DID = String(
  process.env.UCAN_ISSUER_DID ?? getConfig<string>('ucanIssuer.did') ?? ''
).trim();

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function decodeJsonSegment(segment: string): any {
  const decoded = base64UrlDecode(segment).toString('utf8');
  return JSON.parse(decoded);
}

function base58Decode(value: string): Buffer {
  let bytes: number[] = [0];
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Invalid base58 character');
    }
    let carry = index;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (zeros < value.length && value[zeros] === '1') zeros += 1;
  const output = Buffer.alloc(zeros + bytes.length);
  for (let i = 0; i < zeros; i += 1) output[i] = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    output[output.length - 1 - i] = bytes[i];
  }
  return output;
}

function parseNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
}

function parseIssuerMode(value: unknown): 'verify' | 'issue' | 'hybrid' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'verify' || normalized === 'issue' || normalized === 'hybrid') {
    return normalized;
  }
  return 'verify';
}

function didKeyToPublicKey(did: string): Buffer {
  if (!did || typeof did !== 'string' || !did.startsWith('did:key:z')) {
    throw new Error('Invalid did:key format');
  }
  const decoded = base58Decode(did.slice('did:key:z'.length));
  if (decoded.length < 3 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('Unsupported did:key type');
  }
  return decoded.slice(2);
}

function createEd25519PublicKey(raw: Buffer): crypto.KeyObject {
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([prefix, raw]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function normalizeEpochMillis(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  return value < 1e12 ? value * 1000 : value;
}

function normalizeActionExpression(raw: string): string {
  const normalized = String(raw || '').trim().toLowerCase().replace(/\|/g, ',');
  if (!normalized) return '';
  const items = normalized
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!items.length) return '';
  return Array.from(new Set(items)).join(',');
}

function normalizeLoopbackAlias(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/127\.0\.0\.1/g, 'localhost');
}

function isEquivalentAudience(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  return normalizeLoopbackAlias(left) === normalizeLoopbackAlias(right);
}

function getCapabilityResource(cap: UcanCapability | null | undefined): string {
  if (!cap || typeof cap !== 'object') return '';
  if (typeof cap.with === 'string' && cap.with.trim()) {
    return cap.with.trim();
  }
  if (typeof cap.resource === 'string' && cap.resource.trim()) {
    return cap.resource.trim();
  }
  return '';
}

function getCapabilityAction(cap: UcanCapability | null | undefined): string {
  if (!cap || typeof cap !== 'object') return '';
  if (typeof cap.can === 'string' && cap.can.trim()) {
    return normalizeActionExpression(cap.can);
  }
  if (typeof cap.action === 'string' && cap.action.trim()) {
    return normalizeActionExpression(cap.action);
  }
  return '';
}

function actionAllows(availableAction: string, requiredAction: string): boolean {
  if (requiredAction === '*') return true;
  if (availableAction === '*') return true;
  const available = normalizeActionExpression(availableAction);
  const required = normalizeActionExpression(requiredAction);
  if (!available || !required) return false;
  const availableSet = new Set(available.split(',').filter(Boolean));
  const requiredList = required.split(',').filter(Boolean);
  return requiredList.every(item => availableSet.has(item));
}

function matchPattern(pattern: string, value: string): boolean {
  const normalizedPattern = normalizeLoopbackAlias(pattern);
  const normalizedValue = normalizeLoopbackAlias(value);
  if (normalizedPattern === '*') return true;
  if (normalizedPattern.endsWith('*')) {
    return normalizedValue.startsWith(normalizedPattern.slice(0, -1));
  }
  return normalizedPattern === normalizedValue;
}

function resourceIntersects(availableResource: string, requiredResource: string): boolean {
  // Allow intersection semantics:
  // - token wildcard covers required concrete value
  // - required wildcard accepts token concrete value
  return (
    matchPattern(availableResource, requiredResource) ||
    matchPattern(requiredResource, availableResource)
  );
}

function capsAllow(available: UcanCapability[] | undefined, required: UcanCapability[]): boolean {
  if (!Array.isArray(available) || available.length === 0) return false;
  return required.every(req => {
    const reqResource = getCapabilityResource(req);
    const reqAction = getCapabilityAction(req);
    if (!reqResource || !reqAction) return false;
    return available.some(cap => {
      const capResource = getCapabilityResource(cap);
      const capAction = getCapabilityAction(cap);
      if (!capResource || !capAction) return false;
      return resourceIntersects(capResource, reqResource) && actionAllows(capAction, reqAction);
    });
  });
}

function extractUcanStatement(message: string): { aud?: string; cap?: UcanCapability[]; exp?: number; nbf?: number } | null {
  if (!message || typeof message !== 'string') return null;
  const lines = message.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('UCAN-AUTH')) {
      const jsonPart = trimmed.replace(/^UCAN-AUTH[:\\s]*/i, '');
      try {
        return JSON.parse(jsonPart);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function verifyRootProof(root: UcanRootProof): {
  iss: string;
  aud: string;
  cap: UcanCapability[];
  exp: number;
  nbf?: number;
} {
  if (!root || root.type !== 'siwe' || !root.siwe) {
    throw new Error('Invalid root proof');
  }
  const { message, signature } = root.siwe;
  if (!message || !signature) {
    throw new Error('Missing SIWE message');
  }
  const recovered = verifyMessage(message, signature).toLowerCase();
  const iss = `did:pkh:eth:${recovered}`;
  if (root.iss && root.iss !== iss) {
    throw new Error('Root issuer mismatch');
  }

  const statement = extractUcanStatement(message);
  if (!statement) {
    throw new Error('Missing UCAN statement');
  }

  const aud = statement.aud || root.aud;
  const cap = statement.cap || root.cap;
  const exp = normalizeEpochMillis(statement.exp ?? root.exp);
  const nbf = normalizeEpochMillis(statement.nbf ?? root.nbf);

  if (!aud || !Array.isArray(cap) || !exp) {
    throw new Error('Invalid root claims');
  }

  if (root.aud && !isEquivalentAudience(root.aud, aud)) {
    throw new Error('Root audience mismatch');
  }
  if (root.exp && normalizeEpochMillis(root.exp) !== exp) {
    throw new Error('Root expiry mismatch');
  }

  const nowMs = Date.now();
  if (nbf && nowMs < nbf) {
    throw new Error('Root not active');
  }
  if (nowMs > exp) {
    throw new Error('Root expired');
  }

  return { iss, aud, cap, exp, nbf: nbf ?? undefined };
}

function decodeUcanToken(token: string): {
  header: any;
  payload: UcanTokenPayload;
  signature: Buffer;
  signingInput: string;
} {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid UCAN token');
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]) as UcanTokenPayload;
  const signature = base64UrlDecode(parts[2]);
  return { header, payload, signature, signingInput: `${parts[0]}.${parts[1]}` };
}

function verifyUcanJws(token: string): { header: any; payload: UcanTokenPayload; exp?: number; nbf?: number } {
  const decoded = decodeUcanToken(token);
  if (decoded.header?.alg !== 'EdDSA') {
    throw new Error('Unsupported UCAN alg');
  }
  const rawKey = didKeyToPublicKey(decoded.payload?.iss || '');
  const publicKey = createEd25519PublicKey(rawKey);
  const ok = crypto.verify(null, Buffer.from(decoded.signingInput), publicKey, decoded.signature);
  if (!ok) {
    throw new Error('Invalid UCAN signature');
  }
  const exp = normalizeEpochMillis(decoded.payload.exp ?? undefined) ?? undefined;
  const nbf = normalizeEpochMillis(decoded.payload.nbf ?? undefined) ?? undefined;
  const nowMs = Date.now();
  if (nbf && nowMs < nbf) {
    throw new Error('UCAN not active');
  }
  if (exp && nowMs > exp) {
    throw new Error('UCAN expired');
  }
  return { header: decoded.header, payload: decoded.payload, exp, nbf };
}

function verifyProofChain(
  currentDid: string,
  requiredCap: UcanCapability[],
  requiredExp: number | undefined,
  proofs: UcanProof[]
): { iss: string; aud: string; cap: UcanCapability[]; exp: number; nbf?: number } {
  if (!Array.isArray(proofs) || proofs.length === 0) {
    throw new Error('Missing UCAN proof chain');
  }
  const [first, ...rest] = proofs;
  if (typeof first === 'string') {
    const { payload, exp } = verifyUcanJws(first);
    if (!payload.iss || !payload.aud) {
      throw new Error('Invalid UCAN proof');
    }
    if (!isEquivalentAudience(payload.aud, currentDid)) {
      throw new Error('UCAN audience mismatch');
    }
    const proofExp = normalizeEpochMillis(payload.exp ?? undefined) ?? exp;
    if (!capsAllow(payload.cap || [], requiredCap)) {
      throw new Error('UCAN capability denied');
    }
    if (proofExp && requiredExp && proofExp < requiredExp) {
      throw new Error('UCAN proof expired');
    }
    const nextProofs = Array.isArray(payload.prf) && payload.prf.length > 0 ? payload.prf : rest;
    return verifyProofChain(payload.iss, payload.cap || [], proofExp ?? requiredExp, nextProofs);
  }
  const root = verifyRootProof(first);
  if (!isEquivalentAudience(root.aud, currentDid)) {
    throw new Error('Root audience mismatch');
  }
  if (!capsAllow(root.cap || [], requiredCap)) {
    throw new Error('Root capability denied');
  }
  if (requiredExp && root.exp < requiredExp) {
    throw new Error('Root expired');
  }
  return root;
}

function isWalletVerificationEnabled(): boolean {
  if (!UCAN_ISSUER_ENABLED) {
    return true;
  }
  return UCAN_ISSUER_MODE === 'verify' || UCAN_ISSUER_MODE === 'hybrid';
}

function isCentralVerificationEnabled(): boolean {
  if (!UCAN_ISSUER_ENABLED) {
    return false;
  }
  return UCAN_ISSUER_MODE === 'issue' || UCAN_ISSUER_MODE === 'hybrid';
}

function isTrustedCentralIssuerDid(did: string): boolean {
  if (!did || !UCAN_ISSUER_DID) {
    return false;
  }
  return did === UCAN_ISSUER_DID;
}

function normalizeSubject(subject: string): string {
  const normalized = String(subject || '').trim();
  if (!normalized) return '';
  if (/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function isUcanToken(token: string): boolean {
  try {
    const [headerPart] = token.split('.');
    if (!headerPart) return false;
    const header = decodeJsonSegment(headerPart);
    return header?.typ === 'UCAN' || header?.alg === 'EdDSA';
  } catch {
    return false;
  }
}

export function verifyUcanInvocation(token: string): {
  address: string;
  issuer: string;
  source: UcanInvocationSource;
} {
  return verifyUcanInvocationWithRequired(token, [REQUIRED_UCAN_CAP]);
}

export function getRequiredUcanCapability(): UcanCapability {
  return { ...REQUIRED_UCAN_CAP };
}

export function getRequiredUcanAudience(): string {
  return UCAN_AUD;
}

export function peekUcanTokenPayload(
  token: string
): {
  iss?: string;
  aud?: string;
  sub?: string;
  cap?: UcanCapability[];
  exp?: number;
  nbf?: number;
} | null {
  try {
    const decoded = decodeUcanToken(token);
    return decoded.payload;
  } catch {
    return null;
  }
}

export function verifyUcanInvocationWithCap(
  token: string,
  requiredCap: UcanCapability[]
): { address: string; issuer: string; source: UcanInvocationSource } {
  if (!Array.isArray(requiredCap) || requiredCap.length === 0) {
    return verifyUcanInvocation(token);
  }
  return verifyUcanInvocationWithRequired(token, requiredCap);
}

function verifyUcanInvocationWithRequired(
  token: string,
  requiredCap: UcanCapability[]
): { address: string; issuer: string; source: UcanInvocationSource } {
  const { payload, exp } = verifyUcanJws(token);
  if (!payload.iss || !payload.aud) {
    throw new Error('Invalid UCAN token');
  }
  if (!isEquivalentAudience(payload.aud, UCAN_AUD)) {
    throw new Error('UCAN audience mismatch');
  }
  if (!capsAllow(payload.cap || [], requiredCap)) {
    throw new Error('UCAN capability denied');
  }
  if (isTrustedCentralIssuerDid(payload.iss)) {
    if (!isCentralVerificationEnabled()) {
      throw new Error('UCAN issuer mode denied');
    }
    const address = normalizeSubject(payload.sub || '');
    if (!address) {
      throw new Error('Invalid UCAN subject');
    }
    return { address, issuer: payload.iss, source: 'central' };
  }
  if (!isWalletVerificationEnabled()) {
    throw new Error('UCAN wallet mode denied');
  }
  const root = verifyProofChain(payload.iss, payload.cap || [], exp, payload.prf || []);
  const address = root.iss.replace(/^did:pkh:eth:/, '');
  return { address, issuer: payload.iss, source: 'wallet' };
}
