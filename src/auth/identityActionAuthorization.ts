import * as crypto from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { SingletonDataSource } from '../domain/facade/datasource'
import { IdentityActionChallengeDO } from '../domain/mapper/entity'
import { canonicalizeIdentityValue, verifyIdentityController } from './identityAccountLink'

const TTL_MS = 5 * 60 * 1000
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const ACTIONS = new Set(['identity.passkey.register', 'identity.passkey.revoke', 'identity.totp.setup', 'identity.totp.revoke'])

function string(value: unknown) { return String(value || '').trim() }
function dataSource() { const ds = SingletonDataSource.get(); if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE'); return ds }
function identity(value: unknown) { const did = string(value); if (!/^did:yeying:wid_[A-Za-z0-9_-]{22,}$/.test(did)) throw new Error('IDENTITY_INVALID_DID'); return did }
function action(value: unknown) { const result = string(value); if (!ACTIONS.has(result)) throw new Error('IDENTITY_ACTION_UNSUPPORTED'); return result }
function hashPayload(payload: unknown) { return crypto.createHash('sha256').update(canonicalizeIdentityValue(payload ?? null)).digest('hex') }

export type IdentityActionAuthorization = { challengeId?: unknown; signature?: unknown }

export async function createIdentityActionChallenge(input: { identity: unknown; action: unknown; audience: unknown; payload: unknown }) {
  const identityDid = identity(input.identity)
  const actionName = action(input.action)
  const audience = string(input.audience)
  if (!audience) throw new Error('IDENTITY_ACTION_AUDIENCE_REQUIRED')
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
  const row = new IdentityActionChallengeDO()
  Object.assign(row, { challengeId: `iac_${randomBytes(24).toString('base64url')}`, identityDid, action: actionName, audience, payloadHash: hashPayload(input.payload), nonce: randomBytes(24).toString('base64url'), status: 'pending', issuedAt, expiresAt, consumedAt: '' })
  await dataSource().getRepository(IdentityActionChallengeDO).save(row)
  return { challengeId: row.challengeId, signingPayload: signingPayload(row), expiresAt }
}

function signingPayload(row: IdentityActionChallengeDO) {
  return { version: 1, purpose: 'wallet-identity-action-authorization', challengeId: row.challengeId, identity: row.identityDid, action: row.action, audience: row.audience, payloadHash: row.payloadHash, nonce: row.nonce, issuedAt: row.issuedAt, expiresAt: row.expiresAt }
}

export async function consumeIdentityActionAuthorization(input: { identity: unknown; identityDocument: any; action: unknown; audience: unknown; payload: unknown; authorization: IdentityActionAuthorization }) {
  const identityDid = identity(input.identity)
  const actionName = action(input.action)
  const challengeId = string(input.authorization?.challengeId)
  const signature = string(input.authorization?.signature)
  if (!challengeId || !signature) throw new Error('IDENTITY_ACTION_AUTHORIZATION_REQUIRED')
  const repo = dataSource().getRepository(IdentityActionChallengeDO)
  const row = await repo.findOneBy({ challengeId, status: 'pending' })
  if (!row) throw new Error('IDENTITY_ACTION_CHALLENGE_INVALID')
  if (Date.parse(row.expiresAt) <= Date.now()) throw new Error('IDENTITY_ACTION_CHALLENGE_EXPIRED')
  if (row.identityDid !== identityDid || row.action !== actionName || row.audience !== string(input.audience) || row.payloadHash !== hashPayload(input.payload)) throw new Error('IDENTITY_ACTION_CONTEXT_MISMATCH')
  verifyIdentityController(input.identityDocument, identityDid)
  const method = string(input.identityDocument?.proof?.verificationMethod)
  const controller = input.identityDocument.controllers?.find((item: any) => `${identityDid}#${item.controllerId}` === method && item.status === 'active' && item.purposes?.includes('manage'))
  const raw = Buffer.from(string(controller?.publicKey), 'base64url')
  if (raw.length !== 32) throw new Error('IDENTITY_ACTION_SIGNATURE_INVALID')
  const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
  if (!crypto.verify(null, Buffer.from(canonicalizeIdentityValue(signingPayload(row))), key, Buffer.from(signature, 'base64url'))) throw new Error('IDENTITY_ACTION_SIGNATURE_INVALID')
  const consumedAt = new Date().toISOString()
  const result = await repo.update({ challengeId, status: 'pending' }, { status: 'consumed', consumedAt })
  if (result.affected !== 1) throw new Error('IDENTITY_ACTION_CHALLENGE_INVALID')
  return { challengeId, consumedAt }
}
