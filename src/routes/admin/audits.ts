import { Express, Request, Response } from 'express';
import {
  executeSignedAction,
  getActionSignatureErrorStatus,
  normalizeAddress,
} from '../../auth/actionSignature';
import { ok, fail } from '../../auth/envelope';
import { AuditService } from '../../domain/service/audit';
import { getCurrentUtcString } from '../../common/date';
import { v4 as uuidv4 } from 'uuid';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive } from '../../common/permission';

function mapAuditDecisionError(message: string) {
  const signatureStatus = getActionSignatureErrorStatus(message);
  if (signatureStatus !== undefined) {
    return signatureStatus;
  }
  if (
    message === 'Approver permission denied' ||
    message === 'APPROVER_ROLE_REQUIRED' ||
    message === 'USER_BLOCKED'
  ) {
    return 403;
  }
  if (
    message === 'Audit already decided' ||
    message === 'Approver already submitted'
  ) {
    return 409;
  }
  if (message === 'auditDO is undefined' || message === 'Audit not found') {
    return 404;
  }
  return 500;
}

export function registerAdminAuditRoutes(app: Express) {
  app.post('/api/v1/admin/audits/:uid/approve', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const body = req.body || {};
      const approver = normalizeAddress(user.address);
      const result = await executeSignedAction({
        raw: body,
        action: 'audit_decision',
        actor: approver,
        payload: {
          auditId: req.params.uid,
          decision: 'approve',
          approver,
          text: String(body?.text || ''),
        },
        execute: async () => {
          const now = getCurrentUtcString();
          const service = new AuditService();
          const saved = await service.approve({
            uid: body.uid || uuidv4(),
            auditId: req.params.uid,
            text: body?.text || '',
            status: '',
            createdAt: body.createdAt || body.timestamp || now,
            updatedAt: body.updatedAt || now,
            signature: body?.signature || '',
          } as any);
          return { status: 200, body: ok(saved) };
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Approve audit failed';
          const status = mapAuditDecisionError(message);
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approve audit failed';
      const status = mapAuditDecisionError(message);
      res.status(status).json(fail(status, message));
    }
  });

  app.post('/api/v1/admin/audits/:uid/reject', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const body = req.body || {};
      const approver = normalizeAddress(user.address);
      const result = await executeSignedAction({
        raw: body,
        action: 'audit_decision',
        actor: approver,
        payload: {
          auditId: req.params.uid,
          decision: 'reject',
          approver,
          text: String(body?.text || ''),
        },
        execute: async () => {
          const now = getCurrentUtcString();
          const service = new AuditService();
          const saved = await service.reject({
            uid: body.uid || uuidv4(),
            auditId: req.params.uid,
            text: body?.text || '',
            status: '',
            createdAt: body.createdAt || body.timestamp || now,
            updatedAt: body.updatedAt || now,
            signature: body?.signature || '',
          } as any);
          return { status: 200, body: ok(saved) };
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Reject audit failed';
          const status = mapAuditDecisionError(message);
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reject audit failed';
      const status = mapAuditDecisionError(message);
      res.status(status).json(fail(status, message));
    }
  });
}
