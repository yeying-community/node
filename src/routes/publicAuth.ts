import { CookieOptions, Express, Request, Response } from 'express';
import { fail, ok } from '../auth/envelope';
import {
  consumeRefreshToken,
  deleteChallenge,
  getChallenge,
  issueChallenge,
  issueTokens,
  revokeRefreshToken,
  verifyChallengeSignature,
} from '../auth/siwe';

const BASE_PATH = '/api/v1/public/auth';
const REFRESH_COOKIE_NAME = process.env.AUTH_REFRESH_COOKIE_NAME || 'refresh_token';

function parseSameSite(value?: string): CookieOptions['sameSite'] {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'lax' || normalized === 'strict' || normalized === 'none') {
    return normalized;
  }
  return undefined;
}

function buildRefreshCookieOptions(maxAgeMs: number): CookieOptions {
  const sameSite = parseSameSite(process.env.COOKIE_SAMESITE) ?? 'lax';
  const secure = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: BASE_PATH,
    maxAge: Math.max(0, maxAgeMs),
  };
}

function setRefreshCookie(res: Response, token: string, maxAgeMs: number) {
  res.cookie(REFRESH_COOKIE_NAME, token, buildRefreshCookieOptions(maxAgeMs));
}

function clearRefreshCookie(res: Response) {
  res.cookie(REFRESH_COOKIE_NAME, '', buildRefreshCookieOptions(0));
}

function parseCookies(cookieHeader = ''): Record<string, string> {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {} as Record<string, string>);
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers?.cookie || '';
  const cookies = parseCookies(header);
  return cookies[name];
}

export function registerPublicAuthRoutes(app: Express) {
  app.post(`${BASE_PATH}/challenge`, (req: Request, res: Response) => {
    const address = req.body?.address;
    if (!address || typeof address !== 'string') {
      res.status(400).json(fail(400, 'Missing address'));
      return;
    }

    const challenge = issueChallenge(address);
    res.json(ok(challenge));
  });

  app.post(`${BASE_PATH}/verify`, (req: Request, res: Response) => {
    const address = req.body?.address;
    const signature = req.body?.signature;
    if (!address || typeof address !== 'string' || !signature || typeof signature !== 'string') {
      res.status(400).json(fail(400, 'Missing address or signature'));
      return;
    }

    const record = getChallenge(address);
    if (!record) {
      res.status(400).json(fail(400, 'Challenge expired'));
      return;
    }

    if (Date.now() > record.expiresAt) {
      deleteChallenge(record.address);
      res.status(400).json(fail(400, 'Challenge expired'));
      return;
    }

    const valid = verifyChallengeSignature(record.challenge, signature, record.address);
    if (!valid) {
      res.status(401).json(fail(401, 'Invalid signature'));
      return;
    }

    deleteChallenge(record.address);
    const tokens = issueTokens(record.address);
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt - Date.now());
    res.json(
      ok({
        address: record.address,
        token: tokens.accessToken,
        expiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
      })
    );
  });

  app.post(`${BASE_PATH}/refresh`, (req: Request, res: Response) => {
    const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      res.status(401).json(fail(401, 'Missing refresh token'));
      return;
    }

    const session = consumeRefreshToken(refreshToken);
    if (!session) {
      clearRefreshCookie(res);
      res.status(401).json(fail(401, 'Invalid refresh token'));
      return;
    }

    const tokens = issueTokens(session.address);
    setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt - Date.now());
    res.json(
      ok({
        address: session.address,
        token: tokens.accessToken,
        expiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
      })
    );
  });

  app.post(`${BASE_PATH}/logout`, (req: Request, res: Response) => {
    const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
    if (refreshToken) {
      revokeRefreshToken(refreshToken);
    }
    clearRefreshCookie(res);
    res.json(ok({ logout: true }));
  });
}
