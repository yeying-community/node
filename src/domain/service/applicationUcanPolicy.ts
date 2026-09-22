import { Application } from '../model/application';
import { ApplicationService } from './application';

export type ApplicationUcanCapability = {
  with: string;
  can: string;
};

export type ApplicationUcanPolicy = {
  audience: string;
  capabilities: ApplicationUcanCapability[];
  audiences: string[];
  capabilitiesByAudience: Record<string, ApplicationUcanCapability[]>;
  source: 'dependency' | 'router' | 'self';
  targetUid?: string;
  targetName?: string;
  targetLocation: string;
};

export class ApplicationUcanPolicyError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ApplicationUcanPolicyError';
    this.status = status;
    this.code = code;
  }
}

const MAX_POLICY_SEARCH_SIZE = 1000;
const DEFAULT_CAN = 'invoke';
const ROUTER_CODE = 'APPLICATION_CODE_ROUTER';
const CHAT_CODE = 'APPLICATION_CODE_CHAT';

function parseServiceCodes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(
        raw
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );
  }
  const text = String(raw || '').trim();
  if (!text) {
    return [];
  }
  return Array.from(
    new Set(
      text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function parseLocationUrl(raw: unknown): URL | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return new URL(text);
  } catch {
    try {
      return new URL(`http://${text}`);
    } catch {
      return null;
    }
  }
}

function isApplicationOnline(app: Application): boolean {
  if (app.status === 'BUSINESS_STATUS_ONLINE') {
    return true;
  }
  if (app.status === 'BUSINESS_STATUS_OFFLINE') {
    return false;
  }
  return Boolean(app.isOnline);
}

