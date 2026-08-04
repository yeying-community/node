import { Repository } from 'typeorm/repository/Repository'
import { CustodyKeyRecordDO, PassportPasskeyCredentialDO, PassportWalletBindingDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class CustodyManager {
  private keyRecordRepository: Repository<CustodyKeyRecordDO>

  constructor() {
    this.keyRecordRepository = SingletonDataSource.get().getRepository(CustodyKeyRecordDO)
  }

  async countActivePasskeys(subject: string): Promise<number> {
    const ds = SingletonDataSource.get()
    const binding = await ds.getRepository(PassportWalletBindingDO).findOne({
      where: {
        chain: 'eip155:1',
        address: subject,
        status: 'active',
      },
    })
    if (!binding || String(binding.revokedAt || '').trim()) {
      return 0
    }
    return await ds
      .getRepository(PassportPasskeyCredentialDO)
      .createQueryBuilder('credential')
      .where('credential.subjectId = :subjectId', { subjectId: binding.subjectId })
      .andWhere("(credential.revokedAt IS NULL OR credential.revokedAt = '')")
      .getCount()
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
