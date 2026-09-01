import { NextFunction, Request, Response } from 'express';
import { fail } from '../auth/envelope';
import { verifyAccessToken } from '../auth/siwe';
import {
  getRequiredUcanAudience,
  getRequiredUcanCapability,
  isUcanToken,
  peekUcanTokenPayload,
  verifyUcanInvocation,
  verifyUcanInvocationWithCap,
} from '../auth/ucan';
import { runWithRequestContext } from '../common/requestContext';
import { getConfig } from '../config/runtime';
import { MpcRuntimeConfig } from '../config';
import { SingletonLogger } from '../domain/facade/logger';

const PUBLIC_ROUTES = [
  '/public/auth/challenge',
  '/public/auth/verify',
  '/public/auth/refresh',
  '/public/auth/logout',
  '/public/health',
  '/public/healthCheck',
  '/public/ready',
];
const DEFAULT_MPC_UCAN_WITH = 'mpc';
const DEFAULT_MPC_UCAN_CAN = 'coordinate';

type AuthUser = {
  address: string;
  issuer?: string;
  ucanSource?: 'wallet' | 'central';
  authType: 'jwt' | 'ucan';
};

function getRequestIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function getMountedRoutePath(req: Pick<Request, 'baseUrl' | 'path'>): string {
  const baseUrl = String(req.baseUrl || '').replace(/\/$/, '');
  const requestPath = String(req.path || '');
  return `${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`;
}

function isPublicAppPublishRoute(req: Request): boolean {
  return (
    req.method === 'POST' &&
    /^\/public\/pusher\/apps\/[^/]+\/events$/.test(String(req.path || ''))
  );
}

export function getRouteRequiredUcanCapabilities(
  req: Pick<Request, 'baseUrl' | 'path'> & Partial<Pick<Request, 'query'>>
) {
  const routePath = getMountedRoutePath(req);
  const notificationSource = String(req.query?.source || '').trim().toLowerCase();
  if (routePath === '/api/v1/public/notifications' && notificationSource === 'mpc') {
    const config = (getConfig<MpcRuntimeConfig>('mpc') || {}) as MpcRuntimeConfig;
    const resource = String(config.ucanWith || DEFAULT_MPC_UCAN_WITH).trim();
    const action = String(config.ucanCan || DEFAULT_MPC_UCAN_CAN).trim();
    return [
      {
        with: resource || '*',
        can: action || '*',
      },
    ];
  }
  if (!routePath.startsWith('/api/v1/public/mpc')) {
    if (!routePath.startsWith('/api/v1/public/custody')) {
      return null;
    }
    if (routePath.startsWith('/api/v1/public/custody/recovery')) {
      return [];
    }
    return [{ with: 'custody', can: 'write' }];
  }
  const config = (getConfig<MpcRuntimeConfig>('mpc') || {}) as MpcRuntimeConfig;
  const resource = String(config.ucanWith || DEFAULT_MPC_UCAN_WITH).trim();
  const action = String(config.ucanCan || DEFAULT_MPC_UCAN_CAN).trim();
  return [
    {
      with: resource || '*',
      can: action || '*',
    },
  ];
}

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const logger = SingletonLogger.get();

  if (req.method === 'OPTIONS') {
    return runWithRequestContext(undefined, () => next());
  }

  if (
    PUBLIC_ROUTES.includes(req.path) ||
    req.path.startsWith('/public/auth/') ||
    req.path.startsWith('/public/identity/') ||
    isPublicAppPublishRoute(req)
  ) {
    return runWithRequestContext(undefined, () => next());
  }

  const authHeader = req.headers.authorization || '';
  const [scheme, rawToken] = authHeader.split(' ');
  const token = scheme?.toLowerCase() === 'bearer' ? rawToken : authHeader;

  if (!token) {
    logger.warn('auth missing access token', {
      method: req.method,
      path: req.originalUrl,
      ip: getRequestIp(req),
    });
    res.status(401).json(fail(401, 'Missing access token'));
    return;
  }

  const routeCaps = getRouteRequiredUcanCapabilities(req);
  if (isUcanToken(token)) {
    try {
      const result =
        routeCaps && routeCaps.length > 0
          ? verifyUcanInvocationWithCap(token, routeCaps)
          : verifyUcanInvocation(token);
      const user: AuthUser = {
        address: result.address,
        issuer: result.issuer,
        ucanSource: result.source,
        authType: 'ucan',
      };
      (req as Request & { user?: AuthUser }).user = user;
      return runWithRequestContext(user, () => next());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid UCAN token';
      const claims = peekUcanTokenPayload(token);
      const routeCaps = getRouteRequiredUcanCapabilities(req);
      logger.warn('ucan verification failed', {
        method: req.method,
        path: req.originalUrl,
        ip: getRequestIp(req),
        reason: message,
        expectedAud: getRequiredUcanAudience(),
        expectedCap:
          routeCaps && routeCaps.length > 0
            ? routeCaps
            : getRequiredUcanCapability(),
        tokenAud: claims?.aud,
        tokenCap: claims?.cap,
        tokenIss: claims?.iss,
        tokenSub: claims?.sub,
      });
      res.status(401).json(fail(401, message));
      return;
    }
  }

  if (routeCaps && routeCaps.length > 0) {
    logger.warn('ucan required for capability route', {
      method: req.method,
      path: req.originalUrl,
      ip: getRequestIp(req),
      expectedCap: routeCaps,
    });
    res.status(401).json(fail(401, 'UCAN token required'));
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    logger.warn('jwt verification failed', {
      method: req.method,
      path: req.originalUrl,
      ip: getRequestIp(req),
    });
    res.status(401).json(fail(401, 'Invalid or expired access token'));
    return;
  }

  const user: AuthUser = {
    address: payload.address,
    authType: 'jwt',
  };
  (req as Request & { user?: AuthUser }).user = user;
  runWithRequestContext(user, () => next());
};

export default authenticateToken;
