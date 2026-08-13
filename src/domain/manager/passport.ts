import { Repository } from 'typeorm/repository/Repository'
import {
  PassportAuditLogDO,
  PassportAuthorizationCodeDO,
  PassportAuthorizationRequestDO,
  PassportEmailVerificationChallengeDO,
  PassportPasskeyCredentialDO,
  PassportSubjectDO,
  PassportWebauthnChallengeDO,
  PassportWalletBindingDO,
} from '../mapper/entity'
import { SingletonDataSource } from '../facade/datasource'

export class PassportManager {
  private subjectRepository: Repository<PassportSubjectDO>
  private walletBindingRepository: Repository<PassportWalletBindingDO>
  private passkeyCredentialRepository: Repository<PassportPasskeyCredentialDO>
  private webauthnChallengeRepository: Repository<PassportWebauthnChallengeDO>
  private authorizationRequestRepository: Repository<PassportAuthorizationRequestDO>
  private authorizationCodeRepository: Repository<PassportAuthorizationCodeDO>
  private auditLogRepository: Repository<PassportAuditLogDO>
  private emailVerificationChallengeRepository: Repository<PassportEmailVerificationChallengeDO>

  constructor() {
    const ds = SingletonDataSource.get()
    this.subjectRepository = ds.getRepository(PassportSubjectDO)
    this.walletBindingRepository = ds.getRepository(PassportWalletBindingDO)
    this.passkeyCredentialRepository = ds.getRepository(PassportPasskeyCredentialDO)
    this.webauthnChallengeRepository = ds.getRepository(PassportWebauthnChallengeDO)
    this.authorizationRequestRepository = ds.getRepository(PassportAuthorizationRequestDO)
    this.authorizationCodeRepository = ds.getRepository(PassportAuthorizationCodeDO)
    this.auditLogRepository = ds.getRepository(PassportAuditLogDO)
    this.emailVerificationChallengeRepository = ds.getRepository(PassportEmailVerificationChallengeDO)
  }

  async getSubject(subjectId: string) {
    return await this.subjectRepository.findOneBy({ subjectId })
  }

  async getSubjectByUsername(username: string) {
    return await this.subjectRepository.findOneBy({ username })
  }

  async saveSubject(subject: PassportSubjectDO) {
    return await this.subjectRepository.save(subject)
  }

  async saveEmailVerificationChallenge(challenge: PassportEmailVerificationChallengeDO) {
    return await this.emailVerificationChallengeRepository.save(challenge)
  }

  async getEmailVerificationChallenge(verificationId: string) {
    return await this.emailVerificationChallengeRepository.findOneBy({ verificationId })
  }

  async listEmailVerificationChallenges(subjectId: string) {
    return await this.emailVerificationChallengeRepository.find({
      where: { subjectId },
      order: { createdAt: 'DESC' },
    })
  }

  async getWalletBinding(chain: string, address: string) {
    return await this.walletBindingRepository.findOne({
      where: { chain, address },
    })
  }

  async listWalletBindings(subjectId: string) {
    return await this.walletBindingRepository.find({
      where: { subjectId },
      order: { createdAt: 'ASC' },
    })
  }

  async saveWalletBinding(binding: PassportWalletBindingDO) {
    return await this.walletBindingRepository.save(binding)
  }

  async listPasskeyCredentials(subjectId: string) {
    return await this.passkeyCredentialRepository.find({
      where: { subjectId },
      order: { createdAt: 'DESC' },
    })
  }

  async getPasskeyCredentialById(credentialId: string) {
    return await this.passkeyCredentialRepository.findOneBy({ credentialId })
  }

  async savePasskeyCredential(credential: PassportPasskeyCredentialDO) {
    return await this.passkeyCredentialRepository.save(credential)
  }

  async saveWebauthnChallenge(challenge: PassportWebauthnChallengeDO) {
    return await this.webauthnChallengeRepository.save(challenge)
  }

  async getWebauthnChallenge(challengeId: string) {
    return await this.webauthnChallengeRepository.findOneBy({ challengeId })
  }

  async saveAuthorizationRequest(request: PassportAuthorizationRequestDO) {
    return await this.authorizationRequestRepository.save(request)
  }

  async getAuthorizationRequest(requestId: string) {
    return await this.authorizationRequestRepository.findOneBy({ requestId })
  }

  async listAuthorizationRequestsBySubject(subjectId: string) {
    return await this.authorizationRequestRepository.find({
      where: { subjectId },
      order: { createdAt: 'DESC' },
    })
  }

  async saveAuthorizationCode(code: PassportAuthorizationCodeDO) {
    return await this.authorizationCodeRepository.save(code)
  }

  async getAuthorizationCode(code: string) {
    return await this.authorizationCodeRepository.findOneBy({ code })
  }

  async listAuthorizationCodesBySubject(subjectId: string) {
    return await this.authorizationCodeRepository.find({
      where: { subjectId },
      order: { createdAt: 'DESC' },
    })
  }

  async saveAuditLog(log: PassportAuditLogDO) {
    return await this.auditLogRepository.save(log)
  }
}
