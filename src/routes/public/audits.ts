import { Express, Request, Response } from 'express';
import { ok, fail } from '../../auth/envelope';
import {
  executeSignedAction,
  getActionSignatureErrorStatus,
  normalizeAddress,
} from '../../auth/actionSignature';
import { AuditService } from '../../domain/service/audit';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive, isAdminUser } from '../../common/permission';
import { getCurrentUtcString } from '../../common/date';
import { v4 as uuidv4 } from 'uuid';
import { isApproverMatch, normalizeAuditAddress } from '../../common/auditAccess';

function extractApplicantAddress(raw: string): string {
  if (!raw) return '';
  return String(raw).split('::')[0] || '';
}

function canAccessAudit(
  audit: { applicant?: string; approver?: string },
  address: string,
  isAdmin: boolean
) {
  if (isAdmin) return true;
  return (
    normalizeAuditAddress(audit.applicant) === normalizeAuditAddress(address) ||
    isApproverMatch(String(audit.approver || ''), address)
  );
}

function resolveTargetFromMetadata(metadataRaw: unknown) {
  const parsed =
    typeof metadataRaw === 'string'
      ? JSON.parse(metadataRaw || '{}')
      : metadataRaw || {};
  const targetType = String(parsed?.operateType || '').trim() || '';
  const targetDid = String(parsed?.did || '').trim() || '';
  const targetVersion = Number(parsed?.version);
  return { targetType, targetDid, targetVersion };
}

function parsePage(input: any) {
  const page = Number(input?.page ?? 1);
  const pageSize = Number(input?.pageSize ?? 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10,
  };
}

