import { Express, Request, Response } from 'express';
import { fail, ok } from '../../auth/envelope';
import { SingletonDataSource } from '../../domain/facade/datasource';

async function checkDatabase() {
  const dataSource = SingletonDataSource.get();
  if (!dataSource?.isInitialized) throw new Error('Database is not initialized');
  await dataSource.query('SELECT 1');
  return true;
}

export function registerPublicHealthRoute(app: Express) {
  app.get('/api/v1/public/health', (req: Request, res: Response) => {
    res.json(ok({ status: 'ok', timestamp: Date.now() }));
  });
  // Backward compatible alias
  app.get('/api/v1/public/healthCheck', (req: Request, res: Response) => {
    res.json(ok({ status: 'ok', timestamp: Date.now() }));
  });
  app.get('/api/v1/public/ready', async (_req: Request, res: Response) => {
    try {
      await checkDatabase();
      res.json(ok({ status: 'ok', database: 'ok', timestamp: Date.now() }));
    } catch {
      res.status(503).json(fail(503, 'Database is not ready'));
    }
  });
}
