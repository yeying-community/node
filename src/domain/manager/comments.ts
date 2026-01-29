import { Repository } from 'typeorm/repository/Repository'
import { CommentDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class CommentManager {
    private repository: Repository<CommentDO>

    constructor() {
        this.repository = SingletonDataSource.get().getRepository(CommentDO)
    }

    async queryByAuditId(auditId: string) {
        return await this.repository.findBy({ auditId: auditId})
    }

    async save(comment: CommentDO) {
        return await this.repository.save(comment)
    }

    async delete(uid: string) {
        return await this.repository.delete({ uid: uid})
    }
}
