import { UserDO, UserStateDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { Repository } from 'typeorm/repository/Repository'
import { Logger } from 'winston'
import { SingletonLogger } from '../facade/logger'

export class UserManager {
    private logger: Logger = SingletonLogger.get()
    private userRepository: Repository<UserDO>
    private stateRepository: Repository<UserStateDO>

    constructor() {
        this.userRepository = SingletonDataSource.get().getRepository(UserDO)
        this.stateRepository = SingletonDataSource.get().getRepository(UserStateDO)
    }

    async saveUser(userDO: UserDO) {
        return await this.userRepository.save(userDO)
    }

    async saveState(userStateDO: UserStateDO) {
        return await this.stateRepository.save(userStateDO)
    }

    async queryUser(did: string) {
        return await this.userRepository.findOneBy({ did: did })
    }

    async queryState(did: string) {
        return await this.stateRepository.findOneBy({ did: did })
    }

    async deleteByDid(did: string) {
        const queryRunner = SingletonDataSource.get().createQueryRunner()

        // 开始事务
        await queryRunner.startTransaction()

        try {
            // 删除操作
            await queryRunner.manager.delete(UserDO, { did: did })
            await queryRunner.manager.delete(UserStateDO, { did: did })
            // 提交事务
            await queryRunner.commitTransaction()
        } catch (err) {
            // 回滚事务
            await queryRunner.rollbackTransaction()
        } finally {
            // 释放 QueryRunner
            await queryRunner.release()
        }
    }

    async listUsers(pageIndex: number, pageSize: number) {
        const [users, total] = await this.userRepository.findAndCount({
            skip: (pageIndex - 1) * pageSize,
            take: pageSize,
            order: { createdAt: 'DESC' }
        })
        return { users, total }
    }
}
