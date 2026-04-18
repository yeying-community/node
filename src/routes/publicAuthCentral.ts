import { Express, Request, Response } from 'express';
import {
  createCentralIssueSession,
  getCentralIssuerStatus,
  issueCentralUcanBySession,
  revokeCentralIssueSession,
  type UcanCapability,
} from '../auth/ucanIssuer';
import { fail, ok } from '../auth/envelope';
import { verifyAccessToken } from '../auth/siwe';

const BASE_PATH = '/api/v1/public/auth/central';

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
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseCapabilities(raw: unknown): UcanCapability[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const items: UcanCapability[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const source = entry as Record<string, unknown>;
    const withValue =
      (typeof source.with === 'string' && source.with.trim()) ||
      (typeof source.resource === 'string' && source.resource.trim()) ||
      '';
    const canValue =
      (typeof source.can === 'string' && source.can.trim()) ||
      (typeof source.action === 'string' && source.action.trim()) ||
      '';
    if (!withValue || !canValue) {
      continue;
    }
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

export function registerPublicAuthCentralRoutes(app: Express) {
  app.get(`${BASE_PATH}/issuer`, (_req: Request, res: Response) => {
    const status = getCentralIssuerStatus();
    res.json(
      ok({
        enabled: status.enabled,
        mode: status.mode,
        ready: status.ready,
        issuerDid: status.issuerDid,
        sessionTtlMs: status.sessionTtlMs,
        tokenTtlMs: status.tokenTtlMs,
        defaultAudience: status.defaultAudience,
        defaultCapabilities: status.defaultCapabilities,
        error: status.error,
      })
    );
  });

  app.post(`${BASE_PATH}/session`, (req: Request, res: Response) => {
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

    const tokenSubject = normalizeSubject(payload.address);
    const requestSubject = normalizeSubject(req.body?.subject || tokenSubject);
    if (!requestSubject) {
      res.status(400).json(fail(400, 'Missing subject'));
      return;
    }
    if (requestSubject !== tokenSubject) {
      res.status(403).json(fail(403, 'Subject must match access token address'));
      return;
    }

    try {
      const session = createCentralIssueSession({
        subject: requestSubject,
        expiresInMs: parseOptionalPositiveNumber(req.body?.sessionTtlMs),
      });
      res.json(
        ok({
          subject: session.subject,
          issuerDid: session.issuer,
          sessionToken: session.sessionToken,
          issuedAt: session.issuedAt,
          expiresAt: session.expiresAt,
        })
      );
    } catch (error) {
      const mapped = mapIssuerError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.post(`${BASE_PATH}/issue`, (req: Request, res: Response) => {
    const sessionToken = parseBearerToken(req);
    if (!sessionToken) {
      res.status(401).json(fail(401, 'Missing session token'));
      return;
    }

    try {
      const audience = typeof req.body?.audience === 'string' ? req.body.audience.trim() : undefined;
      const capabilities = parseCapabilities(req.body?.capabilities);
      const expiresInMs = parseOptionalPositiveNumber(req.body?.expiresInMs ?? req.body?.ttlMs);
      const issued = issueCentralUcanBySession({
        sessionToken,
        audience,
        capabilities,
        expiresInMs,
      });

      res.json(
        ok({
          ucan: issued.ucan,
          issuer: issued.issuer,
          issuerDid: issued.issuer,
          subject: issued.subject,
          audience: issued.audience,
          capabilities: issued.capabilities,
          notBefore: issued.notBefore,
          expiresAt: issued.expiresAt,
          nbf: issued.notBefore,
          exp: issued.expiresAt,
          iat: issued.notBefore,
        })
      );
    } catch (error) {
      const mapped = mapIssuerError(error);
      res.status(mapped.status).json(fail(mapped.status, mapped.message));
    }
  });

  app.post(`${BASE_PATH}/revoke`, (req: Request, res: Response) => {
    const sessionToken = parseBearerToken(req);
    if (!sessionToken) {
      res.status(401).json(fail(401, 'Missing session token'));
      return;
    }

    const revoked = revokeCentralIssueSession(sessionToken);
    res.json(ok({ revoked }));
  });
}
