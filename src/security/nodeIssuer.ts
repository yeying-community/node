import * as crypto from 'crypto'
import { getConfig } from '../config/runtime'
import { getRuntimeSecret } from './secretVault'

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export type NodeIssuerKeyRole = 'active' | 'next' | 'previous'

export type NodeIssuerKey = {
  role: NodeIssuerKeyRole
  privateKey: crypto.KeyObject
  publicKey: Buffer
  keyId: string
  did: string
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(input: Buffer): string {
  if (input.length === 0) return ''
  const digits: number[] = [0]
  for (const byte of input) {
    let carry = byte
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] * 256
      digits[i] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let zeros = 0
  while (zeros < input.length && input[zeros] === 0) zeros += 1
  let encoded = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    encoded += BASE58_ALPHABET[digits[i]]
  }
  return encoded
}

function deriveUcanDid(publicKey: Buffer): string {
  return `did:key:z${base58Encode(Buffer.concat([Buffer.from([0xed, 0x01]), publicKey]))}`
}

function parsePrivateKey(raw: string) {
  if (!raw) throw new Error('ISSUER_PRIVATE_KEY is not configured in secrets.enc.json')
  if (raw.includes('BEGIN')) return crypto.createPrivateKey(raw.replace(/\\n/g, '\n'))
  const normalized = raw.replace(/^0x/i, '')
  const seed = Buffer.from(normalized, /^[0-9a-f]{64}$/i.test(normalized) ? 'hex' : 'base64')
  if (seed.length !== 32) throw new Error('ISSUER_PRIVATE_KEY must be an Ed25519 seed or PEM')
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

function loadKey(role: NodeIssuerKeyRole): NodeIssuerKey | null {
  const secretName = role === 'active'
    ? 'ISSUER_PRIVATE_KEY'
    : role === 'next'
      ? 'ISSUER_PRIVATE_KEY_NEXT'
      : 'ISSUER_PRIVATE_KEY_PREVIOUS'
  const raw = getRuntimeSecret(secretName)
  if (!raw) {
    if (role === 'active') {
      throw new Error('ISSUER_PRIVATE_KEY is not configured in secrets.enc.json')
    }
    return null
  }
  const privateKey = parsePrivateKey(raw)
  const der = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer
  if (!der.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX)) {
    throw new Error(`${secretName} must be an Ed25519 key`)
  }
  const publicKey = der.subarray(SPKI_PREFIX.length)
  return {
    role,
    privateKey,
    publicKey,
    keyId: `ed25519-${crypto.createHash('sha256').update(publicKey).digest('base64url')}`,
    did: deriveUcanDid(publicKey),
  }
}

export function getNodeIssuerKeyRing(): NodeIssuerKey[] {
  const active = loadKey('active')
  const keys = [active, loadKey('next'), loadKey('previous')].filter(
    (key): key is NodeIssuerKey => Boolean(key)
  )
  return keys.filter((key, index) => keys.findIndex(item => item.keyId === key.keyId) === index)
}

export function getNodeUcanIssuerKeys(): Array<Pick<NodeIssuerKey, 'role' | 'keyId' | 'did'>> {
  return getNodeIssuerKeyRing().map(({ role, keyId, did }) => ({ role, keyId, did }))
}

export function getNodeIssuerPrivateKey() {
  return getNodeIssuerKeyRing()[0].privateKey
}

export function getNodeIssuerPublicKey() {
  return getNodeIssuerKeyRing()[0].publicKey
}

export function getNodeIssuerKeyId() {
  return getNodeIssuerKeyRing()[0].keyId
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
  if (header.alg !== 'EdDSA' || !header.kid) throw new Error('Invalid issuer JWT header')
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const key = getNodeIssuerKeyRing().find(item => item.keyId === header.kid)
  if (!key) throw new Error('Invalid issuer JWT key')
  const valid = crypto.verify(null, Buffer.from(signingInput), {
    key: crypto.createPublicKey(key.privateKey),
  }, Buffer.from(encodedSignature, 'base64url'))
  if (!valid) throw new Error('Invalid issuer JWT signature')
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp === 'number' && payload.exp <= now) throw new Error('Issuer JWT expired')
  if (typeof payload.nbf === 'number' && payload.nbf > now) throw new Error('Issuer JWT not active')
  return payload
}

export function getNodeIssuerJwk() {
  const key = getNodeIssuerKeyRing()[0]
  return {
    kty: 'OKP', crv: 'Ed25519', x: key.publicKey.toString('base64url'),
    kid: key.keyId, use: 'sig', alg: 'EdDSA'
  }
}

export function getNodeIssuerJwks() {
  return {
    keys: getNodeIssuerKeyRing().map(key => ({
      kty: 'OKP',
      crv: 'Ed25519',
      x: key.publicKey.toString('base64url'),
      kid: key.keyId,
      use: 'sig',
      alg: 'EdDSA',
    })),
  }
}
