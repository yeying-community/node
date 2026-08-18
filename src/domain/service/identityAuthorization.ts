import { createHash, randomBytes } from 'node:crypto'
import { ApplicationService } from './application'
import { SingletonDataSource } from '../facade/datasource'
import { IdentityAuthorizationCodeDO, IdentityAuthorizationRequestDO, IdentityCredentialDO } from '../mapper/entity'
import { canonicalizeIdentityValue } from '../../auth/identityAccountLink'
import * as crypto from 'node:crypto'

const REQUEST_TTL_MS = 5 * 60 * 1000
const CODE_TTL_MS = 60 * 1000
const ALLOWED_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.username', 'identity.email'])
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function id(prefix: string) { return `${prefix}_${randomBytes(24).toString('base64url')}` }
function now() { return new Date().toISOString() }
function dataSource() { const ds = SingletonDataSource.get(); if (!ds?.isInitialized) throw new Error('IDENTITY_STORAGE_UNAVAILABLE'); return ds }
function string(value: unknown) { return String(value || '').trim() }
function scopes(value: unknown): string[] {
  const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/) : []
  const result = [...new Set(input.map(string).filter(Boolean))]
  if (!result.includes('identity.basic')) result.unshift('identity.basic')
  if (result.length === 0 || result.some(scope => !ALLOWED_SCOPES.has(scope))) throw new Error('IDENTITY_SCOPE_INVALID')
  return result
}
function appRedirects(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(string).filter(Boolean)
  const raw = string(value)
  if (!raw) return []
  try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed.map(string).filter(Boolean) } catch { /* single value */ }
  return raw.split(/[\n,]/).map(string).filter(Boolean)
}
function origin(uri: string) { try { return new URL(uri).origin } catch { throw new Error('IDENTITY_REDIRECT_URI_INVALID') } }
function pkce(verifier: unknown, challenge: string) {
  const value = string(verifier)
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(value)) throw new Error('IDENTITY_PKCE_VERIFIER_INVALID')
  const actual = createHash('sha256').update(value).digest('base64url')
  if (actual !== challenge) throw new Error('IDENTITY_PKCE_VERIFICATION_FAILED')
}
function verifyPresentation(value: any, expectedAudience: string, expectedNonce: string) {
  const holder = string(value?.holder)
  if (!/^did:yeying:wid_[A-Za-z0-9_-]{22,}$/.test(holder)) throw new Error('IDENTITY_PRESENTATION_INVALID')
  if (string(value?.audience) !== expectedAudience || string(value?.nonce) !== expectedNonce) throw new Error('IDENTITY_PRESENTATION_CONTEXT_INVALID')
  if (!value?.identityDocument || value.identityDocument.id !== holder || !value?.proof?.proofValue) throw new Error('IDENTITY_PRESENTATION_INVALID')
  const method = string(value.proof.verificationMethod)
  const controller = value.identityDocument.controllers?.find((item: any) => `${holder}#${item.controllerId}` === method && item.status === 'active' && item.purposes?.includes('authentication'))
  if (!controller) throw new Error('IDENTITY_CONTROLLER_NOT_AUTHORIZED')
  const raw = Buffer.from(string(controller.publicKey), 'base64url')
  if (raw.length !== 32) throw new Error('IDENTITY_PRESENTATION_INVALID')
  const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' })
  const { proof, ...unsigned } = value
  if (!crypto.verify(null, Buffer.from(canonicalizeIdentityValue(unsigned)), key, Buffer.from(string(proof.proofValue), 'base64url'))) throw new Error('IDENTITY_PRESENTATION_INVALID')
  return holder
}

export class IdentityAuthorizationService {
  private applications = new ApplicationService()

  async create(input: { appId: unknown; redirectUri: unknown; state?: unknown; codeChallenge: unknown; codeChallengeMethod?: unknown; scopes?: unknown }) {
    const appId = string(input.appId); const redirectUri = string(input.redirectUri); const challenge = string(input.codeChallenge)
    if (!appId || !redirectUri || !/^[A-Za-z0-9_-]{43,256}$/.test(challenge) || string(input.codeChallengeMethod || 'S256') !== 'S256') throw new Error('IDENTITY_AUTHORIZATION_REQUEST_INVALID')
    const app = await this.applications.queryByUid(appId)
    if (!app || !appRedirects(app.redirectUris).includes(redirectUri)) throw new Error('IDENTITY_REDIRECT_URI_UNAUTHORIZED')
    const entity = new IdentityAuthorizationRequestDO(); const createdAt = now()
    Object.assign(entity, { requestId: id('iar'), appId, redirectUri, state: string(input.state), codeChallenge: challenge, codeChallengeMethod: 'S256', scopesJson: JSON.stringify(scopes(input.scopes)), nonce: id('nonce'), identityDid: '', status: 'pending', createdAt, updatedAt: createdAt, expiresAt: new Date(Date.now() + REQUEST_TTL_MS).toISOString(), approvedAt: '' })
    await dataSource().getRepository(IdentityAuthorizationRequestDO).save(entity)
    return this.view(entity, app.name || appId)
  }

