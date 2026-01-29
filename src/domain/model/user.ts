import { UserDO, UserStateDO } from '../mapper/entity'

export interface User {
    name: string
    did: string
    avatar: string
    createdAt: string
    updatedAt: string
    signature: string
}

export const USER_ROLE_UNKNOWN = 'USER_ROLE_UNKNOWN'
export const USER_ROLE_OWNER = 'USER_ROLE_OWNER'
export const USER_ROLE_NORMAL = 'USER_ROLE_NORMAL'

export const USER_STATUS_UNKNOWN = 'USER_STATUS_UNKNOWN'
export const USER_STATUS_ACTIVE = 'USER_STATUS_ACTIVE'
export const USER_STATUS_OFFLINE = 'USER_STATUS_OFFLINE'
export const USER_STATUS_DISABLE = 'USER_STATUS_DISABLE'
export const USER_STATUS_LOCK = 'USER_STATUS_LOCK'
export const USER_STATUS_UNVERIFIED = 'USER_STATUS_UNVERIFIED'
export const USER_STATUS_DELETED = 'USER_STATUS_DELETED'
export const USER_STATUS_DORMANT = 'USER_STATUS_DORMANT'
export const USER_STATUS_FREEZE = 'USER_STATUS_FREEZE'
export const USER_STATUS_AUDIT = 'USER_STATUS_AUDIT'
export const USER_STATUS_REFUSED = 'USER_STATUS_REFUSED'

export interface UserState {
    did: string
    role: string
    createdAt: string
    updatedAt: string
    status: string
    signature: string
}

export function convertUserStateTo(userState: Partial<UserState>): UserStateDO {
    const userStateDO = new UserStateDO()
    
    // 使用类型守卫或默认值来处理可能的 undefined 值
    if (userState.did !== undefined) userStateDO.did = userState.did
    if (userState.role !== undefined) userStateDO.role = userState.role
    if (userState.status !== undefined) userStateDO.status = userState.status
    if (userState.signature !== undefined) userStateDO.signature = userState.signature
    if (userState.createdAt !== undefined) userStateDO.createdAt = userState.createdAt
    if (userState.updatedAt !== undefined) userStateDO.updatedAt = userState.updatedAt
    
    return userStateDO
}

export function convertUserStateFrom(userStateDO: UserStateDO|null): UserState|null {
        // 如果 userDO 为 null，直接返回 null
    if (!userStateDO) {
        return null;
    }
    return {
        did: userStateDO.did,
        role: userStateDO.role,
        status: userStateDO.status,
        createdAt: userStateDO.createdAt,
        updatedAt: userStateDO.updatedAt,
        signature: userStateDO.signature
    }
}

export function convertUserTo(user: Partial<User>): UserDO {
    const userDO = new UserDO()
    
    // 同样处理 User 转换中的可能 undefined 值
    if (user.name !== undefined) userDO.name = user.name
    if (user.did !== undefined) userDO.did = user.did
    if (user.avatar !== undefined) userDO.avatar = user.avatar
    if (user.signature !== undefined) userDO.signature = user.signature
    if (user.createdAt !== undefined) userDO.createdAt = user.createdAt
    if (user.updatedAt !== undefined) userDO.updatedAt = user.updatedAt
    
    return userDO
}

export function convertUserFrom(userDO: UserDO | null): User | null {
    // 如果 userDO 为 null，直接返回 null
    if (!userDO) {
        return null;
    }
    
    return {
        name: userDO.name,
        did: userDO.did,
        avatar: userDO.avatar,
        createdAt: userDO.createdAt,
        updatedAt: userDO.updatedAt,
        signature: userDO.signature
    };
}
