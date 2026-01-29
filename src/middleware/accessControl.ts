import { NextFunction, Request, Response } from 'express';
import { fail } from '../auth/envelope';
import { getRequestUser } from '../common/requestContext';
import { ensureUserActive, isAdminUser } from '../common/permission';
import { AuditManager } from '../domain/manager/audit';

function getInternalTokenFromRequest(req: Request): string | undefined {
  const raw = req.headers['x-internal-token'];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw as string | undefined;
}

function isApproverMatch(approver: string, address: string) {
  if (!approver) return false;
  const normalizedAddress = address.trim().toLowerCase();
  const matchEntry = (entry: string) => {
    const normalizedEntry = entry.trim().toLowerCase();
    return normalizedEntry === normalizedAddress || normalizedEntry.startsWith(`${normalizedAddress}::`) || normalizedEntry.includes(normalizedAddress);
  };
  try {
    const parsed = JSON.parse(approver);
    if (Array.isArray(parsed)) {
      return parsed.some((entry) => typeof entry === 'string' && matchEntry(entry));
    }
    if (parsed && typeof parsed === 'object') {
      const list = Array.isArray((parsed as any).approvers) ? (parsed as any).approvers : [];
      return list.some((entry: unknown) => typeof entry === 'string' && matchEntry(entry));
    }
  } catch {
    // ignore parse errors
  }
  const candidates = approver.split(',').map((item) => item.trim()).filter(Boolean);
  if (candidates.length > 1) {
    return candidates.some((entry) => matchEntry(entry));
  }
  return matchEntry(approver);
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
        const auditId = req.params?.uid || req.body?.auditId || req.body?.metadata?.auditId;
        if (auditId) {
          const audit = await new AuditManager().queryById(auditId);
          const approver = audit?.approver || '';
          const matched = isApproverMatch(approver, user.address);
          if (matched) {
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

export function requireInternal(req: Request, res: Response, next: NextFunction) {
  const internalToken = process.env.INTERNAL_TOKEN;
  if (!internalToken) {
    res.status(500).json(fail(500, 'INTERNAL_TOKEN not configured'));
    return;
  }
  const provided = getInternalTokenFromRequest(req);
  if (!provided || provided !== internalToken) {
    res.status(403).json(fail(403, 'Internal token invalid'));
    return;
  }
  next();
}
