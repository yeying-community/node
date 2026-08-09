import { Repository } from 'typeorm/repository/Repository'
import { SingletonDataSource } from '../facade/datasource'
import { ScopedGrantAuditLogDO, ScopedGrantDO, ScopedGrantRevocationDO, ScopedGrantTokenDO } from '../mapper/entity'

export class ScopedGrantManager {
  private grantRepository: Repository<ScopedGrantDO>
  private tokenRepository: Repository<ScopedGrantTokenDO>
  private revocationRepository: Repository<ScopedGrantRevocationDO>
  private auditRepository: Repository<ScopedGrantAuditLogDO>

  constructor() {
    const dataSource = SingletonDataSource.get()
    this.grantRepository = dataSource.getRepository(ScopedGrantDO)
    this.tokenRepository = dataSource.getRepository(ScopedGrantTokenDO)
    this.revocationRepository = dataSource.getRepository(ScopedGrantRevocationDO)
    this.auditRepository = dataSource.getRepository(ScopedGrantAuditLogDO)
  }

  async saveGrant(grant: ScopedGrantDO) { return await this.grantRepository.save(grant) }
  async getGrant(grantId: string) { return await this.grantRepository.findOneBy({ grantId }) }
  async listGrants(subjectId: string) { return await this.grantRepository.find({ where: { subjectId }, order: { createdAt: 'DESC' } }) }
  async saveToken(token: ScopedGrantTokenDO) { return await this.tokenRepository.save(token) }
  async getToken(tokenId: string) { return await this.tokenRepository.findOneBy({ tokenId }) }
  async saveRevocation(revocation: ScopedGrantRevocationDO) { return await this.revocationRepository.save(revocation) }
  async saveAuditLog(log: ScopedGrantAuditLogDO) { return await this.auditRepository.save(log) }
}
