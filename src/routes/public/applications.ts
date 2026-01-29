import { Express, Request, Response } from 'express';
import { ok, fail } from '../../auth/envelope';
import { ApplicationService } from '../../domain/service/application';
import { Application } from '../../domain/model/application';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive, isAdminUser } from '../../common/permission';
import { getCurrentUtcString } from '../../common/date';
import { v4 as uuidv4 } from 'uuid';
import { AuditManager } from '../../domain/manager/audit';
import { CommentManager } from '../../domain/manager/comments';
import { ApplicationManager } from '../../domain/manager/application';
import { ApplicationConfigService } from '../../domain/service/applicationConfig';

function toServiceCodes(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(',');
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function normalizeApplicationConfig(input: unknown): Array<{ code: string; instance: string }> {
  const items = Array.isArray(input) ? input : [];
  const normalized: Array<{ code: string; instance: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const code = String(raw.code ?? raw.value ?? '').trim();
    const instance = String(raw.instance ?? raw.case ?? '').trim();
    if (!code || !instance) continue;
    normalized.push({ code, instance });
  }
  return normalized;
}

function parsePage(input: any) {
  const page = Number(input?.page ?? 1);
  const pageSize = Number(input?.pageSize ?? 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10,
  };
}

async function resolveByUid(uid: string) {
  const service = new ApplicationService();
  const app = await service.queryByUid(uid);
  if (!app || !app.did) {
    return null;
  }
  return app;
}

async function resolveByDid(did: string, version: number) {
  const service = new ApplicationService();
  const app = await service.query(did, version);
  if (!app || !app.did) {
    return null;
  }
  return app;
}

async function hasApprovedAudit(did: string, version: number) {
  const auditManager = new AuditManager();
  const commentManager = new CommentManager();
  const audits = await auditManager.queryByTarget('application', did, version);
  for (const audit of audits) {
    if (!audit.appOrServiceMetadata) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(audit.appOrServiceMetadata);
    } catch {
      continue;
    }
    const metadataType = parsed.operateType || audit.auditType;
    if (metadataType !== 'application') continue;
    if (parsed.did !== did || Number(parsed.version) !== Number(version)) continue;
    const comments = await commentManager.queryByAuditId(audit.uid);
    if (!comments || comments.length === 0) continue;
    const policy = audit.approver || '';
    const approvals = new Set<string>();
    const rejections = new Set<string>();
    for (const comment of comments) {
      const actor = (comment.signature || '').trim().toLowerCase() || comment.uid;
      if (comment.status === 'COMMENT_STATUS_AGREE') {
        approvals.add(actor);
      }
      if (comment.status === 'COMMENT_STATUS_REJECT') {
        rejections.add(actor);
      }
    }
    if (rejections.size > 0) {
      continue;
    }
    let requiredApprovals = 1;
    try {
      const parsedPolicy = JSON.parse(policy);
      if (parsedPolicy && typeof parsedPolicy === 'object') {
        const required = Number(parsedPolicy.requiredApprovals);
        if (Number.isFinite(required) && required > 0) {
          requiredApprovals = Math.floor(required);
        }
      }
    } catch {
      // ignore parse errors
    }
    if (approvals.size >= requiredApprovals) {
      return true;
    }
  }
  return false;
}

