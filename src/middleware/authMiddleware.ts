import { NextFunction, Request, Response } from 'express';
import { fail } from '../auth/envelope';
import { verifyAccessToken } from '../auth/siwe';
import { isUcanToken, verifyUcanInvocation } from '../auth/ucan';
import { runWithRequestContext } from '../common/requestContext';

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

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    return runWithRequestContext(undefined, () => next());
  }

  if (PUBLIC_ROUTES.includes(req.path) || req.path.startsWith('/public/auth/')) {
    return runWithRequestContext(undefined, () => next());
  }

  if (req.path.startsWith('/internal/')) {
    const internalToken = process.env.INTERNAL_TOKEN;
    const provided = Array.isArray(req.headers['x-internal-token'])
      ? req.headers['x-internal-token'][0]
      : (req.headers['x-internal-token'] as string | undefined);
    if (internalToken && provided === internalToken) {
      return runWithRequestContext(undefined, () => next());
    }
  }

  const authHeader = req.headers.authorization || '';
  const [scheme, rawToken] = authHeader.split(' ');
  const token = scheme?.toLowerCase() === 'bearer' ? rawToken : authHeader;

  if (!token) {
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
      res.status(401).json(fail(401, message));
      return;
    }
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
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
