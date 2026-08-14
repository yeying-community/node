import * as crypto from 'crypto'
import { getConfig } from '../config/runtime'
import { getNodeIssuerDid, getNodeIssuerJwk, getNodeIssuerKeyId, signNodeBytes } from '../security/nodeIssuer'
import { SingletonDataSource } from '../domain/facade/datasource'
import { IdentityCredentialDO } from '../domain/mapper/entity'


function base64url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url')
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
    credential_status_uri: `${baseUrl}/api/v1/public/identity/credentials/status`
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
  type: 'UsernameCredential' | 'EmailCredential'
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

export async function revokeCredential(credentialId: string) {
  const id = String(credentialId || '').trim()
  if (!id) throw new Error('Credential id is required')
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE')
  await ds.getRepository(IdentityCredentialDO).update({ credentialId: id, status: 'active' }, { status: 'revoked', revokedAt: new Date().toISOString() })
  return getCredentialStatus(id)
}
