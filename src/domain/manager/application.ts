import { Repository } from 'typeorm/repository/Repository'
import { ApplicationDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { SearchCondition } from '../model/application'
import { ResponsePage } from '../../yeying/api/common/message'
import { Like } from "typeorm";
import { SingletonLogger } from '../facade/logger'
import { Logger } from 'winston'

export class ApplicationManager {
    private repository: Repository<ApplicationDO>

    private logger: Logger = SingletonLogger.get()

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(ApplicationDO)
    }

    async save(application: ApplicationDO) {
        return await this.repository.save(application)
    }

    async query(did: string, version: number) {
        return await this.repository.findOneBy({ did: did, version: version})
    }

    async queryByCondition(condition: SearchCondition, page: number, pageSize: number) {
        let completeCondition: object[] = [];
        if (condition.keyword && condition.keyword !== '') {
            const safeKeyword = condition.keyword.replace(/([%_])/g, "\\$1");
            completeCondition.push({name: Like(`%${safeKeyword}%`), isOnline: true})
            completeCondition.push({owner: Like(`%${safeKeyword}%`), isOnline: true})
        } else {
            const cond: SearchCondition = {}
            if (condition.name) {
                cond.name = condition.name
            }
            if (condition.owner) {
                cond.owner = condition.owner
            }
            if (condition.code) {
                cond.code = condition.code
            }
            if (cond.name || cond.owner || cond.code) {
                completeCondition.push(cond)
            }
            if (completeCondition.length == 0) {
                completeCondition = []
            }
        }
        if (completeCondition.length > 0) {
            const [applications, total] = await this.repository.findAndCount({
                where: completeCondition,
                skip: (page - 1) * pageSize,
                take: pageSize,
                order: { createdAt: 'DESC' }
            })
            return {
                data: applications,
                page: ResponsePage.create({
                    total: total,
                    page: page,
                    pageSize: pageSize
                })
            }
        } else {
            const [applications, total] = await this.repository.findAndCount({
                where: {isOnline: true},
                skip: (page - 1) * pageSize,
                take: pageSize,
                order: { createdAt: 'DESC' }
            })
            return {
                data: applications,
                page: ResponsePage.create({
                    total: total,
                    page: page,
                    pageSize: pageSize
                })
            }
        }
    }

    async delete(did: string, version: number) {
        return await this.repository.delete({ did: did, version: version })
    }
}
