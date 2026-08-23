import { Repository } from 'typeorm/repository/Repository'
import { CustodyKeyRecordDO, IdentityAccountLinkDO, IdentityPasskeyCredentialDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class CustodyManager {
  private keyRecordRepository: Repository<CustodyKeyRecordDO>

  constructor() {
    this.keyRecordRepository = SingletonDataSource.get().getRepository(CustodyKeyRecordDO)
  }

  async countActivePasskeys(subject: string): Promise<number> {
    const ds = SingletonDataSource.get()
    const link = await ds.getRepository(IdentityAccountLinkDO).findOne({
      where: {
        chainKey: 'eip155:1',
        accountId: subject,
        status: 'active',
      },
    })
    if (!link || String(link.revokedAt || '').trim()) {
      return 0
    }
    const credentials = await ds.getRepository(IdentityPasskeyCredentialDO).findBy({
      identityDid: link.identityDid,
    })
    return credentials.filter((credential) => !String(credential.revokedAt || '').trim()).length
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
