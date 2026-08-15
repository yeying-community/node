import * as crypto from 'crypto'
import { getConfig } from '../config/runtime'
import { getRuntimeSecret } from './secretVault'

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function loadPrivateKey() {
  const raw = getRuntimeSecret('ISSUER_PRIVATE_KEY')
  if (!raw) throw new Error('ISSUER_PRIVATE_KEY is not configured in secrets.enc.json')
  if (raw.includes('BEGIN')) return crypto.createPrivateKey(raw.replace(/\\n/g, '\n'))
  const normalized = raw.replace(/^0x/i, '')
  const seed = Buffer.from(normalized, /^[0-9a-f]{64}$/i.test(normalized) ? 'hex' : 'base64')
  if (seed.length !== 32) throw new Error('ISSUER_PRIVATE_KEY must be an Ed25519 seed or PEM')
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

export function getNodeIssuerPrivateKey() {
  return loadPrivateKey()
}

export function getNodeIssuerPublicKey() {
  const der = crypto.createPublicKey(loadPrivateKey()).export({ format: 'der', type: 'spki' }) as Buffer
  if (!der.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX)) throw new Error('Node issuer key must be Ed25519')
  return der.subarray(SPKI_PREFIX.length)
}

export function getNodeIssuerKeyId() {
  return `ed25519-${crypto.createHash('sha256').update(getNodeIssuerPublicKey()).digest('base64url')}`
}

export function getNodeIssuerDid() {
  const baseUrl = String(getConfig<string>('issuer.baseUrl') || '').trim()
  if (!baseUrl) throw new Error('issuer.baseUrl is required to derive the Node issuer DID')
  const url = new URL(baseUrl)
  return `did:web:${url.host}`
}

export function signNodeBytes(payload: Buffer) {
  return crypto.sign(null, payload, getNodeIssuerPrivateKey())
}

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString('base64url')
}

export function signNodeJwt(payload: Record<string, unknown>) {
  const header = { alg: 'EdDSA', typ: 'JWT', kid: getNodeIssuerKeyId() }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  return `${signingInput}.${base64url(signNodeBytes(Buffer.from(signingInput)))}`
}

export function verifyNodeJwt(token: string): Record<string, any> {
  const [encodedHeader, encodedPayload, encodedSignature] = String(token || '').split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Invalid issuer JWT')
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'))
  if (header.alg !== 'EdDSA' || header.kid !== getNodeIssuerKeyId()) throw new Error('Invalid issuer JWT header')
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const valid = crypto.verify(null, Buffer.from(signingInput), {
    key: crypto.createPublicKey(loadPrivateKey()),
  }, Buffer.from(encodedSignature, 'base64url'))
  if (!valid) throw new Error('Invalid issuer JWT signature')
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === 'number' && payload.exp <= now) throw new Error('Issuer JWT expired')
  if (typeof payload.nbf === 'number' && payload.nbf > now) throw new Error('Issuer JWT not active')
  return payload
}

export function getNodeIssuerJwk() {
  return {
    kty: 'OKP', crv: 'Ed25519', x: getNodeIssuerPublicKey().toString('base64url'),
    kid: getNodeIssuerKeyId(), use: 'sig', alg: 'EdDSA'
  }
}