  async get(requestId: unknown) { const row = await dataSource().getRepository(IdentityAuthorizationRequestDO).findOneBy({ requestId: string(requestId) }); if (!row) throw new Error('IDENTITY_AUTHORIZATION_REQUEST_NOT_FOUND'); const app = await this.applications.queryByUid(row.appId); return this.view(row, app?.name || row.appId) }

  async approve(input: { requestId: unknown; presentation: unknown }) {
    const repo = dataSource().getRepository(IdentityAuthorizationRequestDO); const row = await repo.findOneBy({ requestId: string(input.requestId) })
    if (!row || row.status !== 'pending' || Date.parse(row.expiresAt) <= Date.now()) throw new Error('IDENTITY_AUTHORIZATION_REQUEST_EXPIRED')
    const identityDid = verifyPresentation(input.presentation, origin(row.redirectUri), row.nonce)
    const presentationScopes = scopes((input.presentation as any)?.scopes)
    const requested = scopes(JSON.parse(row.scopesJson))
    if (requested.some(scope => !presentationScopes.includes(scope))) throw new Error('IDENTITY_PRESENTATION_SCOPE_INVALID')
    const issuedAt = now(); const code = id('iac')
    const codeRow = new IdentityAuthorizationCodeDO(); Object.assign(codeRow, { code, requestId: row.requestId, appId: row.appId, redirectUri: row.redirectUri, state: row.state, codeChallenge: row.codeChallenge, scopesJson: row.scopesJson, identityDid, issuedAt, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), used: false, usedAt: '' })
    row.status = 'approved'; row.identityDid = identityDid; row.approvedAt = issuedAt; row.updatedAt = issuedAt
    await dataSource().transaction(async manager => { await manager.getRepository(IdentityAuthorizationRequestDO).save(row); await manager.getRepository(IdentityAuthorizationCodeDO).save(codeRow) })
    return { requestId: row.requestId, authorizationCode: code, authorizationCodeExpiresAt: codeRow.expiresAt, redirectTo: `${row.redirectUri}${row.redirectUri.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}${row.state ? `&state=${encodeURIComponent(row.state)}` : ''}` }
  }

  async exchange(input: { code: unknown; appId: unknown; redirectUri: unknown; codeVerifier: unknown }) {
    const repo = dataSource().getRepository(IdentityAuthorizationCodeDO); const row = await repo.findOneBy({ code: string(input.code) })
    if (!row || row.used || Date.parse(row.expiresAt) <= Date.now()) throw new Error('IDENTITY_AUTHORIZATION_CODE_INVALID')
    if (row.appId !== string(input.appId) || row.redirectUri !== string(input.redirectUri)) throw new Error('IDENTITY_AUTHORIZATION_CODE_APP_MISMATCH')
    pkce(input.codeVerifier, row.codeChallenge); row.used = true; row.usedAt = now(); await repo.save(row)
    const requested = scopes(JSON.parse(row.scopesJson)); const credentials = await dataSource().getRepository(IdentityCredentialDO).findBy({ identityDid: row.identityDid, status: 'active' })
    const wanted = new Set(requested.includes('identity.email') ? ['email'] : []); if (requested.includes('identity.username')) wanted.add('username')
    return { requestId: row.requestId, appId: row.appId, redirectUri: row.redirectUri, state: row.state, walletIdentityId: row.identityDid.slice('did:yeying:'.length), did: row.identityDid, scopes: requested, issuedAt: row.usedAt, credentials: credentials.filter(item => wanted.has(item.credentialType) && Date.parse(item.expiresAt) > Date.now()).map(item => ({ type: item.credentialType, credentialId: item.credentialId, credential: item.token })) }
  }

  private view(row: IdentityAuthorizationRequestDO, appName: string) { return { requestId: row.requestId, status: row.status, appId: row.appId, appName, redirectUri: row.redirectUri, state: row.state, audience: origin(row.redirectUri), nonce: row.nonce, scopes: scopes(JSON.parse(row.scopesJson)), expiresAt: row.expiresAt } }
}
