import { Express, Request, Response } from 'express';
import { fail, ok } from '../../auth/envelope';
import {
  CentralUcanCapability,
  getCentralIssuerDid,
  isCentralIssuerEnabled,
  issueCentralSessionToken,
  issueCentralUcanToken,
  verifyCentralSessionToken,
} from '../../auth/centralIssuer';
import { getConfig } from '../../config/runtime';

const BASE_PATH = '/api/v1/public/auth/central';

function parseBearerToken(req: Request): string {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && token) {
    return token.trim();
  }
  return authHeader.trim();
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function normalizeCapabilities(input: unknown): CentralUcanCapability[] {
  if (!Array.isArray(input)) return [];
  const result: CentralUcanCapability[] = [];
  for (const item of input) {
    const resource = String((item as { resource?: unknown })?.resource || '').trim();
    const action = String((item as { action?: unknown })?.action || '').trim();
    if (!resource || !action) continue;
    result.push({ resource, action });
  }
  return result;
}

function getDefaultAudience(): string {
  return String(process.env.UCAN_AUD || getConfig<string>('ucan.aud') || '').trim();
}

function getDefaultCapabilities(): CentralUcanCapability[] {
  const resource = String(process.env.UCAN_RESOURCE || getConfig<string>('ucan.resource') || '').trim();
  const action = String(process.env.UCAN_ACTION || getConfig<string>('ucan.action') || '').trim();
  if (!resource || !action) return [];
  return [{ resource, action }];
}

function ensureEnabled(res: Response): boolean {
  if (isCentralIssuerEnabled()) return true;
  res.status(404).json(fail(404, 'Central UCAN issuer disabled'));
  return false;
}

export function registerPublicCentralUcanRoutes(app: Express) {
  app.get(`${BASE_PATH}/issuer`, (req: Request, res: Response) => {
    if (!ensureEnabled(res)) return;
    const issuerDid = getCentralIssuerDid();
    if (!issuerDid) {
      res.status(500).json(fail(500, 'Central issuer unavailable'));
      return;
    }
    res.json(
      ok({
        enabled: true,
        issuerDid,
        defaultAudience: getDefaultAudience(),
        defaultCapabilities: getDefaultCapabilities(),
      })
    );
  });

  app.post(`${BASE_PATH}/session`, (req: Request, res: Response) => {
    if (!ensureEnabled(res)) return;
    const subject = String(req.body?.subject ?? req.body?.userId ?? '').trim();
    if (!subject) {
      res.status(400).json(fail(400, 'Missing subject'));
      return;
    }
    try {
      const sessionTtlMs = parsePositiveNumber(req.body?.sessionTtlMs);
      const issued = issueCentralSessionToken(subject, sessionTtlMs);
      res.json(
        ok({
          subject,
          sessionToken: issued.token,
          expiresAt: issued.expiresAt,
          issuerDid: getCentralIssuerDid(),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create central session';
      res.status(400).json(fail(400, message));
    }
  });

  app.post(`${BASE_PATH}/issue`, (req: Request, res: Response) => {
    if (!ensureEnabled(res)) return;
    const sessionToken = parseBearerToken(req);
    if (!sessionToken) {
      res.status(401).json(fail(401, 'Missing central session token'));
      return;
    }
    const session = verifyCentralSessionToken(sessionToken);
    if (!session) {
      res.status(401).json(fail(401, 'Invalid central session token'));
      return;
    }

    const audience = String(req.body?.audience ?? req.body?.aud ?? getDefaultAudience()).trim();
    if (!audience) {
      res.status(400).json(fail(400, 'Missing UCAN audience'));
      return;
    }

    const requestedCaps = normalizeCapabilities(req.body?.capabilities ?? req.body?.cap);
    const fallbackCaps = getDefaultCapabilities();
    const finalCaps = requestedCaps.length > 0 ? requestedCaps : fallbackCaps;
    if (!finalCaps.length) {
      res.status(400).json(fail(400, 'Missing UCAN capabilities'));
      return;
    }

    try {
      const issued = issueCentralUcanToken({
        subject: session.subject,
        audience,
        capabilities: finalCaps,
        expiresInMs: parsePositiveNumber(req.body?.expiresInMs ?? req.body?.ttlMs),
      });
      res.json(
        ok({
          ucan: issued.token,
          issuerDid: issued.payload.iss,
          subject: issued.payload.sub,
          audience: issued.payload.aud,
          capabilities: issued.payload.cap,
          exp: issued.payload.exp,
          nbf: issued.payload.nbf,
          iat: issued.payload.iat,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to issue central UCAN';
      res.status(400).json(fail(400, message));
    }
  });
}
