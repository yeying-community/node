import { Repository } from 'typeorm/repository/Repository'
import { AuditDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'
import { createResponsePage } from '../../common/page'
import { QueryCondition } from '../model/audit'

export class AuditManager {
    private repository: Repository<AuditDO>
    constructor() {
        this.repository = SingletonDataSource.get().getRepository(AuditDO)
    }

    async save(auditDO: AuditDO) {
        return await this.repository.save(auditDO)
    }

    async queryById(uid: string) {
        return await this.repository.findOneBy({ uid: uid})
    }

    private buildQueryByCondition(condition: Partial<QueryCondition>) {
        const qb = this.repository.createQueryBuilder('audit')
        const approver = condition.approver
        const applicant = condition.applicant
        const name = condition.name
        const auditType = condition.auditType
        const startTime = condition.startTime
        const endTime = condition.endTime
        if (typeof approver === 'string' && approver.trim() !== '') {
            const normalized = approver.split('::')[0]?.trim().toLowerCase()
            if (normalized) {
                qb.andWhere('LOWER(audit.approver) like :approverLike', { approverLike: `%${normalized}%` })
            }
        }
        if (typeof applicant === 'string' && applicant.trim() !== '') {
            const normalizedApplicant = applicant.split('::')[0]?.trim().toLowerCase()
            if (normalizedApplicant) {
                qb.andWhere('LOWER(audit.applicant) like :applicantLike', { applicantLike: `%${normalizedApplicant}%` })
            }
        }
        if (name !== undefined && name !== ``) {
            qb.andWhere('(audit.targetName like :name OR audit.appOrServiceMetadata like :legacyName)', {
                name: `%${name}%`,
                legacyName: `%"name":"${name}"%`
            })
        }
        if (typeof auditType === 'string' && auditType.trim() !== '') {
            qb.andWhere('audit.auditType = :auditType', { auditType: auditType.trim() })
        }
        if (startTime !== undefined && startTime !== ``) {
            qb.andWhere('audit.createdAt >= :startTime', { startTime })
        }
        if (endTime !== undefined && endTime !== ``) {
            qb.andWhere('audit.createdAt <= :endTime', { endTime })
        }
        qb.orderBy('audit.createdAt', 'DESC')
        return qb
    }

    async queryByCondition(condition: Partial<QueryCondition>, page: number, pageSize: number) {
        const qb = this.buildQueryByCondition(condition)
        qb.skip((page - 1) * pageSize)
            .take(pageSize)
        const [audits, total] = await qb.getManyAndCount()

        return {
            data: audits,
            page: createResponsePage(total, page, pageSize)
        }
    }

    async queryByConditionAll(condition: Partial<QueryCondition>) {
        return await this.buildQueryByCondition(condition).getMany()
    }

    async delete(uid: string) {
        return await this.repository.delete({ uid: uid})
    }

    async queryByTarget(operateType: string, did: string, version: number) {
        const direct = await this.repository.find({
            where: {
                targetType: operateType,
                targetDid: did,
                targetVersion: version
            },
            order: { createdAt: 'DESC' }
        })
        if (direct.length > 0) {
            return direct
        }
        const versionNum = `%"version":${version}%`
        const versionStr = `%"version":"${version}"%`
        const didPattern = `%"did":"${did}"%`
        return await this.repository.createQueryBuilder('audit')
            .where('audit.auditType = :type', { type: operateType })
            .andWhere('audit.appOrServiceMetadata like :did', { did: didPattern })
            .andWhere('(audit.appOrServiceMetadata like :versionNum OR audit.appOrServiceMetadata like :versionStr)', {
                versionNum,
                versionStr
            })
            .orderBy('audit.createdAt', 'DESC')
            .getMany()
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
