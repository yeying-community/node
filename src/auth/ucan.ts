import * as crypto from 'crypto';
import { verifyMessage } from 'ethers';
import { isCentralUcanTokenRevoked } from './ucanIssuer';
import { getConfig } from '../config/runtime';
import { getNodeUcanIssuerKeys } from '../security/nodeIssuer';
import { capabilitiesCover, type UcanCapability } from './ucanPolicy';

export type { UcanCapability } from './ucanPolicy';

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
  jti?: string;
  exp?: number;
  nbf?: number;
  prf?: UcanProof[];
};

const DEFAULT_PORT = parseNumber(
  getConfig<number>('app.port'),
  8100
);
const UCAN_AUD =
  getConfig<string>('ucan.aud') ||
  `did:web:localhost:${DEFAULT_PORT}`;
const UCAN_WITH =
  getConfig<string>('ucan.with') ||
  'app:all:localhost-*';
const UCAN_CAN =
  getConfig<string>('ucan.can') ||
  'invoke';
const REQUIRED_UCAN_CAP: UcanCapability = {
  with: UCAN_WITH,
  can: UCAN_CAN
};
const UCAN_ISSUER_ENABLED = parseBoolean(
  getConfig<boolean>('issuer.ucan.enabled'),
  false
);
const UCAN_ISSUER_MODE = parseIssuerMode(
  getConfig<string>('issuer.ucan.mode')
);
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

function isEquivalentAudience(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  return left.trim().replace(/127\.0\.0\.1/g, 'localhost') ===
    right.trim().replace(/127\.0\.0\.1/g, 'localhost');
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

async function verifyUcanJws(
  token: string
): Promise<{ header: any; payload: UcanTokenPayload; exp: number; nbf?: number }> {
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
  const exp = normalizeEpochMillis(decoded.payload.exp ?? undefined);
  if (exp === null || !Number.isFinite(exp) || exp <= 0) {
    throw new Error('UCAN expiry required');
  }
  const nbf = normalizeEpochMillis(decoded.payload.nbf ?? undefined) ?? undefined;
  const nowMs = Date.now();
  if (nbf && nowMs < nbf) {
    throw new Error('UCAN not active');
  }
  if (nowMs > exp) {
    throw new Error('UCAN expired');
  }
  const issuerDid = typeof decoded.payload?.iss === 'string'
    ? decoded.payload.iss.trim()
    : '';
  const tokenId = typeof decoded.payload?.jti === 'string'
    ? decoded.payload.jti.trim()
    : '';
  const trustedCentralIssuer = isTrustedCentralIssuerDid(issuerDid);
  if (trustedCentralIssuer && !tokenId) {
    throw new Error('UCAN token id required');
  }
  if (
    tokenId &&
    trustedCentralIssuer &&
    (await isCentralUcanTokenRevoked(tokenId))
  ) {
    throw new Error('UCAN token revoked');
  }
  return { header: decoded.header, payload: decoded.payload, exp, nbf };
}

async function verifyProofChain(
  currentDid: string,
  requiredCap: UcanCapability[],
  requiredExp: number | undefined,
  proofs: UcanProof[]
): Promise<{ iss: string; aud: string; cap: UcanCapability[]; exp: number; nbf?: number }> {
  if (!Array.isArray(proofs) || proofs.length === 0) {
    throw new Error('Missing UCAN proof chain');
  }
  const [first, ...rest] = proofs;
  if (typeof first === 'string') {
    const { payload, exp } = await verifyUcanJws(first);
    if (!payload.iss || !payload.aud) {
      throw new Error('Invalid UCAN proof');
    }
    if (!isEquivalentAudience(payload.aud, currentDid)) {
      throw new Error('UCAN audience mismatch');
    }
    const proofExp = normalizeEpochMillis(payload.exp ?? undefined) ?? exp;
    if (!capabilitiesCover(payload.cap || [], requiredCap)) {
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
  if (!capabilitiesCover(root.cap || [], requiredCap)) {
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
  if (!did) {
    return false;
  }
  try {
    return getNodeUcanIssuerKeys().some(key => key.did === did);
  } catch {
    return false;
  }
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

export function verifyUcanInvocation(token: string): Promise<{
  address: string;
  issuer: string;
  source: UcanInvocationSource;
}> {
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
  jti?: string;
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
): Promise<{ address: string; issuer: string; source: UcanInvocationSource }> {
  if (!Array.isArray(requiredCap) || requiredCap.length === 0) {
    return verifyUcanInvocation(token);
  }
  return verifyUcanInvocationWithRequired(token, requiredCap);
}

function verifyUcanInvocationWithRequired(
  token: string,
  requiredCap: UcanCapability[]
): Promise<{ address: string; issuer: string; source: UcanInvocationSource }> {
  return verifyUcanInvocationWithRequiredAsync(token, requiredCap);
}

async function verifyUcanInvocationWithRequiredAsync(
  token: string,
  requiredCap: UcanCapability[]
): Promise<{ address: string; issuer: string; source: UcanInvocationSource }> {
  const { payload, exp } = await verifyUcanJws(token);
  if (!payload.iss || !payload.aud) {
    throw new Error('Invalid UCAN token');
  }
  if (!isEquivalentAudience(payload.aud, UCAN_AUD)) {
    throw new Error('UCAN audience mismatch');
  }
  if (!capabilitiesCover(payload.cap || [], requiredCap)) {
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
  const root = await verifyProofChain(payload.iss, payload.cap || [], exp, payload.prf || []);
  const address = normalizeSubject(root.iss.replace(/^did:pkh:eth:/, ''));
  return { address, issuer: payload.iss, source: 'wallet' };
}
