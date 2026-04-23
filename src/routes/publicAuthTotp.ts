import { Express, Request, Response } from 'express';
import {
  createTotpBindRequest,
  consumeTotpBindRequest,
  getTotpAuthStatus,
  getTotpBindRequest,
  getTotpProvision,
  TotpAuthError,
} from '../auth/totpAuth';
import {
  createTotpAuthorizeCode,
  createTotpAuthorizeRequest,
  consumeTotpAuthorizeRequest,
  exchangeTotpAuthorizeCode,
  getTotpAuthorizeRequest,
} from '../auth/totpAuthorize';
import {
  createCentralIssueSession,
  getCentralIssuerStatus,
  issueCentralUcanBySession,
  type UcanCapability,
} from '../auth/ucanIssuer';
import { verifyUcanInvocation } from '../auth/ucan';
import { fail, ok } from '../auth/envelope';
import { issueTokens, verifyAccessToken } from '../auth/siwe';
import { provisionUserState } from '../common/permission';

const BASE_PATH = '/api/v1/public/auth/totp';
const RATE_LIMIT_STORE = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_GC_INTERVAL_MS = 5 * 60 * 1000;
let nextRateLimitGcAt = 0;

function parseBearerToken(req: Request): string {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader) return '';
  const [scheme, value] = authHeader.split(' ');
  if (scheme?.toLowerCase() === 'bearer') {
    return String(value || '').trim();
  }
  return authHeader;
}

function normalizeSubject(input: unknown): string {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return value.toLowerCase();
  }
  return value;
}

function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseCapabilities(raw: unknown): UcanCapability[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const items: UcanCapability[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    const withValue =
      (typeof source.with === 'string' && source.with.trim()) ||
      (typeof source.resource === 'string' && source.resource.trim()) ||
      '';
    const canValue =
      (typeof source.can === 'string' && source.can.trim()) ||
      (typeof source.action === 'string' && source.action.trim()) ||
      '';
    if (!withValue || !canValue) continue;
    items.push({ with: withValue, can: canValue });
  }
  return items.length > 0 ? items : undefined;
}

function mapIssuerError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : 'UCAN issuer request failed';
  if (message.includes('Invalid or expired session token')) {
    return { status: 401, message };
  }
  if (message.includes('disabled') || message.includes('mode does not allow issue')) {
    return { status: 403, message };
  }
  if (message.includes('not ready')) {
    return { status: 503, message };
  }
  if (message.includes('Missing')) {
    return { status: 400, message };
  }
  return { status: 500, message };
}

function mapTotpError(error: unknown): { status: number; message: string } {
  if (error instanceof TotpAuthError) {
    return { status: error.status, message: error.message };
  }
  return { status: 500, message: error instanceof Error ? error.message : 'TOTP auth failed' };
}

function resolveBearerSubject(
  rawToken: string
): { subject: string; authType: 'jwt' | 'ucan' } {
  const token = String(rawToken || '').trim();
  if (!token) {
    throw new TotpAuthError(401, 'TOTP_AUTH_TOKEN_MISSING', 'Missing access token');
  }

  const jwtPayload = verifyAccessToken(token);
  if (jwtPayload) {
    const subject = normalizeSubject(jwtPayload.address);
    if (!subject) {
      throw new TotpAuthError(401, 'TOTP_AUTH_TOKEN_INVALID', 'Invalid access token subject');
    }
    return { subject, authType: 'jwt' };
  }

  try {
    const ucan = verifyUcanInvocation(token);
    const subject = normalizeSubject(ucan.address);
    if (!subject) {
      throw new TotpAuthError(401, 'TOTP_AUTH_TOKEN_INVALID', 'Invalid access token subject');
    }
    return { subject, authType: 'ucan' };
  } catch {
    throw new TotpAuthError(401, 'TOTP_AUTH_TOKEN_INVALID', 'Invalid or expired access token');
  }
}

function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0] || '').trim();
  }
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function cleanupRateLimitStore(nowMs = Date.now()): void {
  if (RATE_LIMIT_STORE.size === 0) {
    nextRateLimitGcAt = nowMs + RATE_LIMIT_GC_INTERVAL_MS;
    return;
  }
  for (const [key, record] of RATE_LIMIT_STORE.entries()) {
    if (record.resetAt <= nowMs) {
      RATE_LIMIT_STORE.delete(key);
    }
  }
  nextRateLimitGcAt = nowMs + RATE_LIMIT_GC_INTERVAL_MS;
}

function consumeRateLimit(key: string, windowMs: number, max: number): boolean {
  const nowMs = Date.now();
  if (nextRateLimitGcAt === 0 || nowMs >= nextRateLimitGcAt) {
    cleanupRateLimitStore(nowMs);
  }
  const current = RATE_LIMIT_STORE.get(key);
  if (!current || current.resetAt <= nowMs) {
    RATE_LIMIT_STORE.set(key, { count: 1, resetAt: nowMs + windowMs });
    return true;
  }
  if (current.count >= max) {
    return false;
  }
  current.count += 1;
  RATE_LIMIT_STORE.set(key, current);
  return true;
}

