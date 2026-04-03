import { UserService } from '../domain/service/user';
import { getCurrentUtcString } from './date';
import {
  USER_ROLE_NORMAL,
  USER_ROLE_OWNER,
  USER_ROLE_UNKNOWN,
  USER_STATUS_ACTIVE,
  USER_STATUS_DELETED,
  USER_STATUS_DISABLE,
  USER_STATUS_FREEZE,
  USER_STATUS_LOCK,
  UserState,
} from '../domain/model/user';

const ADMIN_ROLE = USER_ROLE_OWNER;
const BUSINESS_WRITE_ROLES = new Set([USER_ROLE_OWNER, USER_ROLE_NORMAL]);
const APPROVER_ROLES = new Set([USER_ROLE_OWNER]);
const BLOCKED_STATUSES = new Set([
  USER_STATUS_DISABLE,
  USER_STATUS_LOCK,
  USER_STATUS_FREEZE,
  USER_STATUS_DELETED,
]);

function parseAdminList(value?: string) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getAdminDidAllowList() {
  return new Set(parseAdminList(process.env.ADMIN_DIDS));
}

export async function getUserStateByDid(did: string) {
  const service = new UserService();
  return await service.getState(did);
}

function buildDefaultUserState(did: string, timestamp = ''): UserState {
  return {
    did,
    role: USER_ROLE_UNKNOWN,
    status: USER_STATUS_ACTIVE,
    createdAt: timestamp,
    updatedAt: timestamp,
    signature: '',
  };
}

export async function provisionUserState(did: string) {
  const existing = await getUserStateByDid(did);
  if (existing) {
    return existing;
  }
  const now = getCurrentUtcString();
  const created = buildDefaultUserState(did, now);
  const service = new UserService();
  await service.saveState(created);
  return created;
}

export async function getEffectiveUserState(did: string) {
  const state = await getUserStateByDid(did);
  return state || buildDefaultUserState(did);
}

export function isUserBlocked(status?: string) {
  return status ? BLOCKED_STATUSES.has(status) : false;
}

export async function ensureUserActive(did: string) {
  const state = await provisionUserState(did);
  if (isUserBlocked(state.status)) {
    throw new Error('USER_BLOCKED');
  }
  return state;
}

export async function isAdminUser(did: string) {
  const allowList = getAdminDidAllowList();
  if (allowList.has(did)) {
    return true;
  }
  const state = await getUserStateByDid(did);
  if (!state) {
    return false;
  }
  return state.role === ADMIN_ROLE;
}

async function ensureUserHasRole(
  did: string,
  allowedRoles: Set<string>,
  errorMessage: string
) {
  const state = await getEffectiveUserState(did);
  if (isUserBlocked(state.status)) {
    throw new Error('USER_BLOCKED');
  }
  const isAdmin = await isAdminUser(did);
  if (isAdmin) {
    return state;
  }
  if (!allowedRoles.has(state.role)) {
    throw new Error(errorMessage);
  }
  return state;
}

export async function ensureUserCanWriteBusinessData(did: string) {
  return await ensureUserHasRole(did, BUSINESS_WRITE_ROLES, 'USER_ROLE_DENIED');
}

export async function ensureUserCanSubmitAudit(did: string) {
  return await ensureUserHasRole(did, BUSINESS_WRITE_ROLES, 'USER_ROLE_DENIED');
}

export async function ensureUserCanApproveAudit(did: string) {
  return await ensureUserHasRole(did, APPROVER_ROLES, 'APPROVER_ROLE_REQUIRED');
}
