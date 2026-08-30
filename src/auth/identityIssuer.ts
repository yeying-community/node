import * as crypto from 'crypto'
import { randomBytes, randomUUID } from 'node:crypto'
import { getConfig } from '../config/runtime'
import { getNodeIssuerDid, getNodeIssuerJwk, getNodeIssuerKeyId, signNodeBytes } from '../security/nodeIssuer'
import { SingletonDataSource } from '../domain/facade/datasource'
import { IdentityAccountLinkDO, IdentityAuditLogDO, IdentityCredentialDO, IdentityCredentialReissueChallengeDO } from '../domain/mapper/entity'
import { canonicalizeIdentityValue, verifyIdentityController } from './identityAccountLink'


function base64url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url')
}

function requireDataSource() {
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE')
  return ds
}

function assertIdentityDid(value: unknown) {
  const did = String(value || '').trim()
  if (!/^did:yeying:wid_[A-Za-z0-9_-]{22,}$/.test(did)) throw new Error('IDENTITY_INVALID_DID')
  return did
}

export type IdentityCredentialType = 'EmailCredential' | 'UsernameCredential' | 'AvatarCredential' | 'WalletAccountCredential'

function normalizeCredentialTypes(input: unknown): IdentityCredentialType[] {
  const values = Array.isArray(input) ? input : []
  const types = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
  if (types.length === 0) throw new Error('IDENTITY_CREDENTIAL_TYPES_REQUIRED')
  for (const type of types) {
    if (type !== 'EmailCredential' && type !== 'UsernameCredential' && type !== 'AvatarCredential' && type !== 'WalletAccountCredential') throw new Error('IDENTITY_CREDENTIAL_TYPE_UNSUPPORTED')
  }
  return types as IdentityCredentialType[]
}

function decodeCredentialPayload(token: string): any {
  const payload = String(token || '').split('.')[1]
  if (!payload) throw new Error('IDENTITY_CREDENTIAL_INVALID')
  return JSON.parse(Buffer.from(payload, 'base64url').toString())
}

function credentialClaimForReissue(record: IdentityCredentialDO) {
  const payload = decodeCredentialPayload(record.token)
  const subject = payload?.vc?.credentialSubject
  if (!subject || subject.id !== record.identityDid) throw new Error('IDENTITY_CREDENTIAL_INVALID')
  const { id: _id, credentialStatus: _credentialStatus, ...claim } = subject
  return {
    ...claim,
    credentialStatus: { id: '', type: 'YeyingCredentialStatusV1' }
  }
}

function credentialKind(type: IdentityCredentialType) {
  if (type === 'EmailCredential') return 'email'
  if (type === 'UsernameCredential') return 'username'
  if (type === 'AvatarCredential') return 'avatar'
  return 'wallet-account'
}

export function getIdentityIssuerDid() {
  return getNodeIssuerDid()
}

export function getIdentityIssuerMetadata() {
  const issuer = getIdentityIssuerDid()
  const baseUrl = String(getConfig<string>('issuer.baseUrl') || '').trim().replace(/\/$/, '')
  return {
    issuer,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    credential_status_uri: `${baseUrl}/api/v1/public/identity/credentials/status`,
    credential_reissue_challenge_uri: `${baseUrl}/api/v1/public/identity/credentials/reissue/challenge`,
    credential_reissue_confirm_uri: `${baseUrl}/api/v1/public/identity/credentials/reissue/confirm`
  }
}

export function getIdentityIssuerJwks() {
  return {
    keys: [{
      ...getNodeIssuerJwk()
    }]
  }
}

