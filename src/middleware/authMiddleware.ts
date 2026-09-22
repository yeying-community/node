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
import { getRouteUcanPolicy } from '../auth/routeUcanPolicy';
import { runWithRequestContext } from '../common/requestContext';
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

function isPublicAppPublishRoute(req: Request): boolean {
  return (
    req.method === 'POST' &&
    /^\/public\/pusher\/apps\/[^/]+\/events$/.test(String(req.path || ''))
  );
}

export function getRouteRequiredUcanCapabilities(
  req: Pick<Request, 'baseUrl' | 'path'> & Partial<Pick<Request, 'query'>>
) {
  const policy = getRouteUcanPolicy(req);
  return policy ? policy.anyOf[0] || [] : null;
}

const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
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

  // Custody recovery routes authenticate their short-lived recovery token in
  // the route handler. They must not be reinterpreted as a normal SIWE/JWT
  // access token by this global middleware.
  const routePolicy = getRouteUcanPolicy({
    method: req.method,
    baseUrl: req.baseUrl,
    path: req.path,
    query: req.query as Record<string, unknown>,
  });
  const routeCaps = routePolicy ? routePolicy.anyOf[0] || [] : null;
  if (routeCaps && routeCaps.length === 0) {
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

  if (isUcanToken(token)) {
    try {
      let result;
      if (routePolicy && routePolicy.anyOf.length > 0) {
        let lastError: unknown;
        for (const required of routePolicy.anyOf) {
          try {
            result = await verifyUcanInvocationWithCap(token, required);
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!result) {
          throw lastError || new Error('UCAN capability denied');
        }
      } else {
        result = await verifyUcanInvocation(token);
      }
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
      const expectedPolicy = getRouteUcanPolicy({
        method: req.method,
        baseUrl: req.baseUrl,
        path: req.path,
        query: req.query as Record<string, unknown>,
      });
      logger.warn('ucan verification failed', {
        method: req.method,
        path: req.originalUrl,
        ip: getRequestIp(req),
        reason: message,
        expectedAud: getRequiredUcanAudience(),
        expectedCap:
          expectedPolicy && expectedPolicy.anyOf.length > 0
            ? expectedPolicy.anyOf
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

  if (routePolicy && routePolicy.anyOf.length > 0 && routePolicy.strict) {
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
