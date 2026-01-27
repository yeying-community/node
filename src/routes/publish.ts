import { Express, Request, Response } from 'express';
import { Api } from '../models';
import { ApplicationManager } from '../domain/manager/application';
import { ServiceManager } from '../domain/manager/service';
import { AuditManager } from '../domain/manager/audit';
import { CommentManager } from '../domain/manager/comments';
import { getRequestUser } from '../common/requestContext';
import { ensureUserActive, isAdminUser } from '../common/permission';

const AGREE_STATUS = 'COMMENT_STATUS_AGREE';

function getRequestTarget(req: Request) {
  const did = req.body?.body?.did;
  const version = req.body?.body?.version;
  return { did, version };
}

function respondOk(res: Response) {
  res.status(200).json({
    header: {},
    body: {
      status: {
        code: Api.CommonResponseCodeEnum.OK,
      },
    },
  });
}

function respondError(res: Response, status: number, message: string) {
  res.status(status).json({ code: status, message });
}

async function hasApprovedAudit(targetType: 'application' | 'service', did: string, version: number) {
  const auditManager = new AuditManager();
  const commentManager = new CommentManager();
  const audits = await auditManager.queryByTarget(targetType, did, version);
  for (const audit of audits) {
    if (audit.auditType && audit.auditType !== targetType) {
      continue;
    }
    if (!audit.appOrServiceMetadata) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(audit.appOrServiceMetadata);
    } catch {
      continue;
    }
    const metadataType = parsed.operateType || audit.auditType;
    if (metadataType !== targetType) continue;
    if (parsed.did !== did || Number(parsed.version) !== Number(version)) continue;
    const comments = await commentManager.queryByAuditId(audit.uid);
    if (!comments || comments.length === 0) continue;
    const latest = comments
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .pop();
    if (latest?.status === AGREE_STATUS) {
      return true;
    }
  }
  return false;
}

export function registerPublishRoutes(app: Express) {
  app.post('/api/v1/application/publish', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        return respondError(res, 401, 'Missing access token');
      }
      await ensureUserActive(user.address);
      const { did, version } = getRequestTarget(req);
      if (!did || version === undefined) {
        return respondError(res, 400, 'Missing did or version');
      }
      const manager = new ApplicationManager();
      const appRecord = await manager.query(did, Number(version));
      if (!appRecord) {
        return respondError(res, 404, 'Application not found');
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && appRecord.owner !== user.address) {
        return respondError(res, 403, 'Owner mismatch');
      }
      const approved = await hasApprovedAudit('application', did, Number(version));
      if (!approved) {
        return respondError(res, 403, 'Audit not approved');
      }
      await manager.updatePublishState(did, Number(version), 'BUSINESS_STATUS_ONLINE', true);
      return respondOk(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed';
      return respondError(res, 500, message);
    }
  });

  app.post('/api/v1/application/unpublish', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        return respondError(res, 401, 'Missing access token');
      }
      await ensureUserActive(user.address);
      const { did, version } = getRequestTarget(req);
      if (!did || version === undefined) {
        return respondError(res, 400, 'Missing did or version');
      }
      const manager = new ApplicationManager();
      const appRecord = await manager.query(did, Number(version));
      if (!appRecord) {
        return respondError(res, 404, 'Application not found');
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && appRecord.owner !== user.address) {
        return respondError(res, 403, 'Owner mismatch');
      }
      await manager.updatePublishState(did, Number(version), 'BUSINESS_STATUS_OFFLINE', false);
      return respondOk(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unpublish failed';
      return respondError(res, 500, message);
    }
  });

  app.post('/api/v1/service/publish', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        return respondError(res, 401, 'Missing access token');
      }
      await ensureUserActive(user.address);
      const { did, version } = getRequestTarget(req);
      if (!did || version === undefined) {
        return respondError(res, 400, 'Missing did or version');
      }
      const manager = new ServiceManager();
      const serviceRecord = await manager.query(did, Number(version));
      if (!serviceRecord) {
        return respondError(res, 404, 'Service not found');
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && serviceRecord.owner !== user.address) {
        return respondError(res, 403, 'Owner mismatch');
      }
      const approved = await hasApprovedAudit('service', did, Number(version));
      if (!approved) {
        return respondError(res, 403, 'Audit not approved');
      }
      await manager.updatePublishState(did, Number(version), 'BUSINESS_STATUS_ONLINE', true);
      return respondOk(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Publish failed';
      return respondError(res, 500, message);
    }
  });

  app.post('/api/v1/service/unpublish', async (req: Request, res: Response) => {
    try {
      const user = getRequestUser();
      if (!user?.address) {
        return respondError(res, 401, 'Missing access token');
      }
      await ensureUserActive(user.address);
      const { did, version } = getRequestTarget(req);
      if (!did || version === undefined) {
        return respondError(res, 400, 'Missing did or version');
      }
      const manager = new ServiceManager();
      const serviceRecord = await manager.query(did, Number(version));
      if (!serviceRecord) {
        return respondError(res, 404, 'Service not found');
      }
      const isAdmin = await isAdminUser(user.address);
      if (!isAdmin && serviceRecord.owner !== user.address) {
        return respondError(res, 403, 'Owner mismatch');
      }
      await manager.updatePublishState(did, Number(version), 'BUSINESS_STATUS_OFFLINE', false);
      return respondOk(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unpublish failed';
      return respondError(res, 500, message);
    }
  });
}
