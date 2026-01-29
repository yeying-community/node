import { Express, Request, Response } from 'express';
import { fail, ok } from '../../auth/envelope';
import { UserService } from '../../domain/service/user';
import { getCurrentUtcString } from '../../common/date';

function parsePage(req: Request) {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10,
  };
}

export function registerAdminUserRoutes(app: Express) {
  app.get('/api/v1/admin/users', async (req: Request, res: Response) => {
    try {
      const { page, pageSize } = parsePage(req);
      const userService = new UserService();
      const result = await userService.listUsers(page, pageSize);
      res.json(ok(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'List users failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/admin/users/:did', async (req: Request, res: Response) => {
    try {
      const did = req.params.did;
      const userService = new UserService();
      const user = await userService.getUser(did);
      const state = await userService.getState(did);
      res.json(ok({ user, state }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Get user failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.patch('/api/v1/admin/users/:did/role', async (req: Request, res: Response) => {
    const did = req.params.did;
    const role = req.body?.role;
    if (!did || !role) {
      res.status(400).json(fail(400, 'Missing did or role'));
      return;
    }
    try {
      const userService = new UserService();
      const state = await userService.getState(did);
      if (!state) {
        res.status(404).json(fail(404, 'User state not found'));
        return;
      }
      state.role = role;
      state.updatedAt = getCurrentUtcString();
      await userService.saveState(state);
      res.json(ok({ updated: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update role failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.patch('/api/v1/admin/users/:did/status', async (req: Request, res: Response) => {
    const did = req.params.did;
    const status = req.body?.status;
    if (!did || !status) {
      res.status(400).json(fail(400, 'Missing did or status'));
      return;
    }
    try {
      const userService = new UserService();
      const state = await userService.getState(did);
      if (!state) {
        res.status(404).json(fail(404, 'User state not found'));
        return;
      }
      state.status = status;
      state.updatedAt = getCurrentUtcString();
      await userService.saveState(state);
      res.json(ok({ updated: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update status failed';
      res.status(500).json(fail(500, message));
    }
  });
}
