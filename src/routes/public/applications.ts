import { Express, Request, Response } from 'express';
import { ok, fail } from '../../auth/envelope';
import { assertActionSignature, executeSignedAction, getActionSignatureErrorStatus } from '../../auth/actionSignature';
import { ApplicationService } from '../../domain/service/application';
import { Application, SearchCondition } from '../../domain/model/application';
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
import { NotificationService } from '../../domain/service/notification';
import { PusherService } from '../../domain/service/pusher';
import {
  ApplicationUcanPolicyError,
  resolveApplicationUcanPolicy,
  serializeApplicationUcanCapabilities,
} from '../../domain/service/applicationUcanPolicy';

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

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return undefined;
}

function normalizeAddress(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildApplicationSearchCondition(input: Record<string, unknown>): SearchCondition {
  const condition: SearchCondition = {};
  const did = String(input.did ?? '').trim();
  const version = Number(input.version);
  const code = String(input.code ?? '').trim();
  const owner = String(input.owner ?? '').trim();
  const name = String(input.name ?? '').trim();
  const keyword = String(input.keyword ?? '').trim();
  const status = String(input.status ?? '').trim();
  const isOnline = parseOptionalBoolean(input.isOnline);
  const includeOffline = parseOptionalBoolean(input.includeOffline);
  if (did) condition.did = did;
  if (Number.isFinite(version)) condition.version = version;
  if (code) condition.code = code;
  if (owner) condition.owner = owner;
  if (name) condition.name = name;
  if (keyword) condition.keyword = keyword;
  if (status) condition.status = status;
  if (isOnline !== undefined) condition.isOnline = isOnline;
  if (includeOffline !== undefined) condition.includeOffline = includeOffline;
  return condition;
}

async function scopeApplicationSearchCondition(condition: SearchCondition, address: string): Promise<SearchCondition> {
  if (!condition.includeOffline) {
    return condition;
  }
  const isAdmin = await isAdminUser(address);
  if (isAdmin || normalizeAddress(condition.owner) === normalizeAddress(address)) {
    return condition;
  }
  return { ...condition, includeOffline: false, isOnline: condition.isOnline ?? true };
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)));
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return [];
  }
  return Array.from(new Set(text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)));
}

function normalizeOrigin(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    return url.origin.toLowerCase();
  } catch {
    return '';
  }
}

function deriveAllowedOrigins(appRecord: Application, requested: unknown): string[] {
  const explicit = normalizeStringList(requested)
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }
  return Array.from(
    new Set(
      [appRecord.location, ...toRedirectUriArray(appRecord.redirectUris)]
        .map((item) => normalizeOrigin(item))
        .filter(Boolean)
    )
  );
}

function derivePusherCredentialAppId(appRecord: Application, requested: unknown): string {
  const explicit = String(requested ?? '').trim();
  if (explicit) {
    return explicit;
  }
  return `app.${appRecord.uid}`;
}