export function registerPublicApplicationRoutes(app: Express) {
  app.post('/api/v1/public/applications', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const body = req.body || {};
      const owner = body.owner || user.address;
      if (owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      if (!body.did || body.version === undefined) {
        res.status(400).json(fail(400, 'Missing did or version'));
        return;
      }
      const now = getCurrentUtcString();
      const application: Application = {
        uid: body.uid || uuidv4(),
        owner,
        ownerName: body.ownerName || owner,
        network: body.network || '',
        address: body.address || '',
        did: body.did,
        version: Number(body.version),
        name: body.name || '',
        description: body.description || '',
        code: body.code || 'APPLICATION_CODE_UNKNOWN',
        location: body.location || '',
        serviceCodes: toServiceCodes(body.serviceCodes),
        avatar: body.avatar || '',
        createdAt: body.createdAt || now,
        updatedAt: now,
        signature: body.signature || '',
        codePackagePath: body.codePackagePath || '',
        status: body.status || 'BUSINESS_STATUS_PENDING',
        isOnline: Boolean(body.isOnline),
      };
      const service = new ApplicationService();
      await service.save(application);
      res.json(ok(application));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create application failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.patch('/api/v1/public/applications/:uid', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const existing = await resolveByUid(uid);
      if (!existing) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      if (existing.owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const body = req.body || {};
      const now = getCurrentUtcString();
      const updated: Application = {
        ...existing,
        name: body.name ?? existing.name,
        description: body.description ?? existing.description,
        location: body.location ?? existing.location,
        code: body.code ?? existing.code,
        serviceCodes: body.serviceCodes !== undefined ? toServiceCodes(body.serviceCodes) : existing.serviceCodes,
        avatar: body.avatar ?? existing.avatar,
        codePackagePath: body.codePackagePath ?? existing.codePackagePath,
        updatedAt: now,
      };
      const service = new ApplicationService();
      await service.save(updated);
      res.json(ok(updated));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update application failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/public/applications/:uid', async (req: Request, res: Response) => {
    try {
      const uid = req.params.uid;
      const appRecord = await resolveByUid(uid);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      res.json(ok(appRecord));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch application failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/public/applications/:uid/config', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const appRecord = await resolveByUid(uid);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      const applicationConfigService = new ApplicationConfigService();
      const config = await applicationConfigService.getByApplicationAndApplicant(uid, user.address.toLowerCase());
      res.json(ok({ config: config?.config || [] }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch application config failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.put('/api/v1/public/applications/:uid/config', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const appRecord = await resolveByUid(uid);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      const body = req.body || {};
      const configItems = normalizeApplicationConfig(body.config ?? body.domains ?? []);
      const now = getCurrentUtcString();
      const applicationConfigService = new ApplicationConfigService();
      const saved = await applicationConfigService.upsert({
        uid: body.uid || uuidv4(),
        applicationUid: uid,
        applicationDid: appRecord.did,
        applicationVersion: appRecord.version,
        applicant: user.address.toLowerCase(),
        config: configItems,
        createdAt: body.createdAt || now,
        updatedAt: now,
      });
      res.json(ok(saved));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save application config failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/public/applications/by-did', async (req: Request, res: Response) => {
    try {
      const did = String(req.query.did || '');
      const version = Number(req.query.version);
      if (!did || !Number.isFinite(version)) {
        res.status(400).json(fail(400, 'Missing did or version'));
        return;
      }
      const appRecord = await resolveByDid(did, version);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      res.json(ok(appRecord));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch application failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.post('/api/v1/public/applications/search', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const condition = body.condition || {};
      const { page, pageSize } = parsePage(body);
      const service = new ApplicationService();
      const result = await service.search(condition, page, pageSize);
      res.json(
        ok({
          items: result.data,
          page: result.page,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search applications failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.delete('/api/v1/public/applications/:uid', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const existing = await resolveByUid(uid);
      if (!existing) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && existing.owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const service = new ApplicationService();
      await service.delete(existing.did, existing.version);
      res.json(ok({ deleted: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete application failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.post('/api/v1/public/applications/:uid/publish', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const existing = await resolveByUid(uid);
      if (!existing) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && existing.owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const approved = await hasApprovedAudit(existing.did, existing.version);
      if (!approved) {
        res.status(403).json(fail(403, 'Audit not approved'));
        return;
      }
      const manager = new ApplicationManager();
      await manager.updatePublishState(existing.did, existing.version, 'BUSINESS_STATUS_ONLINE', true);
      res.json(ok({ published: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish application failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.post('/api/v1/public/applications/:uid/unpublish', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const existing = await resolveByUid(uid);
      if (!existing) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && existing.owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const manager = new ApplicationManager();
      await manager.updatePublishState(existing.did, existing.version, 'BUSINESS_STATUS_OFFLINE', false);
      res.json(ok({ unpublished: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unpublish application failed';
      res.status(500).json(fail(500, message));
    }
  });
}
