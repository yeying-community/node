import { MigrationInterface, QueryRunner } from 'typeorm';

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

type ApplicationRow = {
  uid: string;
  name: string;
  code: string;
  location: string;
  service_codes: string;
  status: string;
  is_online: boolean;
  updated_at: string;
  created_at: string;
  ucan_audience: string;
  ucan_capabilities: string;
};

const CHAT_CODE = 'APPLICATION_CODE_CHAT';
const ROUTER_CODE = 'APPLICATION_CODE_ROUTER';
const ROUTER_WEB_PORT = '5181';
const ROUTER_API_PORT = '3011';
const DEFAULT_CAN = 'invoke';

function parseServiceCodes(raw: unknown): string[] {
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

function isApplicationOnline(app: ApplicationRow): boolean {
  const status = String(app.status || '').trim();
  if (status === 'BUSINESS_STATUS_ONLINE') {
    return true;
  }
  if (status === 'BUSINESS_STATUS_OFFLINE') {
    return false;
  }
  return Boolean(app.is_online);
}

function toUnixMs(raw: unknown): number {
  const parsed = Date.parse(String(raw || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareApplicationPriority(left: ApplicationRow, right: ApplicationRow): number {
  const leftOnline = isApplicationOnline(left) ? 1 : 0;
  const rightOnline = isApplicationOnline(right) ? 1 : 0;
  if (leftOnline !== rightOnline) {
    return rightOnline - leftOnline;
  }
  const leftUpdated = toUnixMs(left.updated_at || left.created_at);
  const rightUpdated = toUnixMs(right.updated_at || right.created_at);
  if (leftUpdated !== rightUpdated) {
    return rightUpdated - leftUpdated;
  }
  return 0;
}

function findDependencyTargetByName(
  apps: ApplicationRow[],
  currentUid: string,
  dependencyName: string
): ApplicationRow | null {
  const targetName = String(dependencyName || '').trim().toLowerCase();
  if (!targetName) {
    return null;
  }
  const matched = apps
    .filter((item) => item.uid !== currentUid)
    .filter((item) => String(item.location || '').trim())
    .filter((item) => parseLocationUrl(item.location))
    .filter((item) => String(item.name || '').trim().toLowerCase() === targetName)
    .sort(compareApplicationPriority);
  return matched.length > 0 ? matched[0] : null;
}

function findRouterTarget(apps: ApplicationRow[], currentUid: string): ApplicationRow | null {
  const matched = apps
    .filter((item) => item.uid !== currentUid)
    .filter((item) => String(item.code || '').trim() === ROUTER_CODE)
    .filter((item) => parseLocationUrl(item.location))
    .sort(compareApplicationPriority);
  return matched.length > 0 ? matched[0] : null;
}

function normalizePolicyTargetUrl(targetUrl: URL, targetCode?: string): URL {
  const cloned = new URL(targetUrl.toString());
  const code = String(targetCode || '').trim();
  if (code === ROUTER_CODE && cloned.port === ROUTER_WEB_PORT) {
    cloned.port = ROUTER_API_PORT;
  }
  return cloned;
}

function buildAudienceFromUrl(targetUrl: URL): string {
  const host = String(targetUrl.host || '').trim().toLowerCase();
  if (!host) {
    return '';
  }
  return `did:web:${host}`;
}

function buildCapabilityWithFromUrl(targetUrl: URL): string {
  const host = String(targetUrl.hostname || '').trim().toLowerCase();
  if (!host) {
    return '';
  }
  const port = String(targetUrl.port || '').trim();
  if (port) {
    return `app:all:${host}-${port}`;
  }
  return `app:all:${host}-*`;
}

function serializeCapabilities(withValue: string): string {
  if (!withValue) {
    return '';
  }
  return JSON.stringify([{ with: withValue, can: DEFAULT_CAN }]);
}

function resolvePolicy(
  app: ApplicationRow,
  apps: ApplicationRow[]
): { audience: string; capabilities: string } | null {
  const dependencyNames = parseServiceCodes(app.service_codes);
  let targetUrl: URL | null = null;
  let targetCode = String(app.code || '').trim();

  if (targetCode === CHAT_CODE) {
    const routerTarget = findRouterTarget(apps, app.uid);
    if (routerTarget) {
      targetUrl = parseLocationUrl(routerTarget.location);
      targetCode = String(routerTarget.code || '').trim();
    }
  }

  if (!targetUrl) {
    for (const dependencyName of dependencyNames) {
      const target = findDependencyTargetByName(apps, app.uid, dependencyName);
      if (!target) {
        continue;
      }
      targetUrl = parseLocationUrl(target.location);
      targetCode = String(target.code || '').trim();
      if (targetUrl) {
        break;
      }
    }
  }

  if (!targetUrl) {
    targetUrl = parseLocationUrl(app.location);
    targetCode = String(app.code || '').trim();
  }

  if (!targetUrl) {
    return null;
  }

  const normalizedTargetUrl = normalizePolicyTargetUrl(targetUrl, targetCode);
  const audience = buildAudienceFromUrl(normalizedTargetUrl);
  const capabilityWith = buildCapabilityWithFromUrl(normalizedTargetUrl);
  const capabilities = serializeCapabilities(capabilityWith);
  if (!audience || !capabilities) {
    return null;
  }
  return { audience, capabilities };
}

export class FixApplicationUcanPolicyRouterPriority20260424123000
  implements MigrationInterface
{
  name = 'FixApplicationUcanPolicyRouterPriority20260424123000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.options.type;
    if (dbType !== 'postgres') {
      throw new Error(
        `FixApplicationUcanPolicyRouterPriority20260424123000 only supports postgres, got ${dbType}`
      );
    }
    const schema = (queryRunner.connection.options.schema as string) || 'public';
    const schemaRef = quoteIdent(schema);

    const applications = (await queryRunner.query(
      `
      SELECT
        uid,
        name,
        code,
        location,
        service_codes,
        status,
        is_online,
        created_at,
        updated_at,
        ucan_audience,
        ucan_capabilities
      FROM ${schemaRef}."applications"
      `
    )) as ApplicationRow[];

    for (const app of applications) {
      const policy = resolvePolicy(app, applications);
      if (!policy) {
        continue;
      }
      const currentAudience = String(app.ucan_audience || '').trim();
      const currentCapabilities = String(app.ucan_capabilities || '').trim();
      if (
        currentAudience === policy.audience &&
        currentCapabilities === policy.capabilities
      ) {
        continue;
      }
      await queryRunner.query(
        `
        UPDATE ${schemaRef}."applications"
        SET
          ucan_audience = $1,
          ucan_capabilities = $2
        WHERE uid = $3
        `,
        [policy.audience, policy.capabilities, app.uid]
      );
    }
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op: data fix migration
  }
}
