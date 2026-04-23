import { Express, Request, Response } from 'express';
import { ok, fail } from '../../auth/envelope';
import { executeSignedAction, getActionSignatureErrorStatus } from '../../auth/actionSignature';
import { ApplicationService } from '../../domain/service/application';
import { Application } from '../../domain/model/application';
import { getRequestUser } from '../../common/requestContext';
import {
  ensureUserActive,
  ensureUserCanWriteBusinessData,
  isAdminUser,
} from '../../common/permission';
import { getCurrentUtcString } from '../../common/date';
import { v4 as uuidv4 } from 'uuid';
import { AuditManager } from '../../domain/manager/audit';
import { CommentManager } from '../../domain/manager/comments';
import { ApplicationManager } from '../../domain/manager/application';
import { ApplicationConfigService } from '../../domain/service/applicationConfig';

type UcanCapability = {
  with: string
  can: string
}

class RedirectUriSingleValueError extends Error {
  constructor() {
    super('Only one redirectUri is allowed')
    this.name = 'RedirectUriSingleValueError'
  }
}

function toServiceCodes(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(',');
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function toRedirectUriArray(value: unknown): string[] {
  const normalize = (input: unknown) => String(input ?? '').trim();
  const deduped = new Set<string>();
  const collect = (input: unknown) => {
    const normalized = normalize(input);
    if (!normalized) return;
    deduped.add(normalized);
  };

  if (Array.isArray(value)) {
    value.forEach((item) => collect(item));
    return [...deduped];
  }

  if (value === undefined || value === null) {
    return [];
  }

  const raw = normalize(value);
  if (!raw) {
    return [];
  }

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => collect(item));
        return [...deduped];
      }
    } catch {
      // fallback to split mode
    }
  }

  raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => collect(item));
  return [...deduped];
}

function toRedirectUrisStorage(value: unknown): string {
  const uris = toRedirectUriArray(value);
  if (uris.length === 0) {
    return '';
  }
  if (uris.length > 1) {
    throw new RedirectUriSingleValueError();
  }
  return uris[0];
}

function parseUcanCapabilities(value: unknown): UcanCapability[] {
  const values: UcanCapability[] = []
  const pushValue = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const source = entry as Record<string, unknown>
    const withValue =
      (typeof source.with === 'string' && source.with.trim()) ||
      (typeof source.resource === 'string' && source.resource.trim()) ||
      ''
    const canValue =
      (typeof source.can === 'string' && source.can.trim()) ||
      (typeof source.action === 'string' && source.action.trim()) ||
      ''
    if (!withValue || !canValue) {
      return
    }
    values.push({ with: withValue, can: canValue })
  }

  if (Array.isArray(value)) {
    value.forEach((item) => pushValue(item))
    return values
  }
  if (value === undefined || value === null) {
    return []
  }
  const raw = String(value).trim()
  if (!raw) {
    return []
  }
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => pushValue(item))
        return values
      }
    } catch {
      return []
    }
  }
  return []
}

