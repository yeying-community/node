import { Express, Request, Response } from 'express';
import { fail, ok } from '../auth/envelope';
import { isAdminUser } from '../common/permission';

type AuthUser = {
  address: string;
  issuer?: string;
  ucanSource?: 'wallet' | 'central';
  authType?: 'jwt' | 'ucan';
};

export function registerPublicProfileRoute(app: Express) {
  app.get('/api/v1/public/profile/me', async (req: Request, res: Response) => {
    const user = (req as Request & { user?: AuthUser }).user;
    if (!user?.address) {
      res.status(401).json(fail(401, 'Missing access token'));
      return;
    }
    try {
      res.json(
        ok({
          address: user.address,
          issuer: user.issuer,
          ucanSource: user.ucanSource,
          authType: user.authType,
          isAdmin: await isAdminUser(user.address),
          issuedAt: Date.now(),
        })
      );
    } catch (error) {
      res.status(400).json(fail(400, error instanceof Error ? error.message : 'Profile request failed'));
    }
  });
}
