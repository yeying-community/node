import { Express, Request, Response } from 'express';
import { ok, fail } from '../../auth/envelope';
import { ServiceService } from '../../domain/service/service';
import { Service } from '../../domain/model/service';
import { getRequestUser } from '../../common/requestContext';
import { ensureUserActive, isAdminUser } from '../../common/permission';
import { getCurrentUtcString } from '../../common/date';
import { v4 as uuidv4 } from 'uuid';
import { AuditManager } from '../../domain/manager/audit';
import { CommentManager } from '../../domain/manager/comments';
import { ServiceManager } from '../../domain/manager/service';
import { ServiceConfigService } from '../../domain/service/serviceConfig';

function parsePage(input: any) {
  const page = Number(input?.page ?? 1);
  const pageSize = Number(input?.pageSize ?? 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 10,
  };
}

function toApiCodes(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(',');
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function normalizeServiceConfig(input: unknown): Array<{ code: string; instance: string }> {
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

async function resolveByUid(uid: string) {
  const service = new ServiceService();
  try {
    return await service.getByUid(uid);
  } catch {
    return null;
  }
}

async function resolveByDid(did: string, version: number) {
  const service = new ServiceService();
  try {
    return await service.get(did, version);
  } catch {
    return null;
  }
}

async function hasApprovedAudit(did: string, version: number) {
  const auditManager = new AuditManager();
  const commentManager = new CommentManager();
  const audits = await auditManager.queryByTarget('service', did, version);
  for (const audit of audits) {
    if (!audit.appOrServiceMetadata) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(audit.appOrServiceMetadata);
    } catch {
      continue;
    }
    const metadataType = parsed.operateType || audit.auditType;
    if (metadataType !== 'service') continue;
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

export function registerPublicServiceRoutes(app: Express) {
  app.post('/api/v1/public/services', async (req: Request, res: Response) => {
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
      const service: Service = {
        uid: body.uid || uuidv4(),
        owner,
        ownerName: body.ownerName || owner,
        network: body.network || '',
        address: body.address || '',
        did: body.did,
        version: Number(body.version),
        name: body.name || '',
        description: body.description || '',
        code: body.code || 'SERVICE_CODE_UNKNOWN',
        apiCodes: toApiCodes(body.apiCodes),
        proxy: body.proxy || '',
        grpc: body.grpc || '',
        avatar: body.avatar || '',
        createdAt: body.createdAt || now,
        updatedAt: now,
        signature: body.signature || '',
        codePackagePath: body.codePackagePath || '',
        status: body.status || 'BUSINESS_STATUS_PENDING',
        isOnline: Boolean(body.isOnline),
      };
      const serviceService = new ServiceService();
      await serviceService.save(service);
      res.json(ok(service));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create service failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.patch('/api/v1/public/services/:uid', async (req: Request, res: Response) => {
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
        res.status(404).json(fail(404, 'Service not found'));
        return;
      }
      if (existing.owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const body = req.body || {};
      const now = getCurrentUtcString();
      const updated: Service = {
        ...existing,
        name: body.name ?? existing.name,
        description: body.description ?? existing.description,
        code: body.code ?? existing.code,
        apiCodes: body.apiCodes !== undefined ? toApiCodes(body.apiCodes) : existing.apiCodes,
        proxy: body.proxy ?? existing.proxy,
        grpc: body.grpc ?? existing.grpc,
        avatar: body.avatar ?? existing.avatar,
        codePackagePath: body.codePackagePath ?? existing.codePackagePath,
        updatedAt: now,
      };
      const serviceService = new ServiceService();
      await serviceService.save(updated);
      res.json(ok(updated));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update service failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/public/services/:uid', async (req: Request, res: Response) => {
    try {
      const uid = req.params.uid;
      const serviceRecord = await resolveByUid(uid);
      if (!serviceRecord) {
        res.status(404).json(fail(404, 'Service not found'));
        return;
      }
      res.json(ok(serviceRecord));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch service failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/public/services/:uid/config', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const serviceRecord = await resolveByUid(uid);
      if (!serviceRecord) {
        res.status(404).json(fail(404, 'Service not found'));
        return;
      }
      const serviceConfigService = new ServiceConfigService();
      const config = await serviceConfigService.getByServiceAndApplicant(uid, user.address.toLowerCase());
      res.json(ok({ config: config?.config || [] }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch service config failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.put('/api/v1/public/services/:uid/config', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const uid = req.params.uid;
      const serviceRecord = await resolveByUid(uid);
      if (!serviceRecord) {
        res.status(404).json(fail(404, 'Service not found'));
        return;
      }
      const body = req.body || {};
      const configItems = normalizeServiceConfig(body.config ?? body.domains ?? []);
      const now = getCurrentUtcString();
      const serviceConfigService = new ServiceConfigService();
      const saved = await serviceConfigService.upsert({
        uid: body.uid || uuidv4(),
        serviceUid: uid,
        serviceDid: serviceRecord.did,
        serviceVersion: serviceRecord.version,
        applicant: user.address.toLowerCase(),
        config: configItems,
        createdAt: body.createdAt || now,
        updatedAt: now,
      });
      res.json(ok(saved));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save service config failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.get('/api/v1/public/services/by-did', async (req: Request, res: Response) => {
    try {
      const did = String(req.query.did || '');
      const version = Number(req.query.version);
      if (!did || !Number.isFinite(version)) {
        res.status(400).json(fail(400, 'Missing did or version'));
        return;
      }
      const serviceRecord = await resolveByDid(did, version);
      if (!serviceRecord) {
        res.status(404).json(fail(404, 'Service not found'));
        return;
      }
      res.json(ok(serviceRecord));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch service failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.post('/api/v1/public/services/search', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const condition = body.condition || {};
      const { page, pageSize } = parsePage(body);
      const serviceService = new ServiceService();
      const result = await serviceService.search(condition, page, pageSize);
      res.json(
        ok({
          items: result.data || [],
          page: result.page,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Search services failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.delete('/api/v1/public/services/:uid', async (req: Request, res: Response) => {
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
        res.status(404).json(fail(404, 'Service not found'));
        return;
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && existing.owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const serviceService = new ServiceService();
      await serviceService.delete(existing.did, existing.version);
      res.json(ok({ deleted: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete service failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.post('/api/v1/public/services/:uid/publish', async (req: Request, res: Response) => {
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
        res.status(404).json(fail(404, 'Service not found'));
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
      const manager = new ServiceManager();
      await manager.updatePublishState(existing.did, existing.version, 'BUSINESS_STATUS_ONLINE', true);
      res.json(ok({ published: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish service failed';
      res.status(500).json(fail(500, message));
    }
  });

  app.post('/api/v1/public/services/:uid/unpublish', async (req: Request, res: Response) => {
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
        res.status(404).json(fail(404, 'Service not found'));
        return;
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && existing.owner !== user.address) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const manager = new ServiceManager();
      await manager.updatePublishState(existing.did, existing.version, 'BUSINESS_STATUS_OFFLINE', false);
      res.json(ok({ unpublished: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unpublish service failed';
      res.status(500).json(fail(500, message));
    }
  });
}