function toUnixMs(raw: unknown): number {
  const parsed = Date.parse(String(raw || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareApplicationPriority(left: Application, right: Application): number {
  const leftOnline = isApplicationOnline(left) ? 1 : 0;
  const rightOnline = isApplicationOnline(right) ? 1 : 0;
  if (leftOnline !== rightOnline) {
    return rightOnline - leftOnline;
  }
  const leftUpdated = toUnixMs(left.updatedAt || left.createdAt);
  const rightUpdated = toUnixMs(right.updatedAt || right.createdAt);
  if (leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated;
  }
  return Number(right.version || 0) - Number(left.version || 0);
}

function findDependencyTargetByName(apps: Application[], name: string): Application | null {
  const targetName = String(name || '').trim().toLowerCase();
  if (!targetName) {
    return null;
  }
  const matched = apps
    .filter((item) => String(item.name || '').trim().toLowerCase() === targetName)
    .filter((item) => Boolean(parseLocationUrl(item.location)))
    .sort(compareApplicationPriority);
  return matched.length > 0 ? matched[0] : null;
}

function findRouterTarget(apps: Application[]): Application | null {
  const matched = apps
    .filter((item) => {
      const code = String(item.code || '').trim();
      const name = String(item.name || '').trim().toLowerCase();
      return code === ROUTER_CODE || code === 'aggregation' || name === 'router';
    })
    .filter((item) => Boolean(parseLocationUrl(item.location)))
    .sort(compareApplicationPriority);
  return matched.length > 0 ? matched[0] : null;
}

function buildAudienceFromUrl(targetUrl: URL): string {
  const host = String(targetUrl.host || '').trim().toLowerCase();
  if (!host) {
    throw new ApplicationUcanPolicyError(
      'APP_UCAN_POLICY_AUDIENCE_INVALID',
      'Cannot derive UCAN audience from target location'
    );
  }
  return `did:web:${host}`;
}

function buildCapabilityWithFromAppId(appId?: string): string {
  const normalized = String(appId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-');
  if (!normalized) {
    throw new ApplicationUcanPolicyError(
      'APP_UCAN_POLICY_CAPABILITY_INVALID',
      'Cannot derive UCAN capability resource from application uid'
    );
  }
  return `app:all:${normalized}`;
}

function normalizeTargetLocation(targetUrl: URL): string {
  const cloned = new URL(targetUrl.toString());
  cloned.hash = '';
  return cloned.toString();
}

export function serializeApplicationUcanCapabilities(
  capabilities: Array<
    | ApplicationUcanCapability
    | {
        with?: string;
        resource?: string;
        can?: string;
        action?: string;
      }
  >
): string {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return '';
  }
  const normalized = capabilities
    .map((item) => {
      const source = item as {
        with?: string;
        resource?: string;
        can?: string;
        action?: string;
      };
      return {
        with: String(source.with || source.resource || '').trim(),
        can: String(source.can || source.action || '').trim(),
      };
    })
    .filter((item) => item.with && item.can);
  if (normalized.length === 0) {
    return '';
  }
  return JSON.stringify(normalized);
}

export async function resolveApplicationUcanPolicy(input: {
  uid?: string;
  code?: string;
  location?: string;
  serviceCodes?: string | string[];
}): Promise<ApplicationUcanPolicy> {
  const appCode = String(input.code || '').trim();
  const dependencyNames = parseServiceCodes(input.serviceCodes);
  const selfTargetUrl = parseLocationUrl(input.location);

  const service = new ApplicationService();
  const searchResult = await service.search({ includeOffline: true }, 1, MAX_POLICY_SEARCH_SIZE);
  const apps = (searchResult.data || []).filter(
    (item) => item.uid && item.uid !== String(input.uid || '').trim()
  );

  let source: ApplicationUcanPolicy['source'] = 'self';
  const targets: Array<{ app: Application | null; url: URL; source: ApplicationUcanPolicy['source'] }> = [];

  if (appCode === CHAT_CODE || dependencyNames.some((name) => name.toLowerCase() === 'router')) {
    const routerTarget = findRouterTarget(apps);
    const routerUrl = routerTarget ? parseLocationUrl(routerTarget.location) : null;
    if (routerTarget && routerUrl) {
      targets.push({ app: routerTarget, url: routerUrl, source: 'router' });
      source = 'router';
    }
  }

  for (const dependencyName of dependencyNames) {
    const matched = findDependencyTargetByName(apps, dependencyName);
    if (!matched) {
      continue;
    }
    const matchedUrl = parseLocationUrl(matched.location);
    if (!matchedUrl) {
      continue;
    }
    if (!targets.some((target) => target.app?.uid === matched.uid)) {
      targets.push({ app: matched, url: matchedUrl, source: 'dependency' });
    }
    if (source === 'self') source = 'dependency';
  }

  if (targets.length === 0 && selfTargetUrl) {
    targets.push({ app: null, url: selfTargetUrl, source: 'self' });
    source = 'self';
  }

  if (targets.length === 0) {
    throw new ApplicationUcanPolicyError(
      'APP_UCAN_POLICY_TARGET_NOT_FOUND',
      '无法自动推导 UCAN 策略：请填写有效访问地址或配置可用依赖应用'
    );
  }

  const audiences: string[] = [];
  const capabilitiesByAudience: Record<string, ApplicationUcanCapability[]> = {};
  let primaryTarget: { app: Application | null; url: URL; source: ApplicationUcanPolicy['source'] } | undefined;
  for (const target of targets) {
    const normalizedTargetUrl = target.url;
    const audience = buildAudienceFromUrl(normalizedTargetUrl);
    if (audiences.includes(audience)) continue;
    const capabilityWith = buildCapabilityWithFromAppId(input.uid);
    const capabilityCan =
      target.app && (target.app.code === ROUTER_CODE || target.app.code === 'aggregation' || target.app.name.toLowerCase() === 'router')
        ? 'invoke'
        : 'write';
    audiences.push(audience);
    capabilitiesByAudience[audience] = [{ with: capabilityWith, can: capabilityCan }];
    primaryTarget ||= { ...target, url: normalizedTargetUrl };
  }
  const firstAudience = audiences[0];
  const firstCapabilities = capabilitiesByAudience[firstAudience] || [];
  const normalizedTargetUrl = primaryTarget?.url || selfTargetUrl;
  return {
    audience: firstAudience,
    capabilities: firstCapabilities,
    audiences,
    capabilitiesByAudience,
    source,
    targetUid: primaryTarget?.app?.uid,
    targetName: primaryTarget?.app?.name,
    targetLocation: normalizedTargetUrl ? normalizeTargetLocation(normalizedTargetUrl) : '',
  };
}
