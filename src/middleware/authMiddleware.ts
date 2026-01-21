import { NextFunction, Request, Response } from 'express';
import { fail } from '../auth/envelope';
import { verifyAccessToken } from '../auth/siwe';
import { isUcanToken, verifyUcanInvocation } from '../auth/ucan';

const PUBLIC_ROUTES = [
  '/v1/public/auth/challenge',
  '/v1/public/auth/verify',
  '/v1/public/auth/refresh',
  '/v1/public/auth/logout',
  '/v1/node/healthCheck',
];

type AuthUser = {
  address: string;
  issuer?: string;
  authType: 'jwt' | 'ucan';
};

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  if (PUBLIC_ROUTES.includes(req.path) || req.path.startsWith('/v1/public/auth/')) {
    return next();
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
      (req as Request & { user?: AuthUser }).user = {
        address: result.address,
        issuer: result.issuer,
        authType: 'ucan',
      };
      return next();
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

  (req as Request & { user?: AuthUser }).user = {
    address: payload.address,
    authType: 'jwt',
  };
  next();
};

export default authenticateToken;
