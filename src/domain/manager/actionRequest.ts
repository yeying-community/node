import { Repository } from 'typeorm'
import { ActionRequestDO } from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class ActionRequestManager {
  private repository: Repository<ActionRequestDO>

  constructor() {
    this.repository = SingletonDataSource.get().getRepository(ActionRequestDO)
  }

  async insert(actionRequest: ActionRequestDO) {
    return await this.repository.insert(actionRequest)
  }

  async findByActorAndRequestId(actor: string, requestId: string) {
    return await this.repository.findOneBy({ actor, requestId })
  }

  async updateByActorAndRequestId(
    actor: string,
    requestId: string,
    patch: Partial<ActionRequestDO>
  ) {
    return await this.repository.update({ actor, requestId }, patch)
  }
}
