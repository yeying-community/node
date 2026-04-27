import { Repository } from 'typeorm/repository/Repository'
import {
  MpcAuditLogDO,
  MpcMessageDO,
  MpcSessionDO,
  MpcSessionParticipantDO,
  MpcSignRequestDO
} from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export type MpcMessageQuery = {
  sessionId: string
  since?: number
  cursorTime?: number
  limit: number
}

export class MpcManager {
  private sessionRepository: Repository<MpcSessionDO>
  private participantRepository: Repository<MpcSessionParticipantDO>
  private messageRepository: Repository<MpcMessageDO>
  private signRequestRepository: Repository<MpcSignRequestDO>
  private auditRepository: Repository<MpcAuditLogDO>

  constructor() {
    const ds = SingletonDataSource.get()
    this.sessionRepository = ds.getRepository(MpcSessionDO)
    this.participantRepository = ds.getRepository(MpcSessionParticipantDO)
    this.messageRepository = ds.getRepository(MpcMessageDO)
    this.signRequestRepository = ds.getRepository(MpcSignRequestDO)
    this.auditRepository = ds.getRepository(MpcAuditLogDO)
  }

  async saveSession(session: MpcSessionDO) {
    return await this.sessionRepository.save(session)
  }

  async getSession(id: string) {
    return await this.sessionRepository.findOneBy({ id })
  }

  async updateSession(id: string, patch: Partial<MpcSessionDO>) {
    await this.sessionRepository.update({ id }, patch)
    return await this.getSession(id)
  }

  async saveParticipant(participant: MpcSessionParticipantDO) {
    return await this.participantRepository.save(participant)
  }

  async getParticipant(sessionId: string, participantId: string) {
    return await this.participantRepository.findOne({
      where: { sessionId, participantId }
    })
  }

  async listParticipants(sessionId: string) {
    return await this.participantRepository.find({
      where: { sessionId },
      order: { joinedAt: 'ASC' }
    })
  }

  async saveMessage(message: MpcMessageDO) {
    return await this.messageRepository.save(message)
  }

  async getMessageById(id: string) {
    return await this.messageRepository.findOneBy({ id })
  }

  async getMessageBySeq(sessionId: string, sender: string, seq: number) {
    return await this.messageRepository.findOne({
      where: { sessionId, sender, seq }
    })
  }

  async queryMessages(query: MpcMessageQuery) {
    const ds = SingletonDataSource.get()
    const createdAtEpochExpr =
      ds.options.type === 'postgres'
        ? "NULLIF(message.created_at, '')::bigint"
        : "CAST(NULLIF(message.created_at, '') AS UNSIGNED)"
    const qb = this.messageRepository.createQueryBuilder('message')
    qb.where('message.session_id = :sessionId', { sessionId: query.sessionId })
    if (typeof query.since === 'number' && Number.isFinite(query.since)) {
      qb.andWhere(`${createdAtEpochExpr} >= :since`, { since: query.since })
    }
    if (typeof query.cursorTime === 'number' && Number.isFinite(query.cursorTime)) {
      qb.andWhere(`${createdAtEpochExpr} > :cursorTime`, { cursorTime: query.cursorTime })
    }
    qb.orderBy('message.created_at', 'ASC')
    qb.addOrderBy('message.id', 'ASC')
    qb.take(query.limit)
    return await qb.getMany()
  }

  async saveSignRequest(request: MpcSignRequestDO) {
    return await this.signRequestRepository.save(request)
  }

  async saveAuditLog(log: MpcAuditLogDO) {
    return await this.auditRepository.save(log)
  }
}
