import * as crypto from 'crypto';
import { verifyMessage } from 'ethers';

export type UcanCapability = {
  resource: string;
  action: string;
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

type UcanTokenPayload = {
  iss?: string;
  aud?: string;
  cap?: UcanCapability[];
  exp?: number;
  nbf?: number;
  prf?: UcanProof[];
};

const DEFAULT_PORT = Number(process.env.APP_PORT || 8001);
const UCAN_AUD = process.env.UCAN_AUD || `did:web:localhost:${DEFAULT_PORT}`;
const UCAN_RESOURCE = process.env.UCAN_RESOURCE || 'profile';
const UCAN_ACTION = process.env.UCAN_ACTION || 'read';
const REQUIRED_UCAN_CAP: UcanCapability = { resource: UCAN_RESOURCE, action: UCAN_ACTION };

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

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return pattern === value;
}

function capsAllow(available: UcanCapability[] | undefined, required: UcanCapability[]): boolean {
  if (!Array.isArray(available) || available.length === 0) return false;
  return required.every(req =>
    available.some(cap =>
      cap &&
      typeof cap.resource === 'string' &&
      typeof cap.action === 'string' &&
      matchPattern(cap.resource, req.resource) &&
      matchPattern(cap.action, req.action)
    )
  );
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

  if (root.aud && root.aud !== aud) {
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
    if (payload.aud !== currentDid) {
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
  if (root.aud !== currentDid) {
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

export function verifyUcanInvocation(token: string): { address: string; issuer: string } {
  const { payload, exp } = verifyUcanJws(token);
  if (!payload.iss || !payload.aud) {
    throw new Error('Invalid UCAN token');
  }
  if (payload.aud !== UCAN_AUD) {
    throw new Error('UCAN audience mismatch');
  }
  if (!capsAllow(payload.cap || [], [REQUIRED_UCAN_CAP])) {
    throw new Error('UCAN capability denied');
  }
  const root = verifyProofChain(payload.iss, payload.cap || [], exp, payload.prf || []);
  const address = root.iss.replace(/^did:pkh:eth:/, '');
  return { address, issuer: payload.iss };
}