export function issueIdentityCredential(input: {
  credentialId: string
  subject: string
  type: IdentityCredentialType
  claim: Record<string, unknown>
  expiresInSeconds?: number
}) {
  const issuer = getIdentityIssuerDid()
  const credentialId = String(input.credentialId || '').trim()
  const subject = String(input.subject || '').trim()
  if (!credentialId || !subject) throw new Error('Credential id and subject are required')
  const now = Math.floor(Date.now() / 1000)
  const ttl = Math.min(Math.max(input.expiresInSeconds || 86400, 60), 7 * 86400)
  const payload = {
    iss: issuer, sub: subject, iat: now, nbf: now, exp: now + ttl,
    jti: credentialId,
    vc: { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential', input.type], credentialSubject: { id: subject, ...input.claim } }
  }
  const header = { alg: 'EdDSA', typ: 'JWT', kid: getNodeIssuerKeyId() }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  return `${signingInput}.${base64url(signNodeBytes(Buffer.from(signingInput)))}`
}

export async function issueWalletAccountCredential(input: {
  identity: string
  account: { chainKey: string; address: string }
  verifiedAt: string
}) {
  const identity = assertIdentityDid(input.identity)
  const chainKey = String(input.account?.chainKey || '').trim()
  const address = String(input.account?.address || '').trim().toLowerCase()
  if (!/^eip155:[0-9]+$/.test(chainKey) || !/^0x[0-9a-f]{40}$/.test(address)) throw new Error('IDENTITY_ACCOUNT_PROOF_INVALID')
  const repo = requireDataSource().getRepository(IdentityCredentialDO)
  const records = await repo.findBy({ identityDid: identity, credentialType: 'WalletAccountCredential', status: 'active' })
  const existing = records.find(record => {
    if (String(record.revokedAt || '').trim() || Date.parse(record.expiresAt) <= Date.now()) return false
    const subject = decodeCredentialPayload(record.token)?.vc?.credentialSubject
    return subject?.chainKey === chainKey && String(subject?.address || '').toLowerCase() === address
  })
  if (existing) return { type: 'WalletAccountCredential' as const, credentialId: existing.credentialId, credential: existing.token }

  const credentialId = `urn:yeying:credential:wallet-account:${randomUUID()}`
  const credential = issueIdentityCredential({
    credentialId,
    subject: identity,
    type: 'WalletAccountCredential',
    claim: {
      chainKey,
      address,
      linkedAt: input.verifiedAt,
      credentialStatus: { id: credentialId, type: 'YeyingCredentialStatusV1' }
    }
  })
  const payload = decodeCredentialPayload(credential)
  const row = new IdentityCredentialDO()
  Object.assign(row, {
    credentialId,
    identityDid: identity,
    credentialType: 'WalletAccountCredential',
    token: credential,
    status: 'active',
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    revokedAt: ''
  })
  await repo.save(row)
  return { type: 'WalletAccountCredential' as const, credentialId, credential }
}

export async function getCredentialStatus(credentialId: string) {
  const id = String(credentialId || '').trim()
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE')
  const record = await ds.getRepository(IdentityCredentialDO).findOneBy({ credentialId: id })
  if (!record) return { id, status: 'unknown' }
  if (record.status !== 'active') return { id, status: record.status }
  if (Date.parse(record.expiresAt) <= Date.now()) return { id, status: 'expired' }
  return { id, status: 'active' }
}

export async function createCredentialReissueChallenge(input: { identity: unknown; credentialTypes: unknown }) {
  const identity = assertIdentityDid(input.identity)
  const credentialTypes = normalizeCredentialTypes(input.credentialTypes)
  const ds = requireDataSource()
  const repo = ds.getRepository(IdentityCredentialDO)
  for (const credentialType of credentialTypes) {
    if (credentialType === 'WalletAccountCredential') {
      const links = await ds.getRepository(IdentityAccountLinkDO).findBy({ identityDid: identity, status: 'active' })
      if (links.length === 0) throw new Error(`IDENTITY_CREDENTIAL_REISSUE_UNAVAILABLE:${credentialType}`)
      continue
    }
    const records = await repo.findBy({ identityDid: identity, credentialType, status: 'active' })
    const latest = records
      .filter(record => !String(record.revokedAt || '').trim())
      .sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt))[0]
    if (!latest) throw new Error(`IDENTITY_CREDENTIAL_REISSUE_UNAVAILABLE:${credentialType}`)
  }
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const challenge = new IdentityCredentialReissueChallengeDO()
  Object.assign(challenge, {
    challengeId: `icr_${randomUUID()}`,
    identityDid: identity,
    typesJson: JSON.stringify(credentialTypes),
    nonce: randomBytes(24).toString('base64url'),
    status: 'pending',
    issuedAt: now,
    expiresAt,
    consumedAt: ''
  })
  await ds.getRepository(IdentityCredentialReissueChallengeDO).save(challenge)
  const proofPayload = { purpose: 'identity-credential-reissue', challengeId: challenge.challengeId, identity, credentialTypes, nonce: challenge.nonce, issuedAt: now, expiresAt }
  return { challengeId: challenge.challengeId, identity, credentialTypes, nonce: challenge.nonce, issuedAt: now, expiresAt, proofPayload, signingInput: canonicalizeIdentityValue(proofPayload) }
}

