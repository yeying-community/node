import { randomBytes, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { verifyMessage } from 'ethers';
import { getConfig } from '../config/runtime';

export type ChallengeRecord = {
  address: string;
  challenge: string;
  nonce: string;
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

const JWT_SECRET =
  process.env.JWT_SECRET ||
  getConfig<string>('auth.jwtSecret') ||
  'replace-this-in-production';
const ACCESS_TTL_MS = parseNumber(
  process.env.ACCESS_TTL_MS ?? getConfig<number>('auth.accessTtlMs'),
  15 * 60 * 1000
);
const REFRESH_TTL_MS = parseNumber(
  process.env.REFRESH_TTL_MS ?? getConfig<number>('auth.refreshTtlMs'),
  7 * 24 * 60 * 60 * 1000
);
const CHALLENGE_TTL_MS = parseNumber(
  process.env.AUTH_CHALLENGE_TTL_MS ?? getConfig<number>('auth.challengeTtlMs'),
  5 * 60 * 1000
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

function createChallengeMessage(address: string, nonce: string, issuedAt: number, expiresAt: number): string {
  return [
    'Sign to login YeYing Wallet',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
    `Expires At: ${new Date(expiresAt).toISOString()}`,
  ].join('\n');
}

export function issueChallenge(address: string): ChallengeRecord {
  const normalized = normalizeAddress(address);
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = now();
  const expiresAt = issuedAt + CHALLENGE_TTL_MS;
  const challenge = createChallengeMessage(normalized, nonce, issuedAt, expiresAt);
  const record: ChallengeRecord = {
    address: normalized,
    challenge,
    nonce,
    issuedAt,
    expiresAt,
  };
  challenges.set(normalized, record);
  return record;
}

export function getChallenge(address: string): ChallengeRecord | null {
  const normalized = normalizeAddress(address);
  return challenges.get(normalized) || null;
}

export function deleteChallenge(address: string): void {
  const normalized = normalizeAddress(address);
  challenges.delete(normalized);
}

export function verifyChallengeSignature(
  challenge: string,
  signature: string,
  address: string
): boolean {
  try {
    const recovered = verifyMessage(challenge, signature);
    return normalizeAddress(recovered) === normalizeAddress(address);
  } catch {
    return false;
  }
}

function signAccessToken(address: string, sessionId: string): string {
  return jwt.sign(
    { address, typ: 'access', sid: sessionId },
    JWT_SECRET,
    { expiresIn: Math.floor(ACCESS_TTL_MS / 1000) }
  );
}

function signRefreshToken(address: string, refreshId: string): string {
  return jwt.sign(
    { address, typ: 'refresh', jti: refreshId },
    JWT_SECRET,
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
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload & {
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
    payload = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload & {
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
    const payload = jwt.verify(refreshToken, JWT_SECRET) as JwtPayload & { jti?: string };
    if (payload?.jti) {
      refreshStore.delete(payload.jti);
    }
  } catch {
    // ignore invalid tokens
  }
}
