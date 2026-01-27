import { UserService } from '../domain/service/user';
import { UserRoleEnum, UserStatusEnum } from '../yeying/api/user/user';

const ADMIN_ROLE = UserRoleEnum[UserRoleEnum.USER_ROLE_OWNER];
const BLOCKED_STATUSES = new Set([
  UserStatusEnum[UserStatusEnum.USER_STATUS_DISABLE],
  UserStatusEnum[UserStatusEnum.USER_STATUS_LOCK],
  UserStatusEnum[UserStatusEnum.USER_STATUS_FREEZE],
  UserStatusEnum[UserStatusEnum.USER_STATUS_DELETED],
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

export function isUserBlocked(status?: string) {
  return status ? BLOCKED_STATUSES.has(status) : false;
}

export async function ensureUserActive(did: string) {
  const state = await getUserStateByDid(did);
  if (state && isUserBlocked(state.status)) {
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
