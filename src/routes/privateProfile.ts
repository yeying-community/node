import { Express, Request, Response } from 'express';
import { fail, ok } from '../auth/envelope';

type AuthUser = {
  address: string;
  issuer?: string;
  authType?: 'jwt' | 'ucan';
};

export function registerPrivateProfileRoute(app: Express) {
  app.get('/api/v1/private/profile', (req: Request, res: Response) => {
    const user = (req as Request & { user?: AuthUser }).user;
    if (!user?.address) {
      res.status(401).json(fail(401, 'Missing access token'));
      return;
    }
    res.json(
      ok({
        address: user.address,
        issuer: user.issuer,
        authType: user.authType,
        issuedAt: Date.now(),
      })
    );
  });
}
