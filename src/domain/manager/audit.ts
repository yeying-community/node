import { Repository } from 'typeorm/repository/Repository'
import { AuditDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { ResponsePage } from '../../yeying/api/common/message'
import { ApplicationManager } from './application'
import { ServiceManager } from './service'
import { LessThanOrEqual, Like, MoreThanOrEqual } from 'typeorm'

export class AuditManager {
    private repository: Repository<AuditDO>
    private applicationManager: ApplicationManager
    private serviceManager: ServiceManager

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(AuditDO)
        this.applicationManager = new ApplicationManager()
        this.serviceManager = new ServiceManager()
    }

    async save(auditDO: AuditDO) {
        return await this.repository.save(auditDO)
    }

    async queryById(uid: string) {
        return await this.repository.findOneBy({ uid: uid})
    }

    async queryByCondition(approver: string|null|undefined, applicant: string|null|undefined, name: string|null|undefined, startTime: string|null|undefined, endTime: string|null|undefined, page: number, pageSize: number) {
        const completeCondition: any = {};

        if (approver !== undefined && approver !== ``) {
            completeCondition.approver = approver;
        }
        if (applicant !== undefined && applicant !== ``) {
            completeCondition.applicant = applicant;
        }

        if (name !== undefined && name !== ``) {
            completeCondition.appOrServiceMetadata = Like(`%"name":"${name}"%`);
        }

        // 如果开始时间存在，添加 >= 条件
        if (startTime !== undefined && startTime !== ``) {
            completeCondition.createAt = MoreThanOrEqual(startTime); // startTime 可以是 Date 或字符串
        }

        // 如果结束时间存在，添加 <= 条件
        if (endTime !== undefined && endTime !== ``) {
            // 如果 where.createAt 已存在（即 startTime 也存在），则合并条件
            if (completeCondition.createAt) {
                completeCondition.createAt = [completeCondition.createAt, LessThanOrEqual(endTime)];
            } else {
                completeCondition.createAt = LessThanOrEqual(endTime);
            }
        }

        console.log(`completeCondition=${JSON.stringify(completeCondition)}`)
        const [audits, total] =  await this.repository.findAndCount({
            where: completeCondition,
            skip: (page - 1) * pageSize,
            take: pageSize,
            order: { createdAt: 'DESC' }
        })
        
        return {
            data: audits,
            page: ResponsePage.create({
                total: total,
                page: page,
                pageSize: pageSize
            })
        }
    }

    async delete(uid: string) {
        return await this.repository.delete({ uid: uid})
    }
 
}

export class SearchCondition {
    approver?: string
    applicant?: string
    appOrServiceMetadata?: string
    type?: string
    startTime?: Date
    endTime?: Date
}