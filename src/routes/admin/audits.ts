import { Express, Request, Response } from 'express';
import { ok, fail } from '../../auth/envelope';
import { AuditService } from '../../domain/service/audit';
import { getCurrentUtcString } from '../../common/date';
import { v4 as uuidv4 } from 'uuid';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive } from '../../common/permission';
import {
  buildAuditDecisionMessage,
  normalizeAddress,
  verifyWalletSignature,
} from '../../auth/auditSignature';

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
      if (!body.uid || !body.createdAt || !body.signature) {
        res.status(400).json(fail(400, 'Missing audit signature fields'));
        return;
      }
      const approver = normalizeAddress(user.address);
      const message = buildAuditDecisionMessage({
        auditId: req.params.uid,
        decision: 'approve',
        approver,
        timestamp: body.createdAt,
        nonce: body.uid,
      });
      if (!verifyWalletSignature(message, body.signature, approver)) {
        res.status(401).json(fail(401, 'Invalid signature'));
        return;
      }
      const now = getCurrentUtcString();
      const service = new AuditService();
      const saved = await service.approve({
        uid: body.uid || uuidv4(),
        auditId: req.params.uid,
        text: body?.text || '',
        status: '',
        createdAt: body.createdAt || now,
        updatedAt: body.updatedAt || now,
        signature: body?.signature || '',
      } as any);
      res.json(ok(saved));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approve audit failed';
      const status = message === 'Approver permission denied' ? 403 : 500;
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
      if (!body.uid || !body.createdAt || !body.signature) {
        res.status(400).json(fail(400, 'Missing audit signature fields'));
        return;
      }
      const approver = normalizeAddress(user.address);
      const message = buildAuditDecisionMessage({
        auditId: req.params.uid,
        decision: 'reject',
        approver,
        timestamp: body.createdAt,
        nonce: body.uid,
      });
      if (!verifyWalletSignature(message, body.signature, approver)) {
        res.status(401).json(fail(401, 'Invalid signature'));
        return;
      }
      const now = getCurrentUtcString();
      const service = new AuditService();
      const saved = await service.reject({
        uid: body.uid || uuidv4(),
        auditId: req.params.uid,
        text: body?.text || '',
        status: '',
        createdAt: body.createdAt || now,
        updatedAt: body.updatedAt || now,
        signature: body?.signature || '',
      } as any);
      res.json(ok(saved));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reject audit failed';
      const status = message === 'Approver permission denied' ? 403 : 500;
      res.status(status).json(fail(status, message));
    }
  });
}
