import { NextFunction, Request, Response } from 'express';
import { fail } from '../auth/envelope';
import { getRequestUser } from '../common/requestContext';
import {
  ensureUserActive,
  ensureUserCanApproveAudit,
  isAdminUser,
} from '../common/permission';
import { AuditManager } from '../domain/manager/audit';
import { isApproverMatch } from '../common/auditAccess';

function resolveAuditId(req: Request) {
  const fromParams = String(req.params?.uid || '').trim();
  if (fromParams) {
    return fromParams;
  }
  const fromBody = String(
    req.body?.auditId ||
      req.body?.payload?.auditId ||
      req.body?.metadata?.auditId ||
      ''
  ).trim();
  if (fromBody) {
    return fromBody;
  }
  const match = String(req.path || '').match(/^\/audits\/([^/]+)/i);
  if (!match?.[1]) {
    return '';
  }
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const user = getRequestUser();
    if (!user?.address) {
      res.status(401).json(fail(401, 'Missing access token'));
      return;
    }
    await ensureUserActive(user.address);
    const isAdmin = await isAdminUser(user.address);
    if (!isAdmin) {
      if (req.path.startsWith('/audits/')) {
        const auditId = resolveAuditId(req);
        if (auditId) {
          const audit = await new AuditManager().queryById(auditId);
          const approver = audit?.approver || '';
          const matched = isApproverMatch(approver, user.address);
          if (matched) {
            await ensureUserCanApproveAudit(user.address);
            return next();
          }
        }
      }
      res.status(403).json(fail(403, 'Admin permission required'));
      return;
    }
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Admin permission denied';
    const status = message === 'USER_BLOCKED' ? 403 : 403;
    res.status(status).json(fail(status, message));
  }
}
