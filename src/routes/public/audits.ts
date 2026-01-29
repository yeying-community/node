import { Express, Request, Response } from 'express';
import { ok, fail } from '../../auth/envelope';
import { AuditService } from '../../domain/service/audit';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive } from '../../common/permission';
import { getCurrentUtcString } from '../../common/date';
import { v4 as uuidv4 } from 'uuid';
import {
  buildSubmitAuditMessage,
  normalizeAddress,
  verifyWalletSignature,
} from '../../auth/auditSignature';

function extractApplicantAddress(raw: string): string {
  if (!raw) return '';
  return String(raw).split('::')[0] || '';
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
      const requiresSignature = String(body.reason || '').includes('上架申请');
      if (requiresSignature) {
        if (!body.uid || !body.createdAt || !body.signature) {
          res.status(400).json(fail(400, 'Missing audit signature fields'));
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
        const message = buildSubmitAuditMessage({
          targetType,
          targetDid,
          targetVersion,
          applicant: applicantAddress,
          timestamp: body.createdAt,
          nonce: body.uid,
        });
        if (!verifyWalletSignature(message, body.signature, applicantAddress)) {
          res.status(401).json(fail(401, 'Invalid signature'));
          return;
        }
      }
      const now = getCurrentUtcString();
      const meta = {
        uid: body.uid || uuidv4(),
        appOrServiceMetadata: body.appOrServiceMetadata,
        auditType: body.auditType,
        applicant: body.applicant,
        approver: body.approver || '',
        reason: body.reason,
        createdAt: body.createdAt || now,
        updatedAt: body.updatedAt || now,
        signature: body.signature || '',
      };
      const service = new AuditService();
      const created = await service.create(meta as any);
      res.json(ok(created));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create audit failed';
      const normalized = message.toLowerCase();
      const status =
        message === 'Approver is required' ||
        normalized.includes('missing') ||
        normalized.includes('invalid') ||
        normalized.includes('auditType') ||
        normalized.includes('did/version')
          ? 400
          : normalized.includes('not found')
          ? 404
          : normalized.includes('mismatch') || normalized.includes('not owner')
          ? 403
          : normalized.includes('duplicate')
          ? 409
          : 500;
      res.status(status).json(fail(status, message));
    }
  });

  app.post('/api/v1/public/audits/search', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const condition = body.condition || body;
      const { page, pageSize } = parsePage(body);
      const service = new AuditService();
      const result = await service.queryByCondition({
        approver: condition.approver,
        applicant: condition.applicant,
        name: condition.name,
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
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/public/audits/:uid', async (req: Request, res: Response) => {
    try {
      const service = new AuditService();
      const detail = await service.detail(req.params.uid);
      res.json(ok(detail));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch audit failed';
      res.status(500).json(fail(500, message));
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
      const service = new AuditService();
      const deleted = await service.cancel(req.params.uid);
      res.json(ok(deleted));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cancel audit failed';
      res.status(500).json(fail(500, message));
    }
  });
}
