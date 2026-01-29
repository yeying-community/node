import { Express, Request, Response } from 'express';
import { ok } from '../../auth/envelope';

export function registerPublicHealthRoute(app: Express) {
  app.get('/api/v1/public/health', (req: Request, res: Response) => {
    res.json(ok({ status: 'ok', timestamp: Date.now() }));
  });
  // Backward compatible alias
  app.get('/api/v1/public/healthCheck', (req: Request, res: Response) => {
    res.json(ok({ status: 'ok', timestamp: Date.now() }));
  });
}
