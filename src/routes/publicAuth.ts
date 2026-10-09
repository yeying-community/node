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
import { provisionUserState } from '../common/permission';
import { getConfig } from '../config/runtime';
import { IdentityEmailAuthService } from '../domain/service/identityEmailAuth';

const BASE_PATH = '/api/v1/public/auth';
const REFRESH_COOKIE_NAME =
  process.env.AUTH_REFRESH_COOKIE_NAME ||
  getConfig<string>('auth.refreshCookieName') ||
  'refresh_token';

function parseSameSite(value?: string): CookieOptions['sameSite'] {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'lax' || normalized === 'strict' || normalized === 'none') {
    return normalized;
  }
  return undefined;
}

function buildRefreshCookieOptions(maxAgeMs: number): CookieOptions {
  const sameSite =
    parseSameSite(process.env.COOKIE_SAMESITE ?? getConfig<string>('auth.cookieSameSite')) ?? 'lax';
  const secure =
    process.env.COOKIE_SECURE !== undefined
      ? String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true'
      : Boolean(getConfig<boolean>('auth.cookieSecure'));
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

function emailErrorStatus(message: string) {
  if (message.includes('NOT_FOUND') || message.includes('ACCOUNT_NOT_FOUND')) return 404
  if (message.includes('ALREADY_REGISTERED') || message.includes('ALREADY_ACTIVE') || message.includes('USERNAME_TAKEN')) return 409
  if (message.includes('EXPIRED')) return 410
  if (message.includes('INVALID') || message.includes('REQUIRED') || message.includes('NOT_ACTIVE') || message.includes('RESERVATION')) return 400
  return 503
}

export function registerPublicAuthRoutes(app: Express, emailAuth?: IdentityEmailAuthService) {
  const requireEmailAuth = () => {
    if (!emailAuth) throw new Error('IDENTITY_EMAIL_AUTH_UNAVAILABLE')
    return emailAuth
  }

  app.post(`${BASE_PATH}/email/register/request`, async (req: Request, res: Response) => {
    try { res.json(ok(await requireEmailAuth().requestRegister({ email: req.body?.email, username: req.body?.username, avatar: req.body?.avatar ?? req.body?.avatarUri, identityDocument: req.body?.identityDocument, deviceName: req.body?.deviceName }))) }
    catch (error) { const message = error instanceof Error ? error.message : 'Email registration request failed'; res.status(emailErrorStatus(message)).json(fail(emailErrorStatus(message), message)) }
  })
  app.post(`${BASE_PATH}/email/register/confirm`, async (req: Request, res: Response) => {
    try { res.json(ok(await requireEmailAuth().confirmRegister({ verificationId: req.body?.verificationId, code: req.body?.code }))) }
    catch (error) { const message = error instanceof Error ? error.message : 'Email registration verification failed'; res.status(emailErrorStatus(message)).json(fail(emailErrorStatus(message), message)) }
  })
  app.post(`${BASE_PATH}/email/register/complete`, async (req: Request, res: Response) => {
    try {
      const result = await requireEmailAuth().completeRegister({ verificationId: req.body?.verificationId, registrationId: req.body?.registrationId, accountLink: req.body?.accountLink, custody: req.body?.custody })
      await provisionUserState(result.identity)
      const tokens = issueTokens(result.identity)
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt - Date.now())
      res.json(ok({ identity: result.identity, address: result.identity, token: tokens.accessToken, expiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt, credentials: result.credentials }))
    } catch (error) { const message = error instanceof Error ? error.message : 'Email registration completion failed'; res.status(emailErrorStatus(message)).json(fail(emailErrorStatus(message), message)) }
  })
  app.post(`${BASE_PATH}/email/login/request`, async (req: Request, res: Response) => {
    try { res.json(ok(await requireEmailAuth().requestLogin({ email: req.body?.email }))) }
    catch (error) { const message = error instanceof Error ? error.message : 'Email login request failed'; res.status(emailErrorStatus(message)).json(fail(emailErrorStatus(message), message)) }
  })
  app.post(`${BASE_PATH}/email/login/confirm`, async (req: Request, res: Response) => {
    try {
      const result = await requireEmailAuth().confirmLogin({ verificationId: req.body?.verificationId, code: req.body?.code })
      await provisionUserState(result.identity)
      const tokens = issueTokens(result.identity)
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt - Date.now())
      res.json(ok({ identity: result.identity, address: result.identity, token: tokens.accessToken, expiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt }))
    } catch (error) { const message = error instanceof Error ? error.message : 'Email login verification failed'; res.status(emailErrorStatus(message)).json(fail(emailErrorStatus(message), message)) }
  })

  app.post(`${BASE_PATH}/challenge`, (req: Request, res: Response) => {
    const address = req.body?.address;
    if (!address || typeof address !== 'string') {
      res.status(400).json(fail(400, 'Missing address'));
      return;
    }

    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
    const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
      .split(',')[0]
      .trim();
    const origin = String(req.headers.origin || '').trim();
    const chainId = Number(req.body?.chainId || 0);
    const challenge = issueChallenge(address, {
      domain: host,
      uri: origin || (host ? `${protocol}://${host}` : undefined),
      chainId: Number.isFinite(chainId) && chainId > 0 ? chainId : undefined,
    });
    res.json(ok(challenge));
  });

  app.post(`${BASE_PATH}/verify`, async (req: Request, res: Response) => {
    try {
      const address = req.body?.address;
      const signature = req.body?.signature;
      const nonce = req.body?.nonce;
      if (!address || typeof address !== 'string' || !signature || typeof signature !== 'string' || !nonce || typeof nonce !== 'string') {
        res.status(400).json(fail(400, 'Missing address, nonce or signature'));
        return;
      }

      const record = getChallenge(nonce);
      if (!record) {
        res.status(400).json(fail(400, 'Challenge expired'));
        return;
      }

      if (Date.now() > record.expiresAt) {
        deleteChallenge(record.nonce);
        res.status(400).json(fail(400, 'Challenge expired'));
        return;
      }

      const valid = await verifyChallengeSignature(record.challenge, signature, record);
      if (!valid) {
        res.status(401).json(fail(401, 'Invalid signature'));
        return;
      }

      deleteChallenge(record.nonce);
      await provisionUserState(record.address);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verify failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.post(`${BASE_PATH}/refresh`, async (req: Request, res: Response) => {
    try {
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

      await provisionUserState(session.address);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refresh failed';
      res.status(500).json(fail(500, message));
    }
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
