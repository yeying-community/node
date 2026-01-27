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

    async saveUser(user: User) {
        console.log(`user=${JSON.stringify(user)}`)
        return this.userManager.saveUser(convertUserTo(user))
    }

    async saveState(state: UserState) {
        console.log(`state=${JSON.stringify(state)}`)
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
