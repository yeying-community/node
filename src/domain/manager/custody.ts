import { Repository } from 'typeorm/repository/Repository'
import { CustodyKeyRecordDO, PasskeySubjectCredentialDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class CustodyManager {
  private keyRecordRepository: Repository<CustodyKeyRecordDO>

  constructor() {
    this.keyRecordRepository = SingletonDataSource.get().getRepository(CustodyKeyRecordDO)
  }

  async countActivePasskeys(subject: string): Promise<number> {
    const ds = SingletonDataSource.get()
    const result = await ds
      .getRepository(PasskeySubjectCredentialDO)
      .createQueryBuilder('credential')
      .where('credential.subjectType = :subjectType', { subjectType: 'wallet_address' })
      .andWhere('credential.subjectId = :subjectId', { subjectId: subject })
      .andWhere("(credential.revokedAt IS NULL OR credential.revokedAt = '')")
      .getCount()
    return result
  }

  async listKeyRecords(subject: string): Promise<CustodyKeyRecordDO[]> {
    return await this.keyRecordRepository.find({
      where: {
        subjectType: 'wallet_address',
        subjectId: subject,
      },
      order: {
        updatedAt: 'DESC',
      },
    })
  }

  async getKeyRecord(subject: string, walletId: string): Promise<CustodyKeyRecordDO | null> {
    return await this.keyRecordRepository.findOne({
      where: {
        subjectType: 'wallet_address',
        subjectId: subject,
        walletId,
      },
    })
  }

  async saveKeyRecord(record: CustodyKeyRecordDO): Promise<CustodyKeyRecordDO> {
    return await this.keyRecordRepository.save(record)
  }

  async deleteKeyRecord(subject: string, walletId: string): Promise<void> {
    await this.keyRecordRepository.delete({
      subjectType: 'wallet_address',
      subjectId: subject,
      walletId,
    })
  }
}
