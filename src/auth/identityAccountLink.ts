import * as crypto from 'crypto'
import { randomBytes } from 'node:crypto'
import { getAddress, verifyMessage } from 'ethers'
import { SingletonDataSource } from '../domain/facade/datasource'
import { IdentityAccountLinkChallengeDO, IdentityAccountLinkDO } from '../domain/mapper/entity'

type Account = { chainKey: string; address: string }
const TTL_MS = 10 * 60 * 1000
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function b64url(value: string) {
  return Buffer.from(value, 'base64url')
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('Unsupported canonical value')
}

function normalizeAccount(input: unknown): Account {
  const value = input as Partial<Account> | null
  const chainKey = String(value?.chainKey || '').trim()
  const address = String(value?.address || '').trim()
  if (chainKey !== 'eip155:1' && !/^eip155:[0-9]+$/.test(chainKey)) throw new Error('IDENTITY_ACCOUNT_CHAIN_UNSUPPORTED')
  let normalizedAddress: string
  try { normalizedAddress = getAddress(address) } catch { throw new Error('IDENTITY_ACCOUNT_PROOF_INVALID') }
  return { chainKey, address: normalizedAddress }
}

function assertDid(value: unknown): string {
  const did = String(value || '').trim()
  if (!/^did:yeying:wid_[A-Za-z0-9_-]{22,}$/.test(did)) throw new Error('IDENTITY_INVALID_DID')
  return did
}

function accountLinkMessage(input: { identity: string; account: Account; nonce: string; issuedAt: string; expiresAt: string }) {
  return [
    'YeYing Wallet Identity Account Link',
    `Identity: ${input.identity}`,
    `Chain: ${input.account.chainKey}`,
    `Address: ${input.account.address}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expires At: ${input.expiresAt}`
  ].join('\n')
}

function requireDataSource() {
  const ds = SingletonDataSource.get()
  if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE')
  return ds
}

function verifyIdentityController(document: any, expectedIdentity: string) {
  if (document?.id !== expectedIdentity || !document?.proof?.proofValue) throw new Error('IDENTITY_DOCUMENT_INVALID')
  const method = String(document.proof.verificationMethod || '')
  const controller = document.controllers?.find((item: any) => `${expectedIdentity}#${item.controllerId}` === method && item.status === 'active' && item.purposes?.includes('manage'))
  if (!controller) throw new Error('IDENTITY_CONTROLLER_NOT_AUTHORIZED')
  const rawPublic = Buffer.from(String(controller.publicKey || ''), 'base64url')
  if (rawPublic.length !== 32) throw new Error('IDENTITY_DOCUMENT_INVALID')
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublic]), format: 'der', type: 'spki' })
  const { proof, ...unsigned } = document
  const valid = crypto.verify(null, Buffer.from(canonicalize(unsigned)), publicKey, b64url(proof.proofValue))
  if (!valid) throw new Error('IDENTITY_DOCUMENT_INVALID')
}

export async function issueAccountLinkChallenge(input: { identity: string; account: unknown }) {
  const identity = assertDid(input.identity)
  const account = normalizeAccount(input.account)
  const nonce = randomBytes(24).toString('base64url')
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
  const ds = requireDataSource()
  const row = new IdentityAccountLinkChallengeDO()
  Object.assign(row, { nonce, identityDid: identity, chainKey: account.chainKey, accountId: account.address, issuedAt, expiresAt, status: 'pending', consumedAt: '' })
  await ds.getRepository(IdentityAccountLinkChallengeDO).save(row)
  return { nonce, identity, account, issuedAt, expiresAt, message: accountLinkMessage({ identity, account, nonce, issuedAt, expiresAt }) }
}

export async function verifyAccountLink(input: { identityDocument: any; identity: string; account: unknown; nonce: string; issuedAt: string; expiresAt: string; accountSignature: string }) {
  const identity = assertDid(input.identity)
  const account = normalizeAccount(input.account)
  const ds = requireDataSource()
  const row = await ds.getRepository(IdentityAccountLinkChallengeDO).findOneBy({ nonce: input.nonce, status: 'pending' })
  const challenge = row && { nonce: row.nonce, identity: row.identityDid, account: { chainKey: row.chainKey, address: row.accountId }, expiresAt: Date.parse(row.expiresAt) }
  if (!challenge || challenge.identity !== identity || challenge.account.chainKey !== account.chainKey || challenge.account.address !== account.address) throw new Error('IDENTITY_ACCOUNT_PROOF_INVALID')
  if (Date.now() > challenge.expiresAt || Date.parse(input.expiresAt) < Date.now()) throw new Error('IDENTITY_PRESENTATION_EXPIRED')
  verifyIdentityController(input.identityDocument, identity)
  const message = accountLinkMessage({ identity, account, nonce: input.nonce, issuedAt: input.issuedAt, expiresAt: input.expiresAt })
  let recovered: string
  try { recovered = getAddress(verifyMessage(message, input.accountSignature)) } catch { throw new Error('IDENTITY_ACCOUNT_PROOF_INVALID') }
  if (recovered !== account.address) throw new Error('IDENTITY_ACCOUNT_PROOF_INVALID')
  const result = { identity, account, verifiedAt: new Date().toISOString(), purpose: 'identity-account-link' }
  await ds.getRepository(IdentityAccountLinkChallengeDO).update({ nonce: input.nonce, status: 'pending' }, { status: 'consumed', consumedAt: result.verifiedAt })
  const link = new IdentityAccountLinkDO()
  Object.assign(link, { identityDid: identity, chainKey: account.chainKey, accountId: account.address, status: 'active', verifiedAt: result.verifiedAt, revokedAt: '' })
  await ds.getRepository(IdentityAccountLinkDO).save(link)
  return result
}

export async function isAccountLinked(identity: string, account: unknown) {
  const normalizedIdentity = assertDid(identity)
  const normalizedAccount = normalizeAccount(account)
  const ds = requireDataSource()
  const row = await ds.getRepository(IdentityAccountLinkDO).findOneBy({ identityDid: normalizedIdentity, chainKey: normalizedAccount.chainKey, accountId: normalizedAccount.address, status: 'active' })
  return Boolean(row)
}
