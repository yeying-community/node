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
  afterSeq?: number
  recipientIndex?: number
  limit: number
}

export type MpcSignRequestQuery = {
  sessionId?: string
  walletId?: string
  status?: string
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

  async listSessions() {
    return await this.sessionRepository.find({
      order: { createdAt: 'DESC' }
    })
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

  async saveWireMessageWithNextSequence(
    sessionId: string,
    buildMessage: (seq: number) => MpcMessageDO
  ): Promise<MpcMessageDO> {
    const ds = SingletonDataSource.get()
    return await ds.transaction(async (entityManager) => {
      const lockKey = `mpc_messages:${sessionId}`
      const isMysql = ds.options.type === 'mysql' || ds.options.type === 'mariadb'
      if (ds.options.type === 'postgres') {
        await entityManager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
      } else if (isMysql) {
        const rows = await entityManager.query('SELECT GET_LOCK(?, 10) AS acquired', [lockKey])
        const acquired = Number(rows?.[0]?.acquired ?? rows?.[0]?.['GET_LOCK(?, 10)'])
        if (acquired !== 1) {
          throw new Error('MPC_MESSAGE_SEQUENCE_LOCK_TIMEOUT')
        }
      }

      try {
        const repository = entityManager.getRepository(MpcMessageDO)
        const row = await repository
          .createQueryBuilder('message')
          .select('MAX(message.seq)', 'maxSeq')
          .where('message.session_id = :sessionId', { sessionId })
          .getRawOne<{ maxSeq?: string | number | null }>()
        const maxSeq = Number(row?.maxSeq ?? 0)
        const seq = (Number.isFinite(maxSeq) ? maxSeq : 0) + 1
        return await repository.save(buildMessage(seq))
      } finally {
        if (isMysql) {
          await entityManager.query('SELECT RELEASE_LOCK(?)', [lockKey]).catch(() => null)
        }
      }
    })
  }

  async getMessageById(id: string) {
    return await this.messageRepository.findOneBy({ id })
  }

  async getMessageBySeq(sessionId: string, sender: string, seq: number) {
    return await this.messageRepository.findOne({
      where: { sessionId, sender, seq }
    })
  }

  async getMaxMessageSeq(sessionId: string) {
    const row = await this.messageRepository
      .createQueryBuilder('message')
      .select('MAX(message.seq)', 'maxSeq')
      .where('message.session_id = :sessionId', { sessionId })
      .getRawOne<{ maxSeq?: string | number | null }>()
    const maxSeq = Number(row?.maxSeq ?? 0)
    return Number.isFinite(maxSeq) ? maxSeq : 0
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
    if (typeof query.afterSeq === 'number' && Number.isFinite(query.afterSeq)) {
      qb.andWhere('message.seq > :afterSeq', { afterSeq: query.afterSeq })
    }
    if (typeof query.recipientIndex === 'number' && Number.isInteger(query.recipientIndex)) {
      const recipient = String(query.recipientIndex)
      qb.andWhere(
        "((message.receiver = '' AND message.sender <> :recipient) OR message.receiver = :recipient)",
        { recipient }
      )
    }
    qb.orderBy('message.seq', 'ASC')
    qb.addOrderBy('message.created_at', 'ASC')
    qb.addOrderBy('message.id', 'ASC')
    qb.take(query.limit)
    return await qb.getMany()
  }

  async saveSignRequest(request: MpcSignRequestDO) {
    return await this.signRequestRepository.save(request)
  }

  async getSignRequest(id: string) {
    return await this.signRequestRepository.findOneBy({ id })
  }

  async querySignRequests(query: MpcSignRequestQuery = {}) {
    const qb = this.signRequestRepository.createQueryBuilder('request')
    qb.where('1 = 1')
    if (query.sessionId) {
      qb.andWhere('request.session_id = :sessionId', { sessionId: query.sessionId })
    }
    if (query.walletId) {
      qb.andWhere('request.wallet_id = :walletId', { walletId: query.walletId })
    }
    if (query.status) {
      qb.andWhere('request.status = :status', { status: query.status })
    }
    qb.orderBy('request.created_at', 'DESC')
    qb.addOrderBy('request.id', 'ASC')
    return await qb.getMany()
  }

  async saveAuditLog(log: MpcAuditLogDO) {
    return await this.auditRepository.save(log)
  }
}
