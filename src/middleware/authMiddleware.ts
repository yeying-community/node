import { NextFunction, Request, Response } from 'express';
import { fail } from '../auth/envelope';
import { verifyAccessToken } from '../auth/siwe';
import {
  getRequiredUcanAudience,
  getRequiredUcanCapability,
  isUcanToken,
  peekUcanTokenPayload,
  verifyUcanInvocation,
} from '../auth/ucan';
import { runWithRequestContext } from '../common/requestContext';
import { SingletonLogger } from '../domain/facade/logger';

const PUBLIC_ROUTES = [
  '/public/auth/challenge',
  '/public/auth/verify',
  '/public/auth/refresh',
  '/public/auth/logout',
  '/public/health',
  '/public/healthCheck',
];

type AuthUser = {
  address: string;
  issuer?: string;
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

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const logger = SingletonLogger.get();

  if (req.method === 'OPTIONS') {
    return runWithRequestContext(undefined, () => next());
  }

  if (PUBLIC_ROUTES.includes(req.path) || req.path.startsWith('/public/auth/')) {
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
      const result = verifyUcanInvocation(token);
      const user: AuthUser = {
        address: result.address,
        issuer: result.issuer,
        authType: 'ucan',
      };
      (req as Request & { user?: AuthUser }).user = user;
      return runWithRequestContext(user, () => next());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid UCAN token';
      const claims = peekUcanTokenPayload(token);
      logger.warn('ucan verification failed', {
        method: req.method,
        path: req.originalUrl,
        ip: getRequestIp(req),
        reason: message,
        expectedAud: getRequiredUcanAudience(),
        expectedCap: getRequiredUcanCapability(),
        tokenAud: claims?.aud,
        tokenCap: claims?.cap,
        tokenIss: claims?.iss,
      });
      res.status(401).json(fail(401, message));
      return;
    }
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
