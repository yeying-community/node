import { UserService } from '../domain/service/user';
import { getCurrentUtcString } from './date';
import {
  USER_ROLE_NORMAL,
  USER_ROLE_OWNER,
  USER_ROLE_UNKNOWN,
  USER_STATUS_ACTIVE,
  USER_STATUS_OFFLINE,
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

function normalizeTokenValue(value?: string) {
  return String(value || '').trim().toUpperCase();
}

function normalizeUserRole(role?: string) {
  const value = normalizeTokenValue(role);
  if (!value || value === 'UNKNOWN' || value === USER_ROLE_UNKNOWN) {
    return USER_ROLE_UNKNOWN;
  }
  if (value === 'NORMAL' || value === USER_ROLE_NORMAL) {
    return USER_ROLE_NORMAL;
  }
  if (value === 'OWNER' || value === USER_ROLE_OWNER) {
    return USER_ROLE_OWNER;
  }
  return String(role || USER_ROLE_UNKNOWN);
}

function normalizeUserStatus(status?: string) {
  const value = normalizeTokenValue(status);
  if (!value || value === 'ACTIVE' || value === USER_STATUS_ACTIVE) {
    return USER_STATUS_ACTIVE;
  }
  if (value === 'OFFLINE' || value === USER_STATUS_OFFLINE) {
    return USER_STATUS_OFFLINE;
  }
  if (value === 'DISABLE' || value === USER_STATUS_DISABLE) {
    return USER_STATUS_DISABLE;
  }
  if (value === 'LOCK' || value === USER_STATUS_LOCK) {
    return USER_STATUS_LOCK;
  }
  if (value === 'FREEZE' || value === USER_STATUS_FREEZE) {
    return USER_STATUS_FREEZE;
  }
  if (value === 'DELETED' || value === USER_STATUS_DELETED) {
    return USER_STATUS_DELETED;
  }
  return String(status || USER_STATUS_ACTIVE);
}

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
    role: USER_ROLE_NORMAL,
    status: USER_STATUS_ACTIVE,
    createdAt: timestamp,
    updatedAt: timestamp,
    signature: '',
  };
}

export async function provisionUserState(did: string) {
  const existing = await getUserStateByDid(did);
  if (existing) {
    const normalizedRole = normalizeUserRole(existing.role);
    const normalizedStatus = normalizeUserStatus(existing.status);
    const targetRole =
      normalizedRole === USER_ROLE_UNKNOWN ? USER_ROLE_NORMAL : normalizedRole;
    if (targetRole !== existing.role || normalizedStatus !== existing.status) {
      const now = getCurrentUtcString();
      const upgraded: UserState = {
        ...existing,
        role: targetRole,
        status: normalizedStatus,
        updatedAt: now,
      };
      const service = new UserService();
      await service.saveState(upgraded);
      return upgraded;
    }
    return existing;
  }
  const now = getCurrentUtcString();
  const created = buildDefaultUserState(did, now);
  const service = new UserService();
  await service.saveState(created);
  return created;
}

export async function getEffectiveUserState(did: string) {
  return await provisionUserState(did);
}

export function isUserBlocked(status?: string) {
  return BLOCKED_STATUSES.has(normalizeUserStatus(status));
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
  return normalizeUserRole(state.role) === ADMIN_ROLE;
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
  const role = normalizeUserRole(state.role);
  if (!allowedRoles.has(role)) {
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