export function registerPublicAuditRoutes(app: Express) {
  app.post('/api/v1/public/audits', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const body = req.body || {};
      if (!body.appOrServiceMetadata || !body.auditType || !body.applicant || !body.reason) {
        res.status(400).json(fail(400, 'Missing audit fields'));
        return;
      }
      let targetType = '';
      let targetDid = '';
      let targetVersion = Number.NaN;
      try {
        const resolved = resolveTargetFromMetadata(body.appOrServiceMetadata);
        targetType = resolved.targetType || String(body.auditType || '').trim();
        targetDid = resolved.targetDid;
        targetVersion = resolved.targetVersion;
      } catch {
        res.status(400).json(fail(400, 'Invalid audit metadata'));
        return;
      }
      if (!targetType || !targetDid || !Number.isFinite(targetVersion)) {
        res.status(400).json(fail(400, 'Missing audit target fields'));
        return;
      }
      const applicantAddress = normalizeAddress(extractApplicantAddress(body.applicant));
      if (!applicantAddress) {
        res.status(400).json(fail(400, 'Missing applicant address'));
        return;
      }
      if (normalizeAddress(user.address) !== applicantAddress) {
        res.status(403).json(fail(403, 'Applicant mismatch'));
        return;
      }
      const result = await executeSignedAction({
        raw: body,
        action: 'audit_submit',
        actor: applicantAddress,
        payload: {
          auditType: String(body.auditType || ''),
          targetType,
          targetDid,
          targetVersion,
          applicant: String(body.applicant || ''),
          approver: String(body.approver || ''),
          reason: String(body.reason || ''),
          appOrServiceMetadata: body.appOrServiceMetadata,
        },
        execute: async () => {
          const now = getCurrentUtcString();
          const meta = {
            uid: body.uid || uuidv4(),
            appOrServiceMetadata: body.appOrServiceMetadata,
            auditType: body.auditType,
            applicant: body.applicant,
            approver: body.approver || '',
            reason: body.reason,
            createdAt: body.createdAt || body.timestamp || now,
            updatedAt: body.updatedAt || now,
            signature: body.signature || '',
          };
          const service = new AuditService();
          const created = await service.create(meta as any);
          return { status: 200, body: ok(created) };
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Create audit failed';
          const normalized = message.toLowerCase();
          const status =
            getActionSignatureErrorStatus(message) ??
            (message === 'Approver is required' ||
            normalized.includes('missing') ||
            normalized.includes('auditType') ||
            normalized.includes('did/version')
              ? 400
              : normalized.includes('not found')
              ? 404
              : message === 'USER_BLOCKED' ||
                message === 'USER_ROLE_DENIED' ||
                normalized.includes('mismatch') ||
                normalized.includes('not owner')
              ? 403
              : normalized.includes('duplicate')
              ? 409
              : 500);
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create audit failed';
      const normalized = message.toLowerCase();
      const status =
        getActionSignatureErrorStatus(message) ??
        (message === 'Approver is required' ||
            normalized.includes('missing') ||
        normalized.includes('auditType') ||
        normalized.includes('did/version')
          ? 400
          : normalized.includes('not found')
          ? 404
          : message === 'USER_BLOCKED' ||
            message === 'USER_ROLE_DENIED' ||
            normalized.includes('mismatch') ||
            normalized.includes('not owner')
          ? 403
          : normalized.includes('duplicate')
          ? 409
          : 500);
      res.status(status).json(fail(status, message));
    }
  });

  app.post('/api/v1/public/audits/search', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const body = req.body || {};
      const condition = { ...(body.condition || body || {}) };
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin) {
        const applicantMatched =
          typeof condition.applicant === 'string' &&
          normalizeAuditAddress(condition.applicant) === normalizeAuditAddress(user.address);
        const approverMatched =
          typeof condition.approver === 'string' &&
          isApproverMatch(condition.approver, user.address);
        if (!condition.applicant && !condition.approver) {
          condition.applicant = user.address;
        } else if (!applicantMatched && !approverMatched) {
          res.status(403).json(fail(403, 'Audit search scope denied'));
          return;
        }
      }
      const { page, pageSize } = parsePage(body);
      const states = Array.isArray(condition.states)
        ? condition.states.map((item: unknown) => String(item).trim()).filter(Boolean)
        : typeof condition.state === 'string' && condition.state.trim()
        ? [condition.state.trim()]
        : [];
      const service = new AuditService();
      const result = await service.queryByCondition({
        approver: condition.approver,
        applicant: condition.applicant,
        name: condition.name,
        auditType:
          typeof condition.auditType === 'string' && condition.auditType.trim()
            ? condition.auditType.trim()
            : typeof condition.type === 'string' && condition.type.trim()
            ? condition.type.trim()
            : undefined,
        states,
        startTime: condition.startTime,
        endTime: condition.endTime,
        page,
        pageSize,
      });
      res.json(
        ok({
          items: result.data,
          page: result.page,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search audits failed';
      const status = message === 'USER_BLOCKED' ? 403 : 500;
      res.status(status).json(fail(status, message));
    }
  });

  app.get('/api/v1/public/audits/:uid', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const service = new AuditService();
      const detail = await service.detail(req.params.uid);
      const isAdmin = await isAdminUser(user.address);
      if (!canAccessAudit(detail.meta, user.address, isAdmin)) {
        res.status(403).json(fail(403, 'Audit detail scope denied'));
        return;
      }
      res.json(ok(detail));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch audit failed';
      const status =
        message === 'Audit not found'
          ? 404
          : message === 'USER_BLOCKED'
          ? 403
          : 500;
      res.status(status).json(fail(status, message));
    }
  });

  app.delete('/api/v1/public/audits/:uid', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const body = req.body || {};
      const result = await executeSignedAction({
        raw: body,
        action: 'audit_cancel',
        actor: user.address,
        payload: {
          auditId: req.params.uid,
        },
        execute: async () => {
          const service = new AuditService();
          const detail = await service.detail(req.params.uid);
          const isAdmin = await isAdminUser(user.address);
          if (!canAccessAudit(detail.meta, user.address, isAdmin)) {
            return { status: 403, body: fail(403, 'Audit detail scope denied') };
          }
          const deleted = await service.cancel(req.params.uid);
          return { status: 200, body: ok(deleted) };
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Cancel audit failed';
          const status =
            getActionSignatureErrorStatus(message) ??
            (message === 'Audit not found'
              ? 404
              : message === 'Applicant permission denied' ||
                message === 'USER_BLOCKED' ||
                message === 'USER_ROLE_DENIED'
              ? 403
              : message === 'Audit already decided'
              ? 409
              : 500);
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cancel audit failed';
      const status =
        getActionSignatureErrorStatus(message) ??
        (message === 'Audit not found'
          ? 404
          : message === 'Applicant permission denied' ||
            message === 'USER_BLOCKED' ||
            message === 'USER_ROLE_DENIED'
          ? 403
          : message === 'Audit already decided'
          ? 409
          : 500);
      res.status(status).json(fail(status, message));
    }
  });
}
