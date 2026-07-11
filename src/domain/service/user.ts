import { UserManager } from '../manager/user'
import {
    convertUserFrom,
    convertUserStateFrom,
    convertUserStateTo,
    convertUserTo,
    User,
    UserState
} from '../model/user'
import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'

export class UserService {
    private logger: Logger = SingletonLogger.get()
    private userManager: UserManager

    constructor() {
        this.userManager = new UserManager()
    }

    async getUser(did: string) {
        return convertUserFrom(await this.userManager.queryUser(did))
    }

    async getState(did: string) {
        return convertUserStateFrom(await this.userManager.queryState(did))
    }

    async del(did: string) {
        return await this.userManager.deleteByDid(did)
    }

    // async add(user: User) {
    //     const old = await this.userManager.query(user.did)
    //     if (old === undefined) {
    //         this.logger.error(`The user=${user.did} already exists when adding.`)
    //         throw new Error('Existing')
    //     }
    //
    //     return this.userManager.insert(convertUserTo(user))
    // }

    private maskDid(value: string) {
        const normalized = String(value || '').trim()
        if (!normalized) return ''
        if (normalized.length <= 16) return normalized
        return `${normalized.slice(0, 10)}...${normalized.slice(-6)}`
    }

    async saveUser(user: User) {
        this.logger.info('saving user', {
            did: this.maskDid(user.did),
            hasName: Boolean(String(user.name || '').trim()),
            hasAvatar: Boolean(String(user.avatar || '').trim()),
            hasSignature: Boolean(String(user.signature || '').trim())
        })
        return this.userManager.saveUser(convertUserTo(user))
    }

    async saveState(state: UserState) {
        this.logger.info('saving user state', {
            did: this.maskDid(state.did),
            role: state.role,
            status: state.status,
            hasSignature: Boolean(String(state.signature || '').trim())
        })
        return this.userManager.saveState(convertUserStateTo(state))
    }

    async listUsers(pageIndex: number, pageSize: number) {
        const result = await this.userManager.listUsers(pageIndex, pageSize)
        return {
            users: result.users.map(convertUserFrom),
            total: result.total
        }
    }
}
