import * as crypto from 'crypto'
import { getConfig } from '../config/runtime'
import { getRuntimeSecret } from '../security/secretVault'
import { SingletonDataSource } from '../domain/facade/datasource'
import { IdentityCredentialDO } from '../domain/mapper/entity'

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url')
}

function privateKey() {
  const raw = getRuntimeSecret('IDENTITY_ISSUER_PRIVATE_KEY')
  if (!raw) throw new Error('IDENTITY_ISSUER_PRIVATE_KEY is not configured')
  if (raw.includes('BEGIN')) return crypto.createPrivateKey(raw.replace(/\\n/g, '\n'))
  const seed = Buffer.from(raw.replace(/^0x/i, ''), /^[0-9a-f]{64}$/i.test(raw.replace(/^0x/i, '')) ? 'hex' : 'base64')
  if (seed.length !== 32) throw new Error('IDENTITY_ISSUER_PRIVATE_KEY must be an Ed25519 seed or PEM')
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

function publicKey() {
  const der = crypto.createPublicKey(privateKey()).export({ format: 'der', type: 'spki' }) as Buffer
  if (!der.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX)) throw new Error('Identity issuer key must be Ed25519')
  return der.subarray(SPKI_PREFIX.length)
}

export function getIdentityIssuerDid() {
  const configured = getRuntimeSecret('IDENTITY_ISSUER_DID')
  if (!configured) throw new Error('IDENTITY_ISSUER_DID is not configured')
  return configured
}

export function getIdentityIssuerMetadata() {
  const issuer = getIdentityIssuerDid()
  const baseUrl = String(getConfig<string>('identityIssuer.baseUrl') || '').trim().replace(/\/$/, '')
  return {
    issuer,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    credential_status_uri: `${baseUrl}/api/v1/public/identity/credentials/status`
  }
}

export function getIdentityIssuerJwks() {
  return {
    keys: [{
      kty: 'OKP', crv: 'Ed25519', x: base64url(publicKey()),
      kid: String(getConfig<string>('identityIssuer.keyId') || 'identity-issuer-1'),
      use: 'sig', alg: 'EdDSA'
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
  const header = { alg: 'EdDSA', typ: 'JWT', kid: String(getConfig<string>('identityIssuer.keyId') || 'identity-issuer-1') }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  return `${signingInput}.${base64url(crypto.sign(null, Buffer.from(signingInput), privateKey()))}`
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
