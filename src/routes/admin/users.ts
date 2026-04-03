import { Express, Request, Response } from 'express';
import { executeSignedAction, getActionSignatureErrorStatus } from '../../auth/actionSignature';
import { fail, ok } from '../../auth/envelope';
import { getRequestUser } from '../../common/requestContext';
import { UserService } from '../../domain/service/user';
import { getCurrentUtcString } from '../../common/date';
import {
  USER_ROLE_UNKNOWN,
  USER_ROLE_VALUES,
  USER_STATUS_ACTIVE,
  USER_STATUS_VALUES,
} from '../../domain/model/user';

function parsePage(req: Request) {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10,
  };
}

const VALID_USER_ROLES = new Set(USER_ROLE_VALUES);
const VALID_USER_STATUSES = new Set(USER_STATUS_VALUES);

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
      if (!user && !state) {
        res.status(404).json(fail(404, 'User not found'));
        return;
      }
      res.json(ok({ user, state }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Get user failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.patch('/api/v1/admin/users/:did/role', async (req: Request, res: Response) => {
    const did = req.params.did;
    const role = String(req.body?.role || '').trim();
    if (!did || !role) {
      res.status(400).json(fail(400, 'Missing did or role'));
      return;
    }
    if (!VALID_USER_ROLES.has(role)) {
      res.status(400).json(fail(400, 'Invalid user role'));
      return;
    }
    try {
      const actor = getRequestUser();
      if (!actor?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      const result = await executeSignedAction({
        raw: req.body || {},
        action: 'admin_user_role_update',
        actor: actor.address,
        payload: {
          targetDid: did,
          role,
        },
        execute: async () => {
          const userService = new UserService();
          const state = await userService.getState(did);
          const now = getCurrentUtcString();
          const nextState = state || {
            did,
            role: USER_ROLE_UNKNOWN,
            status: USER_STATUS_ACTIVE,
            createdAt: now,
            updatedAt: now,
            signature: '',
          };
          nextState.role = role;
          nextState.updatedAt = now;
          await userService.saveState(nextState);
          return { status: 200, body: ok({ updated: true, state: nextState }) };
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Update role failed';
          const status = getActionSignatureErrorStatus(message) ?? 500;
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update role failed';
      const status = getActionSignatureErrorStatus(message) ?? 500;
      res.status(status).json(fail(status, message));
    }
  });

  app.patch('/api/v1/admin/users/:did/status', async (req: Request, res: Response) => {
    const did = req.params.did;
    const status = String(req.body?.status || '').trim();
    if (!did || !status) {
      res.status(400).json(fail(400, 'Missing did or status'));
      return;
    }
    if (!VALID_USER_STATUSES.has(status)) {
      res.status(400).json(fail(400, 'Invalid user status'));
      return;
    }
    try {
      const actor = getRequestUser();
      if (!actor?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      const result = await executeSignedAction({
        raw: req.body || {},
        action: 'admin_user_status_update',
        actor: actor.address,
        payload: {
          targetDid: did,
          status,
        },
        execute: async () => {
          const userService = new UserService();
          const state = await userService.getState(did);
          const now = getCurrentUtcString();
          const nextState = state || {
            did,
            role: USER_ROLE_UNKNOWN,
            status: USER_STATUS_ACTIVE,
            createdAt: now,
            updatedAt: now,
            signature: '',
          };
          nextState.status = status;
          nextState.updatedAt = now;
          await userService.saveState(nextState);
          return { status: 200, body: ok({ updated: true, state: nextState }) };
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Update status failed';
          const statusCode = getActionSignatureErrorStatus(message) ?? 500;
          return { status: statusCode, body: fail(statusCode, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update status failed';
      const statusCode = getActionSignatureErrorStatus(message) ?? 500;
      res.status(statusCode).json(fail(statusCode, message));
    }
  });
}