function toUcanCapabilitiesStorage(value: unknown): string {
  const capabilities = parseUcanCapabilities(value)
  if (capabilities.length === 0) {
    return ''
  }
  return JSON.stringify(capabilities)
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

function normalizeAddress(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
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

async function canViewApplication(appRecord: Application, address: string) {
  if (appRecord.isOnline) {
    return true;
  }
  if (normalizeAddress(appRecord.owner) === normalizeAddress(address)) {
    return true;
  }
  return await isAdminUser(address);
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

function mapApplicationWriteError(error: unknown, fallback: string) {
  if (error instanceof RedirectUriSingleValueError) {
    return { status: 400, message: error.message };
  }
  const message = error instanceof Error ? error.message : fallback;
  const signatureStatus = getActionSignatureErrorStatus(message);
  const status =
    signatureStatus !== undefined
      ? signatureStatus
      : message === 'USER_BLOCKED' || message === 'USER_ROLE_DENIED'
      ? 403
      : 500;
  return { status, message };
}

function mapApplicationReadError(error: unknown, fallback: string) {
  if (error instanceof RedirectUriSingleValueError) {
    return { status: 400, message: error.message };
  }
  const message = error instanceof Error ? error.message : fallback;
  const status = message === 'USER_BLOCKED' ? 403 : 500;
  return { status, message };
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
      await ensureUserCanWriteBusinessData(user.address);
      const body = req.body || {};
      const redirectUrisStorage = toRedirectUrisStorage(body.redirectUris);
      const owner = String(body.owner || user.address).trim();
      if (normalizeAddress(owner) !== normalizeAddress(user.address)) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const did = String(body.did || '').trim();
      const version = Number(body.version);
      if (!did || !Number.isFinite(version)) {
        res.status(400).json(fail(400, 'Missing did or version'));
        return;
      }
      const signablePayload = {
        requestedUid: body.uid ? String(body.uid).trim() : '',
        owner,
        ownerName: String(body.ownerName || owner),
        network: String(body.network || ''),
        address: String(body.address || ''),
        did,
        version,
        name: String(body.name || ''),
        description: String(body.description || ''),
        code: String(body.code || 'APPLICATION_CODE_UNKNOWN'),
        location: String(body.location || ''),
        serviceCodes: toServiceCodes(body.serviceCodes),
        redirectUris: redirectUrisStorage ? [redirectUrisStorage] : [],
        ucanAudience: String(body.ucanAudience || '').trim(),
        ucanCapabilities: parseUcanCapabilities(body.ucanCapabilities),
        avatar: String(body.avatar || ''),
        codePackagePath: String(body.codePackagePath || ''),
      };
      const result = await executeSignedAction({
        raw: body,
        action: 'application_create',
        actor: user.address,
        payload: signablePayload,
        execute: async () => {
          if (body.uid) {
            const existingByUid = await resolveByUid(String(body.uid));
            if (existingByUid) {
              return { status: 409, body: fail(409, 'Application uid already exists') };
            }
          }
          const existingByDid = await resolveByDid(did, version);
          if (existingByDid) {
            return { status: 409, body: fail(409, 'Application already exists') };
          }
          const now = getCurrentUtcString();
          const application: Application = {
            uid: body.uid || uuidv4(),
            owner,
            ownerName: body.ownerName || owner,
            network: body.network || '',
            address: body.address || '',
            did,
            version,
            name: body.name || '',
            description: body.description || '',
            code: body.code || 'APPLICATION_CODE_UNKNOWN',
            location: body.location || '',
            serviceCodes: toServiceCodes(body.serviceCodes),
            redirectUris: redirectUrisStorage,
            ucanAudience: String(body.ucanAudience || '').trim(),
            ucanCapabilities: toUcanCapabilitiesStorage(body.ucanCapabilities),
            avatar: body.avatar || '',
            createdAt: body.createdAt || now,
            updatedAt: now,
            signature: body.signature || '',
            codePackagePath: body.codePackagePath || '',
            status: 'BUSINESS_STATUS_PENDING',
            isOnline: false,
          };
          const service = new ApplicationService();
          await service.save(application);
          return { status: 200, body: ok(application) };
        },
        onError: (error) => {
          const { status, message } = mapApplicationWriteError(error, 'Create application failed');
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Create application failed');
      res.status(status).json(fail(status, message));
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
      await ensureUserCanWriteBusinessData(user.address);
      const uid = req.params.uid;
      const body = req.body || {};
      const redirectUrisStorage =
        body.redirectUris !== undefined && body.redirectUris !== null
          ? toRedirectUrisStorage(body.redirectUris)
          : undefined;
      const result = await executeSignedAction({
        raw: body,
        action: 'application_update',
        actor: user.address,
        payload: {
          applicationUid: uid,
          name: body.name !== undefined && body.name !== null ? String(body.name) : undefined,
          description: body.description !== undefined && body.description !== null ? String(body.description) : undefined,
          location: body.location !== undefined && body.location !== null ? String(body.location) : undefined,
          code: body.code !== undefined && body.code !== null ? String(body.code) : undefined,
          serviceCodes:
            body.serviceCodes !== undefined && body.serviceCodes !== null
              ? toServiceCodes(body.serviceCodes)
              : undefined,
          redirectUris:
            redirectUrisStorage !== undefined
              ? redirectUrisStorage
                ? [redirectUrisStorage]
                : []
              : undefined,
          ucanAudience:
            body.ucanAudience !== undefined && body.ucanAudience !== null
              ? String(body.ucanAudience).trim()
              : undefined,
          ucanCapabilities:
            body.ucanCapabilities !== undefined && body.ucanCapabilities !== null
              ? parseUcanCapabilities(body.ucanCapabilities)
              : undefined,
          avatar: body.avatar !== undefined && body.avatar !== null ? String(body.avatar) : undefined,
          codePackagePath:
            body.codePackagePath !== undefined && body.codePackagePath !== null
              ? String(body.codePackagePath)
              : undefined,
        },
        execute: async () => {
          const existing = await resolveByUid(uid);
          if (!existing) {
            return { status: 404, body: fail(404, 'Application not found') };
          }
          const isAdmin = await isAdminUser(user.address);
          if (!isAdmin && normalizeAddress(existing.owner) !== normalizeAddress(user.address)) {
            return { status: 403, body: fail(403, 'Owner mismatch') };
          }
          const now = getCurrentUtcString();
          const updated: Application = {
            ...existing,
            name: body.name ?? existing.name,
            description: body.description ?? existing.description,
            location: body.location ?? existing.location,
            code: body.code ?? existing.code,
            serviceCodes: body.serviceCodes !== undefined ? toServiceCodes(body.serviceCodes) : existing.serviceCodes,
            redirectUris:
              redirectUrisStorage !== undefined ? redirectUrisStorage : existing.redirectUris || '',
            ucanAudience:
              body.ucanAudience !== undefined
                ? String(body.ucanAudience || '').trim()
                : existing.ucanAudience || '',
            ucanCapabilities:
              body.ucanCapabilities !== undefined
                ? toUcanCapabilitiesStorage(body.ucanCapabilities)
                : existing.ucanCapabilities || '',
            avatar: body.avatar ?? existing.avatar,
            codePackagePath: body.codePackagePath ?? existing.codePackagePath,
            updatedAt: now,
          };
          const service = new ApplicationService();
          await service.save(updated);
          return { status: 200, body: ok(updated) };
        },
        onError: (error) => {
          const { status, message } = mapApplicationWriteError(error, 'Update application failed');
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Update application failed');
      res.status(status).json(fail(status, message));
    }
  });

  app.get('/api/v1/public/applications/:uid', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      const uid = req.params.uid;
      const appRecord = await resolveByUid(uid);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      const visible = await canViewApplication(appRecord, user.address);
      if (!visible) {
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
      const visible = await canViewApplication(appRecord, user.address);
      if (!visible) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      const applicationConfigService = new ApplicationConfigService();
      const config = await applicationConfigService.getByApplicationAndApplicant(uid, user.address.toLowerCase());
      res.json(ok({ config: config?.config || [] }));
    } catch (error) {
      const { status, message } = mapApplicationReadError(error, 'Fetch application config failed');
      res.status(status).json(fail(status, message));
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
      await ensureUserCanWriteBusinessData(user.address);
      const uid = req.params.uid;
      const body = req.body || {};
      const configItems = normalizeApplicationConfig(body.config ?? body.domains ?? []);
      const result = await executeSignedAction({
        raw: body,
        action: 'application_config_upsert',
        actor: user.address,
        payload: {
          applicationUid: uid,
          applicant: user.address.toLowerCase(),
          config: configItems,
        },
        execute: async () => {
          const appRecord = await resolveByUid(uid);
          if (!appRecord) {
            return { status: 404, body: fail(404, 'Application not found') };
          }
          const visible = await canViewApplication(appRecord, user.address);
          if (!visible) {
            return { status: 404, body: fail(404, 'Application not found') };
          }
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
          return { status: 200, body: ok(saved) };
        },
        onError: (error) => {
          const { status, message } = mapApplicationWriteError(error, 'Save application config failed');
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Save application config failed');
      res.status(status).json(fail(status, message));
    }
  });

  app.get('/api/v1/public/applications/by-did', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
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
      const visible = await canViewApplication(appRecord, user.address);
      if (!visible) {
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
      const condition = body.condition || body || {};
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
      await ensureUserCanWriteBusinessData(user.address);
      const uid = req.params.uid;
      const body = req.body || {};
      const result = await executeSignedAction({
        raw: body,
        action: 'application_delete',
        actor: user.address,
        payload: {
          applicationUid: uid,
        },
        execute: async () => {
          const existing = await resolveByUid(uid);
          if (!existing) {
            return { status: 404, body: fail(404, 'Application not found') };
          }
          const isAdmin = await isAdminUser(user.address);
          if (!isAdmin && normalizeAddress(existing.owner) !== normalizeAddress(user.address)) {
            return { status: 403, body: fail(403, 'Owner mismatch') };
          }
          const service = new ApplicationService();
          await service.delete(existing.did, existing.version);
          return { status: 200, body: ok({ deleted: true }) };
        },
        onError: (error) => {
          const { status, message } = mapApplicationWriteError(error, 'Delete application failed');
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Delete application failed');
      res.status(status).json(fail(status, message));
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
      await ensureUserCanWriteBusinessData(user.address);
      const uid = req.params.uid;
      const body = req.body || {};
      const result = await executeSignedAction({
        raw: body,
        action: 'application_publish',
        actor: user.address,
        payload: {
          applicationUid: uid,
        },
        execute: async () => {
          const existing = await resolveByUid(uid);
          if (!existing) {
            return { status: 404, body: fail(404, 'Application not found') };
          }
          const isAdmin = await isAdminUser(user.address);
          if (!isAdmin && normalizeAddress(existing.owner) !== normalizeAddress(user.address)) {
            return { status: 403, body: fail(403, 'Owner mismatch') };
          }
          const approved = await hasApprovedAudit(existing.did, existing.version);
          if (!approved) {
            return { status: 403, body: fail(403, 'Audit not approved') };
          }
          const manager = new ApplicationManager();
          await manager.updatePublishState(existing.did, existing.version, 'BUSINESS_STATUS_ONLINE', true);
          return { status: 200, body: ok({ published: true }) };
        },
        onError: (error) => {
          const { status, message } = mapApplicationWriteError(error, 'Publish application failed');
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Publish application failed');
      res.status(status).json(fail(status, message));
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
      await ensureUserCanWriteBusinessData(user.address);
      const uid = req.params.uid;
      const body = req.body || {};
      const result = await executeSignedAction({
        raw: body,
        action: 'application_unpublish',
        actor: user.address,
        payload: {
          applicationUid: uid,
        },
        execute: async () => {
          const existing = await resolveByUid(uid);
          if (!existing) {
            return { status: 404, body: fail(404, 'Application not found') };
          }
          const isAdmin = await isAdminUser(user.address);
          if (!isAdmin && normalizeAddress(existing.owner) !== normalizeAddress(user.address)) {
            return { status: 403, body: fail(403, 'Owner mismatch') };
          }
          const manager = new ApplicationManager();
          await manager.updatePublishState(existing.did, existing.version, 'BUSINESS_STATUS_OFFLINE', false);
          return { status: 200, body: ok({ unpublished: true }) };
        },
        onError: (error) => {
          const { status, message } = mapApplicationWriteError(error, 'Unpublish application failed');
          return { status, body: fail(status, message) };
        },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Unpublish application failed');
      res.status(status).json(fail(status, message));
    }
  });
}