function hasOwnProperty(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
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
  if (error instanceof ApplicationUcanPolicyError) {
    return { status: error.status, message: error.message };
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
  const notificationService = new NotificationService();

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
      const serviceCodes = toServiceCodes(body.serviceCodes);
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
        serviceCodes,
        redirectUris: redirectUrisStorage ? [redirectUrisStorage] : [],
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
          const uid = body.uid || uuidv4();
          const policy = await resolveApplicationUcanPolicy({
            uid,
            code: body.code,
            location: body.location,
            serviceCodes,
          });
          const application: Application = {
            uid,
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
            serviceCodes,
            redirectUris: redirectUrisStorage,
            ucanAudience: policy.audience,
            ucanCapabilities: serializeApplicationUcanCapabilities(policy.capabilities),
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
          await notificationService.notifyApplicationCreated({
            applicationUid: application.uid,
            owner: application.owner,
            actor: user.address,
            name: application.name,
            did: application.did,
            version: application.version,
          });
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

  app.get('/api/v1/public/applications', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const { page, pageSize } = parsePage(req.query);
      const condition = buildApplicationSearchCondition(req.query as Record<string, unknown>);
      if (condition.did && Number.isFinite(Number(condition.version))) {
        const appRecord = await resolveByDid(condition.did, Number(condition.version));
        const visible = appRecord ? await canViewApplication(appRecord, user.address) : false;
        res.json(ok({
          items: visible && appRecord ? [appRecord] : [],
          page: { total: visible && appRecord ? 1 : 0, page, pageSize },
        }));
        return;
      }
      const service = new ApplicationService();
      const result = await service.search(
        await scopeApplicationSearchCondition(condition, user.address),
        page,
        pageSize
      );
      res.json(
        ok({
          items: result.data,
          page: result.page,
        })
      );
    } catch (error) {
      const { status, message } = mapApplicationReadError(error, 'Query applications failed');
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
          const serviceCodes =
            body.serviceCodes !== undefined ? toServiceCodes(body.serviceCodes) : existing.serviceCodes;
          const policy = await resolveApplicationUcanPolicy({
            uid: existing.uid,
            code: body.code ?? existing.code,
            location: body.location ?? existing.location,
            serviceCodes,
          });
          const now = getCurrentUtcString();
          const updated: Application = {
            ...existing,
            name: body.name ?? existing.name,
            description: body.description ?? existing.description,
            location: body.location ?? existing.location,
            code: body.code ?? existing.code,
            serviceCodes,
            redirectUris:
              redirectUrisStorage !== undefined ? redirectUrisStorage : existing.redirectUris || '',
            ucanAudience: policy.audience,
            ucanCapabilities: serializeApplicationUcanCapabilities(policy.capabilities),
            avatar: body.avatar ?? existing.avatar,
            codePackagePath: body.codePackagePath ?? existing.codePackagePath,
            updatedAt: now,
          };
          const service = new ApplicationService();
          await service.save(updated);
          await notificationService.notifyApplicationUpdated({
            applicationUid: updated.uid,
            owner: updated.owner,
            actor: user.address,
            name: updated.name,
            did: updated.did,
            version: updated.version,
          });
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
          await notificationService.notifyApplicationConfigUpdated({
            applicationUid: appRecord.uid,
            owner: user.address.toLowerCase(),
            actor: user.address,
            name: appRecord.name,
            did: appRecord.did,
            version: appRecord.version,
            configCount: configItems.length,
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

  app.get('/api/v1/public/applications/:uid/pusher/credentials', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const applicationUid = req.params.uid;
      const appRecord = await resolveByUid(applicationUid);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      if (normalizeAddress(appRecord.owner) !== normalizeAddress(user.address)) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const credentials = await new PusherService().getAppByApplicationUid(applicationUid);
      if (!credentials) {
        res.status(404).json(fail(404, 'Pusher app not found for application'));
        return;
      }
      res.json(ok(credentials));
    } catch (error) {
      const { status, message } = mapApplicationReadError(error, 'Fetch pusher credentials failed');
      res.status(status).json(fail(status, message));
    }
  });

  app.post('/api/v1/public/applications/:uid/pusher/credentials', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      await ensureUserCanWriteBusinessData(user.address);
      const applicationUid = req.params.uid;
      const body = req.body || {};
      const appRecord = await resolveByUid(applicationUid);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      if (normalizeAddress(appRecord.owner) !== normalizeAddress(user.address)) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const pusherAppId = derivePusherCredentialAppId(appRecord, body.pusherAppId);
      const allowedOrigins = deriveAllowedOrigins(appRecord, body.allowedOrigins);
      try {
        await assertActionSignature({
          raw: body,
          action: 'application_pusher_credentials_create',
          actor: user.address,
          payload: {
            applicationUid,
            pusherAppId,
            allowedOrigins,
          },
        });
      } catch (error) {
        const { status, message } = mapApplicationWriteError(error, 'Create pusher credentials failed');
        res.status(status).json(fail(status, message));
        return;
      }
      try {
        const created = await new PusherService().createApp({
          appId: pusherAppId,
          applicationUid: appRecord.uid,
          owner: user.address,
          allowedOrigins,
          channelPatterns: ['public-*', 'private-user.*', 'private-project.*'],
        });
        res.json(ok(created));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Create pusher credentials failed';
        const status = message.includes('already exists') ? 409 : 400;
        res.status(status).json(fail(status, message));
      }
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Create pusher credentials failed');
      res.status(status).json(fail(status, message));
    }
  });

  app.post('/api/v1/public/applications/:uid/pusher/credentials/rotations', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      await ensureUserCanWriteBusinessData(user.address);
      const applicationUid = req.params.uid;
      const body = req.body || {};
      const appRecord = await resolveByUid(applicationUid);
      if (!appRecord) {
        res.status(404).json(fail(404, 'Application not found'));
        return;
      }
      if (normalizeAddress(appRecord.owner) !== normalizeAddress(user.address)) {
        res.status(403).json(fail(403, 'Owner mismatch'));
        return;
      }
      const signablePayload: Record<string, unknown> = { applicationUid };
      const rotationInput: { applicationUid: string; allowedOrigins?: string[] } = { applicationUid };
      if (hasOwnProperty(body, 'allowedOrigins')) {
        const allowedOrigins = deriveAllowedOrigins(appRecord, body.allowedOrigins);
        signablePayload.allowedOrigins = allowedOrigins;
        rotationInput.allowedOrigins = allowedOrigins;
      }
      try {
        await assertActionSignature({
          raw: body,
          action: 'application_pusher_credentials_rotate',
          actor: user.address,
          payload: signablePayload,
        });
      } catch (error) {
        const { status, message } = mapApplicationWriteError(error, 'Rotate pusher credentials failed');
        res.status(status).json(fail(status, message));
        return;
      }
      try {
        const rotated = await new PusherService().rotateAppCredentials(rotationInput);
        res.json(ok(rotated));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rotate pusher credentials failed';
        const status = message.includes('not found') ? 404 : 400;
        res.status(status).json(fail(status, message));
      }
    } catch (error) {
      const { status, message } = mapApplicationWriteError(error, 'Rotate pusher credentials failed');
      res.status(status).json(fail(status, message));
    }
  });

  app.post('/api/v1/public/applications/search', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        res.status(401).json(fail(401, 'Missing access token'));
        return;
      }
      await ensureUserActive(user.address);
      const body = req.body || {};
      const condition = buildApplicationSearchCondition(body.condition || body || {});
      const { page, pageSize } = parsePage(body);
      const service = new ApplicationService();
      const result = await service.search(
        await scopeApplicationSearchCondition(condition, user.address),
        page,
        pageSize
      );
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
          await notificationService.notifyApplicationDeleted({
            applicationUid: existing.uid,
            owner: existing.owner,
            actor: user.address,
            name: existing.name,
            did: existing.did,
            version: existing.version,
          });
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
          await notificationService.notifyApplicationPublished({
            applicationUid: existing.uid,
            owner: existing.owner,
            actor: user.address,
            name: existing.name,
            did: existing.did,
            version: existing.version,
          });
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
          await notificationService.notifyApplicationUnpublished({
            applicationUid: existing.uid,
            owner: existing.owner,
            actor: user.address,
            name: existing.name,
            did: existing.did,
            version: existing.version,
          });
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