export async function confirmCredentialReissue(input: { identity: unknown; challengeId: unknown; identityDocument: any; proof: any }) {
  const identity = assertIdentityDid(input.identity)
  const challengeId = String(input.challengeId || '').trim()
  const ds = requireDataSource()
  const challenge = await ds.getRepository(IdentityCredentialReissueChallengeDO).findOneBy({ challengeId, status: 'pending' })
  if (!challenge || challenge.identityDid !== identity) throw new Error('IDENTITY_CREDENTIAL_REISSUE_CHALLENGE_NOT_FOUND')
  if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('IDENTITY_CREDENTIAL_REISSUE_CHALLENGE_EXPIRED')
  verifyIdentityController(input.identityDocument, identity)
  const credentialTypes = normalizeCredentialTypes(JSON.parse(challenge.typesJson))
  const proofPayload = { purpose: 'identity-credential-reissue', challengeId, identity, credentialTypes, nonce: challenge.nonce, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt }
  const proof = input.proof || {}
  const method = String(proof.verificationMethod || '')
  const controller = input.identityDocument?.controllers?.find((item: any) => `${identity}#${item.controllerId}` === method && item.status === 'active' && item.purposes?.includes('authentication'))
  if (!controller || proof.type !== 'YeyingCredentialReissueProofV1' || proof.purpose !== 'authentication') throw new Error('IDENTITY_CREDENTIAL_REISSUE_PROOF_INVALID')
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(String(controller.publicKey || ''), 'base64url')]), format: 'der', type: 'spki' })
  if (!crypto.verify(null, Buffer.from(canonicalizeIdentityValue(proofPayload)), publicKey, Buffer.from(String(proof.proofValue || ''), 'base64url'))) throw new Error('IDENTITY_CREDENTIAL_REISSUE_PROOF_INVALID')

  const issuedAt = new Date().toISOString()
  const credentials: Array<{ type: string; credentialId: string; credential: string }> = []
  await ds.transaction(async manager => {
    const consumed = await manager.getRepository(IdentityCredentialReissueChallengeDO).update({ challengeId, status: 'pending' }, { status: 'consumed', consumedAt: issuedAt })
    if (!consumed.affected) throw new Error('IDENTITY_CREDENTIAL_REISSUE_CHALLENGE_NOT_FOUND')
    const credentialRepository = manager.getRepository(IdentityCredentialDO)
    for (const credentialType of credentialTypes) {
      const records = await credentialRepository.findBy({ identityDid: identity, credentialType, status: 'active' })
      const source = records
        .filter((record: IdentityCredentialDO) => !String(record.revokedAt || '').trim())
        .sort((a: IdentityCredentialDO, b: IdentityCredentialDO) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt))[0]
      let credentialId = `urn:yeying:credential:reissue:${credentialKind(credentialType)}:${randomUUID()}`
      let claim: Record<string, unknown>
      if (credentialType === 'WalletAccountCredential' && !source) {
        const link = (await ds.getRepository(IdentityAccountLinkDO).findBy({ identityDid: identity, status: 'active' }))[0]
        if (!link) throw new Error(`IDENTITY_CREDENTIAL_REISSUE_UNAVAILABLE:${credentialType}`)
        claim = { chainKey: link.chainKey, address: link.accountId, linkedAt: link.verifiedAt }
      } else {
        if (!source) throw new Error(`IDENTITY_CREDENTIAL_REISSUE_UNAVAILABLE:${credentialType}`)
        claim = credentialClaimForReissue(source)
      }
      claim.credentialStatus = { id: credentialId, type: 'YeyingCredentialStatusV1' }
      const credential = issueIdentityCredential({ credentialId, subject: identity, type: credentialType, claim })
      const payload = decodeCredentialPayload(credential)
      const row = new IdentityCredentialDO()
      Object.assign(row, { credentialId, identityDid: identity, credentialType, token: credential, status: 'active', issuedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString(), revokedAt: '' })
      await credentialRepository.save(row)
      credentials.push({ type: credentialType, credentialId, credential })
    }
    const audit = new IdentityAuditLogDO()
    Object.assign(audit, { identityDid: identity, action: 'identity_credential_reissued', outcome: 'success', metadataJson: JSON.stringify({ challengeId, credentialTypes, credentialIds: credentials.map(item => item.credentialId) }), createdAt: issuedAt })
    await manager.getRepository(IdentityAuditLogDO).save(audit)
  })
  return { identity, credentialTypes, credentials, reissuedAt: issuedAt }
}

export async function revokeCredential(credentialId: string) {
  const id = String(credentialId || '').trim()
  if (!id) throw new Error('Credential id is required')
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE')
  await ds.getRepository(IdentityCredentialDO).update({ credentialId: id, status: 'active' }, { status: 'revoked', revokedAt: new Date().toISOString() })
  return getCredentialStatus(id)
}
