import { Express, Request, Response } from 'express';
import { fail } from '../auth/envelope';
import { UserService } from '../domain/service/user';
import { getCurrentUtcString } from '../common/date';

export function registerAdminUserRoleRoute(app: Express) {
  app.post('/api/v1/admin/user/updateRole', async (req: Request, res: Response) => {
    const did = req.body?.body?.did;
    const role = req.body?.body?.role;
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
      res.json({
        header: {},
        body: {
          status: { code: 'OK' }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'updateRole failed';
      res.status(500).json(fail(500, message));
    }
  });
}
