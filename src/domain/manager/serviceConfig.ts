import { Repository } from 'typeorm/repository/Repository'
import { ServiceConfigDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class ServiceConfigManager {
    private repository: Repository<ServiceConfigDO>

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(ServiceConfigDO)
    }

    async save(config: ServiceConfigDO) {
        return await this.repository.save(config)
    }

    async findByServiceAndApplicant(serviceUid: string, applicant: string) {
        return await this.repository.findOne({
            where: { serviceUid, applicant }
        })
    }
}
