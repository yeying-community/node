import { Express, Request, Response } from 'express';
import {
  createMobileBindRequest,
  consumeMobileBindRequest,
  getMobileAuthStatus,
  getMobileBindRequest,
  getMobileTotpProvision,
  MobileAuthError,
} from '../auth/mobileAuth';
import {
  createCentralIssueSession,
  getCentralIssuerStatus,
  issueCentralUcanBySession,
  type UcanCapability,
} from '../auth/ucanIssuer';
import { fail, ok } from '../auth/envelope';
import { issueTokens, verifyAccessToken } from '../auth/siwe';
import { provisionUserState } from '../common/permission';

const BASE_PATH = '/api/v1/public/auth/mobile';

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

function mapMobileError(error: unknown): { status: number; message: string } {
  if (error instanceof MobileAuthError) {
    return { status: error.status, message: error.message };
  }
  return { status: 500, message: error instanceof Error ? error.message : 'Mobile auth failed' };
}

export function registerPublicAuthMobileRoutes(app: Express) {
  app.get(`${BASE_PATH}/status`, (_req: Request, res: Response) => {
    res.json(ok(getMobileAuthStatus()));
  });

  app.get(`${BASE_PATH}/totp/provision`, (req: Request, res: Response) => {
    const accessToken = parseBearerToken(req);
    if (!accessToken) {
      res.status(401).json(fail(401, 'Missing access token'));
      return;
    }
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      res.status(401).json(fail(401, 'Invalid or expired access token'));
      return;
    }

    try {
      const subject = normalizeSubject(payload.address);
      const provision = getMobileTotpProvision(subject);
      res.json(ok(provision));
    } catch (error) {
      const mapped = mapMobileError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.post(`${BASE_PATH}/bind/request`, (req: Request, res: Response) => {
    const accessToken = parseBearerToken(req);
    if (!accessToken) {
      res.status(401).json(fail(401, 'Missing access token'));
      return;
    }
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      res.status(401).json(fail(401, 'Invalid or expired access token'));
      return;
    }

    try {
      const subject = normalizeSubject(payload.address);
      if (!subject) {
        res.status(400).json(fail(400, 'Missing subject'));
        return;
      }
      const issuerStatus = getCentralIssuerStatus();
      const audience =
        (typeof req.body?.audience === 'string' && req.body.audience.trim()) ||
        issuerStatus.defaultAudience;
      const capabilities = parseCapabilities(req.body?.capabilities) || issuerStatus.defaultCapabilities;

      const result = createMobileBindRequest({
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
      const mapped = mapMobileError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.get(`${BASE_PATH}/bind/request/:requestId`, (req: Request, res: Response) => {
    try {
      const requestId = String(req.params.requestId || '').trim();
      const result = getMobileBindRequest(requestId);
      if (!result) {
        res.status(404).json(fail(404, 'Mobile bind request not found'));
        return;
      }
      res.json(ok(result));
    } catch (error) {
      const mapped = mapMobileError(error);
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

      const consumed = consumeMobileBindRequest({
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
      if (error instanceof MobileAuthError) {
        res.status(error.status).json(fail(error.status, error.message));
        return;
      }
      const issuerMapped = mapIssuerError(error);
      const mappedStatus = issuerMapped.status >= 500 ? 500 : issuerMapped.status;
      res.status(mappedStatus).json(fail(mappedStatus, issuerMapped.message));
    }
  });
}