function requireRateLimit(
  req: Request,
  res: Response,
  input: {
    bucket: string;
    key: string;
    windowMs: number;
    max: number;
    message: string;
    globalMax?: number;
  }
): boolean {
  const ip = resolveClientIp(req);
  const globalKey = `${input.bucket}:${ip}:*`;
  const globalMax = Number.isFinite(input.globalMax) && (input.globalMax as number) > 0
    ? Math.trunc(input.globalMax as number)
    : input.max;
  if (!consumeRateLimit(globalKey, input.windowMs, globalMax)) {
    res.status(429).json(fail(429, input.message));
    return false;
  }
  const normalizedKey = String(input.key || '').trim() || '-';
  const mergedKey = `${input.bucket}:${ip}:${normalizedKey}`;
  if (consumeRateLimit(mergedKey, input.windowMs, input.max)) {
    return true;
  }
  res.status(429).json(fail(429, input.message));
  return false;
}

export function registerPublicAuthTotpRoutes(app: Express) {
  app.get(`${BASE_PATH}/status`, (_req: Request, res: Response) => {
    res.json(ok(getTotpAuthStatus()));
  });

  app.get(`${BASE_PATH}/totp/provision`, async (req: Request, res: Response) => {
    try {
      const accessToken = parseBearerToken(req);
      const auth = resolveBearerSubject(accessToken);
      const subject = auth.subject;
      if (
        !requireRateLimit(req, res, {
          bucket: 'totp-provision',
          key: subject,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many provision requests, please try again later',
        })
      ) {
        return;
      }
      const provision = await getTotpProvision(subject);
      res.json(ok(provision));
    } catch (error) {
      const mapped = mapTotpError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.post(`${BASE_PATH}/bind/request`, (req: Request, res: Response) => {
    try {
      const accessToken = parseBearerToken(req);
      const auth = resolveBearerSubject(accessToken);
      const subject = auth.subject;
      if (!subject) {
        res.status(400).json(fail(400, 'Missing subject'));
        return;
      }
      if (
        !requireRateLimit(req, res, {
          bucket: 'totp-bind-request',
          key: subject,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many bind requests, please try again later',
        })
      ) {
        return;
      }
      const issuerStatus = getCentralIssuerStatus();
      const audience =
        (typeof req.body?.audience === 'string' && req.body.audience.trim()) ||
        issuerStatus.defaultAudience;
      const capabilities = parseCapabilities(req.body?.capabilities) || issuerStatus.defaultCapabilities;

      const result = createTotpBindRequest({
        subject,
        audience,
        capabilities,
        appName: typeof req.body?.appName === 'string' ? req.body.appName : undefined,
        redirectUri: typeof req.body?.redirectUri === 'string' ? req.body.redirectUri : undefined,
        requestTtlMs: parseOptionalPositiveNumber(req.body?.requestTtlMs),
        sessionTtlMs: parseOptionalPositiveNumber(req.body?.sessionTtlMs),
        tokenTtlMs: parseOptionalPositiveNumber(req.body?.tokenTtlMs ?? req.body?.expiresInMs),
      });

      res.json(ok(result));
    } catch (error) {
      const mapped = mapTotpError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.get(`${BASE_PATH}/bind/request/:requestId`, (req: Request, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim();
      const result = getTotpBindRequest(requestId);
      if (!result) {
        res.status(404).json(fail(404, 'totp bind request not found'));
        return;
      }
      res.json(ok(result));
    } catch (error) {
      const mapped = mapTotpError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.post(`${BASE_PATH}/bind/approve`, async (req: Request, res: Response) => {
    try {
      const requestId = String(req.body?.requestId || '').trim();
      const code = String(req.body?.code || '').trim();
      if (!requestId || !code) {
        res.status(400).json(fail(400, 'Missing requestId or code'));
        return;
      }
      if (
        !requireRateLimit(req, res, {
          bucket: 'totp-bind-approve',
          key: requestId,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many bind approvals, please try again later',
        })
      ) {
        return;
      }

      const consumed = await consumeTotpBindRequest({
        requestId,
        code,
        expectedSubject:
          typeof req.body?.address === 'string'
            ? normalizeSubject(req.body.address)
            : undefined,
      });

      await provisionUserState(consumed.subject);
      const tokens = issueTokens(consumed.subject);
      const session = createCentralIssueSession({
        subject: consumed.subject,
        expiresInMs: consumed.sessionTtlMs,
      });
      const issued = issueCentralUcanBySession({
        sessionToken: session.sessionToken,
        audience: consumed.audience,
        capabilities: consumed.capabilities,
        expiresInMs: consumed.tokenTtlMs,
      });

      res.json(
        ok({
          requestId: consumed.requestId,
          approvedAt: consumed.approvedAt,
          subject: consumed.subject,
          appName: consumed.appName,
          redirectUri: consumed.redirectUri,
          token: tokens.accessToken,
          expiresAt: tokens.accessExpiresAt,
          refreshExpiresAt: tokens.refreshExpiresAt,
          sessionToken: session.sessionToken,
          sessionExpiresAt: session.expiresAt,
          ucan: issued.ucan,
          issuer: issued.issuer,
          audience: issued.audience,
          capabilities: issued.capabilities,
          notBefore: issued.notBefore,
          expiresAtUcan: issued.expiresAt,
        })
      );
    } catch (error) {
      if (error instanceof TotpAuthError) {
        res.status(error.status).json(fail(error.status, error.message));
        return;
      }
      const issuerMapped = mapIssuerError(error);
      const mappedStatus = issuerMapped.status >= 500 ? 500 : issuerMapped.status;
      res.status(mappedStatus).json(fail(mappedStatus, issuerMapped.message));
    }
  });

  app.post(`${BASE_PATH}/authorize/request`, async (req: Request, res: Response) => {
    try {
      const subject = String(req.body?.address || req.body?.subject || '').trim().toLowerCase();
      const appId = String(req.body?.appId || '').trim();
      if (
        !requireRateLimit(req, res, {
          bucket: 'totp-authorize-request',
          key: `${subject}:${appId}`,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many authorization requests, please try again later',
        })
      ) {
        return;
      }
      const result = await createTotpAuthorizeRequest({
        subject,
        appId: req.body?.appId,
        redirectUri: req.body?.redirectUri,
        state: req.body?.state,
        requestTtlMs: parseOptionalPositiveNumber(req.body?.requestTtlMs),
        sessionTtlMs: parseOptionalPositiveNumber(req.body?.sessionTtlMs),
        tokenTtlMs: parseOptionalPositiveNumber(req.body?.tokenTtlMs ?? req.body?.expiresInMs),
      });
      res.json(ok(result));
    } catch (error) {
      const mapped = mapTotpError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.get(`${BASE_PATH}/authorize/request/:requestId`, (req: Request, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim();
      const result = getTotpAuthorizeRequest(requestId);
      if (!result) {
        res.status(404).json(fail(404, 'totp authorize request not found'));
        return;
      }
      res.json(ok(result));
    } catch (error) {
      const mapped = mapTotpError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.post(`${BASE_PATH}/authorize/approve`, async (req: Request, res: Response) => {
    try {
      const requestId = String(req.body?.requestId || '').trim();
      const code = String(req.body?.code || '').trim();
      if (!requestId || !code) {
        res.status(400).json(fail(400, 'Missing requestId or code'));
        return;
      }
      if (
        !requireRateLimit(req, res, {
          bucket: 'totp-authorize-approve',
          key: requestId,
          windowMs: 60 * 1000,
          max: 20,
          message: 'Too many authorization approvals, please try again later',
        })
      ) {
        return;
      }

      const consumed = await consumeTotpAuthorizeRequest({
        requestId,
        code,
      });

      await provisionUserState(consumed.subject);
      const tokens = issueTokens(consumed.subject);
      const session = createCentralIssueSession({
        subject: consumed.subject,
        expiresInMs: consumed.sessionTtlMs,
      });
      const issued = issueCentralUcanBySession({
        sessionToken: session.sessionToken,
        audience: consumed.audience,
        capabilities: consumed.capabilities,
        expiresInMs: consumed.tokenTtlMs,
      });

      const authCode = await createTotpAuthorizeCode({
        requestId: consumed.requestId,
        subject: consumed.subject,
        appId: consumed.appId,
        redirectUri: consumed.redirectUri,
        state: consumed.state,
        token: tokens.accessToken,
        expiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        ucan: issued.ucan,
        issuer: issued.issuer,
        audience: issued.audience,
        capabilities: issued.capabilities,
        notBefore: issued.notBefore,
        ucanExpiresAt: issued.expiresAt,
      });

      res.json(
        ok({
          requestId: consumed.requestId,
          appName: consumed.appName,
          approvedAt: consumed.approvedAt,
          authorizationCode: authCode.code,
          authorizationCodeExpiresAt: authCode.expiresAt,
          redirectTo: authCode.redirectTo,
        })
      );
    } catch (error) {
      if (error instanceof TotpAuthError) {
        res.status(error.status).json(fail(error.status, error.message));
        return;
      }
      const issuerMapped = mapIssuerError(error);
      const mappedStatus = issuerMapped.status >= 500 ? 500 : issuerMapped.status;
      res.status(mappedStatus).json(fail(mappedStatus, issuerMapped.message));
    }
  });

  app.post(`${BASE_PATH}/authorize/exchange`, async (req: Request, res: Response) => {
    try {
      const appId = String(req.body?.appId || '').trim();
      if (
        !requireRateLimit(req, res, {
          bucket: 'totp-authorize-exchange',
          key: appId,
          windowMs: 60 * 1000,
          max: 30,
          message: 'Too many token exchanges, please try again later',
        })
      ) {
        return;
      }
      const result = await exchangeTotpAuthorizeCode({
        code: req.body?.code,
        appId: req.body?.appId,
        redirectUri: req.body?.redirectUri,
      });
      res.json(ok(result));
    } catch (error) {
      const mapped = mapTotpError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });
}
