import { Repository } from 'typeorm/repository/Repository'
import { ApplicationConfigDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class ApplicationConfigManager {
    private repository: Repository<ApplicationConfigDO>

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(ApplicationConfigDO)
    }

    async save(config: ApplicationConfigDO) {
        return await this.repository.save(config)
    }

    async findByApplicationAndApplicant(applicationUid: string, applicant: string) {
        return await this.repository.findOne({
            where: { applicationUid, applicant }
        })
    }
}
