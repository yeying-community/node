import { randomBytes, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { SiweMessage } from 'siwe';
import { getAddress } from 'ethers';
import { getConfig } from '../config/runtime';
import { getDerivedRuntimeSecret } from '../security/secretVault';

export type ChallengeRecord = {
  address: string;
  challenge: string;
  nonce: string;
  domain: string;
  uri: string;
  version: '1';
  chainId: number;
  issuedAt: number;
  expiresAt: number;
};

export type TokenBundle = {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
};

export type AccessTokenPayload = {
  address: string;
  typ: 'access';
  sid?: string;
  exp?: number;
};

type RefreshSession = {
  address: string;
  refreshId: string;
  expiresAt: number;
};

const MIN_DERIVED_SECRET_LENGTH = 32;

function resolveJwtSecret(): string {
  const raw = getDerivedRuntimeSecret('jwt-signing');
  if (!raw) {
    throw new Error(
      'NODE_KEY_DERIVATION_SECRET is not configured in secrets.enc.json.'
    );
  }
  if (raw.length < MIN_DERIVED_SECRET_LENGTH) {
    throw new Error(
      `Derived JWT secret is too short. Use at least ${MIN_DERIVED_SECRET_LENGTH} characters.`
    );
  }
  return raw;
}

let jwtSigningSecretCache = '';

function getJwtSecret(): string {
  if (!jwtSigningSecretCache) {
    jwtSigningSecretCache = resolveJwtSecret();
  }
  return jwtSigningSecretCache;
}

export function assertJwtSecretReady(): void {
  getJwtSecret();
}
const ACCESS_TTL_MS = parseNumber(
  getConfig<number>('auth.accessTtlMs'),
  15 * 60 * 1000
);
const REFRESH_TTL_MS = parseNumber(
  getConfig<number>('auth.refreshTtlMs'),
  7 * 24 * 60 * 60 * 1000
);
const CHALLENGE_TTL_MS = parseNumber(
  getConfig<number>('auth.challengeTtlMs'),
  5 * 60 * 1000
);
const DEFAULT_CHAIN_ID = parseNumber(
  getConfig<number>('auth.chainId'),
  1
);

const challenges = new Map<string, ChallengeRecord>();
const refreshStore = new Map<string, { address: string; expiresAt: number }>();

function parseNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function now(): number {
  return Date.now();
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function createChallengeMessage(input: {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}): string {
  return new SiweMessage({
    domain: input.domain,
    address: getAddress(input.address),
    statement: 'Sign in to YeYing Node.',
    uri: input.uri,
    version: '1',
    chainId: input.chainId,
    nonce: input.nonce,
    issuedAt: new Date(input.issuedAt).toISOString(),
    expirationTime: new Date(input.expiresAt).toISOString(),
  }).prepareMessage();
}

function normalizeDomain(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return 'localhost';
  return raw.replace(/^https?:\/\//i, '').split('/')[0] || 'localhost';
}

function normalizeUri(value: unknown, domain: string): string {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `https://${domain}`;
}

export function issueChallenge(
  address: string,
  context: { domain?: string; uri?: string; chainId?: number } = {}
): ChallengeRecord {
  const normalized = normalizeAddress(address);
  const domain = normalizeDomain(context.domain);
  const uri = normalizeUri(context.uri, domain);
  const chainId = parseNumber(context.chainId, DEFAULT_CHAIN_ID);
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = now();
  const expiresAt = issuedAt + CHALLENGE_TTL_MS;
  const challenge = createChallengeMessage({
    domain,
    address: normalized,
    uri,
    chainId,
    nonce,
    issuedAt,
    expiresAt,
  });
  const record: ChallengeRecord = {
    address: normalized,
    challenge,
    nonce,
    domain,
    uri,
    version: '1',
    chainId,
    issuedAt,
    expiresAt,
  };
  challenges.set(nonce, record);
  return record;
}

export function getChallenge(nonce: string): ChallengeRecord | null {
  return challenges.get(String(nonce || '').trim()) || null;
}

export function deleteChallenge(nonce: string): void {
  challenges.delete(String(nonce || '').trim());
}

export async function verifyChallengeSignature(
  challenge: string,
  signature: string,
  expected: { address: string; domain: string; uri: string; nonce: string; chainId: number }
): Promise<boolean> {
  try {
    const message = new SiweMessage(challenge);
    const result = await message.verify({
      signature,
      domain: expected.domain,
      nonce: expected.nonce,
      time: new Date().toISOString(),
    });
    return Boolean(result.success) &&
      normalizeAddress(message.address) === normalizeAddress(expected.address) &&
      message.uri === expected.uri && Number(message.chainId) === expected.chainId;
  } catch {
    return false;
  }
}

function signAccessToken(address: string, sessionId: string): string {
  return jwt.sign(
    { address, typ: 'access', sid: sessionId },
    getJwtSecret(),
    { expiresIn: Math.floor(ACCESS_TTL_MS / 1000) }
  );
}

function signRefreshToken(address: string, refreshId: string): string {
  return jwt.sign(
    { address, typ: 'refresh', jti: refreshId },
    getJwtSecret(),
    { expiresIn: Math.floor(REFRESH_TTL_MS / 1000) }
  );
}

function nextRefreshId(): string {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  return randomBytes(16).toString('hex');
}

export function issueTokens(address: string): TokenBundle {
  const normalized = normalizeAddress(address);
  const refreshId = nextRefreshId();
  const refreshExpiresAt = now() + REFRESH_TTL_MS;

  refreshStore.set(refreshId, {
    address: normalized,
    expiresAt: refreshExpiresAt,
  });

  const refreshToken = signRefreshToken(normalized, refreshId);
  const accessToken = signAccessToken(normalized, refreshId);
  const accessExpiresAt = now() + ACCESS_TTL_MS;

  return {
    accessToken,
    accessExpiresAt,
    refreshToken,
    refreshExpiresAt,
  };
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload & {
      address?: string;
      typ?: string;
      sid?: string;
    };
    if (payload.typ !== 'access' || typeof payload.address !== 'string') {
      return null;
    }
    return {
      address: payload.address,
      typ: 'access',
      sid: payload.sid,
      exp: typeof payload.exp === 'number' ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}

export function consumeRefreshToken(refreshToken: string): RefreshSession | null {
  let payload: JwtPayload & { address?: string; typ?: string; jti?: string };
  try {
    payload = jwt.verify(refreshToken, getJwtSecret()) as JwtPayload & {
      address?: string;
      typ?: string;
      jti?: string;
    };
  } catch {
    return null;
  }

  if (payload.typ !== 'refresh' || typeof payload.jti !== 'string' || typeof payload.address !== 'string') {
    return null;
  }

  const record = refreshStore.get(payload.jti);
  if (!record || record.address !== normalizeAddress(payload.address) || now() > record.expiresAt) {
    refreshStore.delete(payload.jti);
    return null;
  }

  refreshStore.delete(payload.jti);
  return {
    address: record.address,
    refreshId: payload.jti,
    expiresAt: record.expiresAt,
  };
}

export function revokeRefreshToken(refreshToken: string): void {
  try {
    const payload = jwt.verify(refreshToken, getJwtSecret()) as JwtPayload & { jti?: string };
    if (payload?.jti) {
      refreshStore.delete(payload.jti);
    }
  } catch {
    // ignore invalid tokens
  }
}
