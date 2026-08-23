import { createHash, randomBytes } from 'node:crypto'
import { ApplicationService } from './application'
import { SingletonDataSource } from '../facade/datasource'
import { IdentityAuthorizationCodeDO, IdentityAuthorizationRequestDO, IdentityCredentialDO, IdentityAccountLinkDO, IdentityPasskeyCredentialDO, IdentityWebauthnChallengeDO } from '../mapper/entity'
import { canonicalizeIdentityValue, verifyIdentityController } from '../../auth/identityAccountLink'
import * as crypto from 'node:crypto'
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import { assertPasskeyAuthReady, getPasskeyAuthStatus } from '../../auth/identityPasskeyAuth'
import { getConfig } from '../../config/runtime'

const REQUEST_TTL_MS = 5 * 60 * 1000
const CODE_TTL_MS = 60 * 1000
const ALLOWED_SCOPES = new Set(['identity.basic', 'identity.wallet', 'identity.username', 'identity.email'])
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const VERIFY_PATH = '/identity/authorize'

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
function normalizedOrigin(uri: unknown): string {
  const raw = string(uri).replace(/\/+$/, '')
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'chrome-extension:') return `chrome-extension://${parsed.host}`
    if (parsed.origin && parsed.origin !== 'null') return parsed.origin
  } catch {
    if (/^chrome-extension:\/\/[A-Za-z0-9_-]+$/.test(raw)) return raw
  }
  return ''
}
function credentialClientDataOrigin(credential: any): string {
  const raw = string(credential?.response?.clientDataJSON)
  if (!raw) throw new Error('IDENTITY_PASSKEY_CLIENT_DATA_REQUIRED')
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return normalizedOrigin(parsed?.origin)
  } catch {
    throw new Error('IDENTITY_PASSKEY_CLIENT_DATA_INVALID')
  }
}
function portalBaseUrl() {
  const raw = String(process.env.IDENTITY_AUTH_PORTAL_BASE_URL || getConfig<string>('identityAuth.portalBaseUrl') || '').trim()
  if (raw) return raw.replace(/\/+$/, '')
  const passkey = getPasskeyAuthStatus()
  return passkey.origin ? passkey.origin.replace(/\/+$/, '') : ''
}
function verifyUrl(requestId: string) {
  const path = `${VERIFY_PATH}?requestId=${encodeURIComponent(requestId)}`
  const base = portalBaseUrl()
  return base ? `${base}${path}` : path
}
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
function parseTransports(raw: string): string[] {
  const value = string(raw)
  if (!value) return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(string).filter(Boolean) : [] } catch { return [] }
}
function parseJsonArray(raw: string): string[] {
  try { const parsed = JSON.parse(string(raw) || '[]'); return Array.isArray(parsed) ? parsed.map(string).filter(Boolean) : [] } catch { return [] }
}
function credentialIdValue(input: unknown): string {
  if (!input) return ''
  if (typeof input === 'string') return string(input)
  if (input instanceof Uint8Array) return Buffer.from(input).toString('base64url')
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input)).toString('base64url')
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('base64url')
  return string(input)
}
async function findPasskeyCredential(candidates: unknown[]) {
  const repo = dataSource().getRepository(IdentityPasskeyCredentialDO)
  const ids = [...new Set(candidates.map(credentialIdValue).filter(Boolean))]
  const [credentialId] = ids
  for (const id of ids) {
    const row = await repo.findOneBy({ credentialId: id })
    if (row) return { row, credentialId: credentialId || id }
  }
  return { row: null, credentialId: credentialId || '' }
}
function assertIdentityDid(value: unknown) {
  const did = string(value)
  if (!/^did:yeying:wid_[A-Za-z0-9_-]{22,}$/.test(did)) throw new Error('IDENTITY_INVALID_DID')
  return did
}

export class IdentityAuthorizationService {
  private applications = new ApplicationService()

  private async publishedApplicationOrigins() {
    const result = await this.applications.search({}, 1, 1000)
    const origins = result.data.flatMap(app => appRedirects(app.redirectUris).map(normalizedOrigin))
    return [...new Set(origins.filter(Boolean))]
  }

  private async expectedPasskeyOrigin(status: { origin: string }, credential: any) {
    const credentialOrigin = credentialClientDataOrigin(credential)
    const allowed = [...new Set([normalizedOrigin(status.origin), ...(await this.publishedApplicationOrigins())].filter(Boolean))]
    if (!allowed.includes(credentialOrigin)) {
      throw new Error(`IDENTITY_PASSKEY_ORIGIN_UNAUTHORIZED:${credentialOrigin}`)
    }
    return credentialOrigin
  }

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
    await this.assertIdentityCanSatisfyScopes(identityDid, requested)
    return this.issueCode(row, identityDid)
  }

  async createPasskeyRegisterRequest(input: { identity: unknown; identityDocument: unknown; deviceName?: unknown }) {
    const status = assertPasskeyAuthReady()
    const identityDid = assertIdentityDid(input.identity)
    verifyIdentityController(input.identityDocument, identityDid)
    const credentials = await dataSource().getRepository(IdentityPasskeyCredentialDO).findBy({ identityDid })
    const activeCredentials = credentials.filter(item => !string(item.revokedAt))
    const generated = await generateRegistrationOptions({
      rpID: status.rpId,
      rpName: status.rpName,
      userID: Buffer.from(identityDid, 'utf8'),
      userName: identityDid,
      userDisplayName: `YeYing · ${identityDid.slice('did:yeying:'.length)}`,
      timeout: status.timeoutMs,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      excludeCredentials: activeCredentials.map(item => ({ id: item.credentialId, transports: parseTransports(item.transports) }))
    } as any)
    const createdAt = now()
    const challenge = new IdentityWebauthnChallengeDO()
    Object.assign(challenge, { challengeId: id('iwc'), challengeType: 'identity-register', identityDid, requestId: '', challenge: string((generated as any).challenge), allowedCredentialIds: JSON.stringify(activeCredentials.map(item => item.credentialId)), createdAt, expiresAt: new Date(Date.now() + status.challengeTtlMs).toISOString(), used: false })
    await dataSource().getRepository(IdentityWebauthnChallengeDO).save(challenge)
    return { identity: identityDid, passkeyRequest: { ...(generated as any), requestId: challenge.challengeId }, deviceName: string(input.deviceName) }
  }

  async confirmPasskeyRegistration(input: { identity: unknown; requestId: unknown; credential: any; deviceName?: unknown }) {
    const status = assertPasskeyAuthReady()
    const identityDid = assertIdentityDid(input.identity)
    const challengeRepo = dataSource().getRepository(IdentityWebauthnChallengeDO)
    const challenge = await challengeRepo.findOneBy({ challengeId: string(input.requestId) })
    if (!challenge || challenge.challengeType !== 'identity-register' || challenge.identityDid !== identityDid) throw new Error('IDENTITY_PASSKEY_CHALLENGE_NOT_FOUND')
    if (challenge.used) throw new Error('IDENTITY_PASSKEY_CHALLENGE_USED')
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('IDENTITY_PASSKEY_CHALLENGE_EXPIRED')
    const expectedOrigin = await this.expectedPasskeyOrigin(status, input.credential)
    const verification = await verifyRegistrationResponse({ response: input.credential, expectedChallenge: challenge.challenge, expectedOrigin, expectedRPID: status.rpId, requireUserVerification: true } as any)
    const info = (verification as any).registrationInfo
    if (!(verification as any).verified || !info) throw new Error('IDENTITY_PASSKEY_REGISTER_VERIFY_FAILED')
    const credentialId = credentialIdValue(input.credential?.id || input.credential?.rawId || info.credentialID || info.credential?.id)
    if (!credentialId) throw new Error('IDENTITY_PASSKEY_CREDENTIAL_ID_REQUIRED')
    const existing = await dataSource().getRepository(IdentityPasskeyCredentialDO).findOneBy({ credentialId })
    if (existing && !string(existing.revokedAt)) throw new Error('IDENTITY_PASSKEY_DUPLICATE_CREDENTIAL')
    const createdAt = now()
    const row = existing || new IdentityPasskeyCredentialDO()
    Object.assign(row, {
      identityDid,
      credentialId,
      publicKey: Buffer.from(info.credential?.publicKey || info.credentialPublicKey || new Uint8Array()).toString('base64url'),
      signCount: String(info.credential?.counter ?? info.counter ?? 0),
      aaguid: string(info.aaguid),
      transports: JSON.stringify(input.credential?.response?.transports || input.credential?.transports || []),
      deviceName: string(input.deviceName) || 'Passkey',
      rpId: status.rpId,
      userHandle: identityDid,
      createdAt: row.createdAt || createdAt,
      lastUsedAt: '',
      revokedAt: ''
    })
    challenge.used = true
    await dataSource().transaction(async manager => { await manager.getRepository(IdentityPasskeyCredentialDO).save(row); await manager.getRepository(IdentityWebauthnChallengeDO).save(challenge) })
    return { identity: identityDid, credentialId, deviceName: row.deviceName, createdAt: row.createdAt }
  }

  async listPasskeyCredentials(input: { identity: unknown }) {
    const identityDid = assertIdentityDid(input.identity)
    const credentials = await dataSource().getRepository(IdentityPasskeyCredentialDO).findBy({ identityDid })
    return {
      identity: identityDid,
      credentials: credentials
        .sort((a, b) => string(b.createdAt).localeCompare(string(a.createdAt)))
        .map(item => ({
          credentialId: item.credentialId,
          deviceName: item.deviceName || 'Passkey',
          rpId: item.rpId,
          transports: parseTransports(item.transports),
          createdAt: item.createdAt,
          lastUsedAt: item.lastUsedAt,
          revokedAt: item.revokedAt
        }))
    }
  }

  async revokePasskeyCredential(input: { identity: unknown; identityDocument: unknown; credentialId: unknown }) {
    const identityDid = assertIdentityDid(input.identity)
    verifyIdentityController(input.identityDocument, identityDid)
    const credentialId = credentialIdValue(input.credentialId)
    if (!credentialId) throw new Error('IDENTITY_PASSKEY_CREDENTIAL_ID_REQUIRED')
    const repo = dataSource().getRepository(IdentityPasskeyCredentialDO)
    const credential = await repo.findOneBy({ identityDid, credentialId })
    if (!credential) throw new Error('IDENTITY_PASSKEY_CREDENTIAL_NOT_FOUND')
    if (!string(credential.revokedAt)) {
      credential.revokedAt = now()
      await repo.save(credential)
    }
    return { identity: identityDid, credentialId: credential.credentialId, revokedAt: credential.revokedAt }
  }

  async createPasskeyAuthorizationChallenge(input: { requestId: unknown }) {
    const status = assertPasskeyAuthReady()
    const row = await this.requirePendingRequest(input.requestId)
    const generated = await generateAuthenticationOptions({ rpID: status.rpId, timeout: status.timeoutMs, userVerification: 'required' } as any)
    const createdAt = now()
    const challenge = new IdentityWebauthnChallengeDO()
    Object.assign(challenge, { challengeId: id('iwc'), challengeType: 'identity-authorize', identityDid: '', requestId: row.requestId, challenge: string((generated as any).challenge), allowedCredentialIds: '[]', createdAt, expiresAt: new Date(Date.now() + status.challengeTtlMs).toISOString(), used: false })
    await dataSource().getRepository(IdentityWebauthnChallengeDO).save(challenge)
    return { authorizeRequest: this.view(row, row.appId), passkeyRequest: { ...(generated as any), requestId: challenge.challengeId } }
  }

  async confirmPasskeyAuthorization(input: { requestId: unknown; passkeyRequestId: unknown; credential: any }) {
    const status = assertPasskeyAuthReady()
    const row = await this.requirePendingRequest(input.requestId)
    const challengeRepo = dataSource().getRepository(IdentityWebauthnChallengeDO)
    const challenge = await challengeRepo.findOneBy({ challengeId: string(input.passkeyRequestId) })
    if (!challenge || challenge.challengeType !== 'identity-authorize' || challenge.requestId !== row.requestId) throw new Error('IDENTITY_PASSKEY_CHALLENGE_NOT_FOUND')
    if (challenge.used) throw new Error('IDENTITY_PASSKEY_CHALLENGE_USED')
    if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('IDENTITY_PASSKEY_CHALLENGE_EXPIRED')
    const { row: credential, credentialId } = await findPasskeyCredential([input.credential?.id, input.credential?.rawId])
    if (!credentialId) throw new Error('IDENTITY_PASSKEY_CREDENTIAL_ID_REQUIRED')
    if (!credential || !credential.identityDid || string(credential.revokedAt)) throw new Error('IDENTITY_PASSKEY_CREDENTIAL_NOT_FOUND')
    const allowed = parseJsonArray(challenge.allowedCredentialIds)
    if (allowed.length > 0 && !allowed.includes(credential.credentialId) && !allowed.includes(credentialId)) throw new Error('IDENTITY_PASSKEY_CREDENTIAL_NOT_ALLOWED')
    const verification = await verifyAuthenticationResponse({
      response: input.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: status.origin,
      expectedRPID: status.rpId,
      credential: { id: credentialId, publicKey: Buffer.from(credential.publicKey, 'base64url'), counter: Number(credential.signCount || 0), transports: parseTransports(credential.transports) }
    } as any)
    if (!(verification as any).verified) throw new Error('IDENTITY_PASSKEY_AUTHORIZE_VERIFY_FAILED')
    const requested = scopes(JSON.parse(row.scopesJson))
    await this.assertIdentityCanSatisfyScopes(credential.identityDid, requested)
    credential.credentialId = credentialId
    credential.signCount = String((verification as any).authenticationInfo?.newCounter || credential.signCount || 0)
    credential.lastUsedAt = now()
    challenge.used = true
    await dataSource().transaction(async manager => { await manager.getRepository(IdentityPasskeyCredentialDO).save(credential); await manager.getRepository(IdentityWebauthnChallengeDO).save(challenge) })
    return this.issueCode(row, credential.identityDid)
  }

  async exchange(input: { code: unknown; appId: unknown; redirectUri: unknown; codeVerifier: unknown }) {
    const repo = dataSource().getRepository(IdentityAuthorizationCodeDO); const row = await repo.findOneBy({ code: string(input.code) })
    if (!row || row.used || Date.parse(row.expiresAt) <= Date.now()) throw new Error('IDENTITY_AUTHORIZATION_CODE_INVALID')
    if (row.appId !== string(input.appId) || row.redirectUri !== string(input.redirectUri)) throw new Error('IDENTITY_AUTHORIZATION_CODE_APP_MISMATCH')
    pkce(input.codeVerifier, row.codeChallenge); row.used = true; row.usedAt = now(); await repo.save(row)
    const requested = scopes(JSON.parse(row.scopesJson)); const credentials = await dataSource().getRepository(IdentityCredentialDO).findBy({ identityDid: row.identityDid, status: 'active' })
    const wanted = new Set(requested.includes('identity.email') ? ['EmailCredential'] : []); if (requested.includes('identity.username')) wanted.add('UsernameCredential')
    const accountLinks = await dataSource().getRepository(IdentityAccountLinkDO).findBy({ identityDid: row.identityDid, status: 'active' })
    const walletAddress = accountLinks.find(link => link.chainKey?.startsWith('eip155:'))?.accountId || ''
    return { requestId: row.requestId, appId: row.appId, redirectUri: row.redirectUri, state: row.state, walletIdentityId: row.identityDid.slice('did:yeying:'.length), did: row.identityDid, walletAddress, scopes: requested, issuedAt: row.usedAt, credentials: credentials.filter(item => wanted.has(item.credentialType) && Date.parse(item.expiresAt) > Date.now()).map(item => ({ type: item.credentialType, credentialId: item.credentialId, credential: item.token })) }
  }

  private async requirePendingRequest(requestId: unknown) {
    const row = await dataSource().getRepository(IdentityAuthorizationRequestDO).findOneBy({ requestId: string(requestId) })
    if (!row || row.status !== 'pending' || Date.parse(row.expiresAt) <= Date.now()) throw new Error('IDENTITY_AUTHORIZATION_REQUEST_EXPIRED')
    return row
  }

  private async assertIdentityCanSatisfyScopes(identityDid: string, requested: string[]) {
    const accountLinks = await dataSource().getRepository(IdentityAccountLinkDO).findBy({ identityDid, status: 'active' })
    if (requested.includes('identity.wallet') && !accountLinks.some(link => !string(link.revokedAt))) throw new Error('IDENTITY_WALLET_ACCOUNT_REQUIRED')
    const credentials = await dataSource().getRepository(IdentityCredentialDO).findBy({ identityDid, status: 'active' })
    const activeTypes = new Set(credentials.filter(item => !string(item.revokedAt) && Date.parse(item.expiresAt) > Date.now()).map(item => item.credentialType))
    if (requested.includes('identity.email') && !activeTypes.has('EmailCredential')) throw new Error('IDENTITY_EMAIL_REQUIRED')
    if (requested.includes('identity.username') && !activeTypes.has('UsernameCredential')) throw new Error('IDENTITY_USERNAME_REQUIRED')
  }

  private async issueCode(row: IdentityAuthorizationRequestDO, identityDid: string) {
    const issuedAt = now(); const code = id('iac')
    const codeRow = new IdentityAuthorizationCodeDO(); Object.assign(codeRow, { code, requestId: row.requestId, appId: row.appId, redirectUri: row.redirectUri, state: row.state, codeChallenge: row.codeChallenge, scopesJson: row.scopesJson, identityDid, issuedAt, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), used: false, usedAt: '' })
    row.status = 'approved'; row.identityDid = identityDid; row.approvedAt = issuedAt; row.updatedAt = issuedAt
    await dataSource().transaction(async manager => { await manager.getRepository(IdentityAuthorizationRequestDO).save(row); await manager.getRepository(IdentityAuthorizationCodeDO).save(codeRow) })
    return { requestId: row.requestId, did: identityDid, walletIdentityId: identityDid.slice('did:yeying:'.length), authorizationCode: code, authorizationCodeExpiresAt: codeRow.expiresAt, redirectTo: `${row.redirectUri}${row.redirectUri.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}${row.state ? `&state=${encodeURIComponent(row.state)}` : ''}` }
  }

  private view(row: IdentityAuthorizationRequestDO, appName: string) { return { requestId: row.requestId, status: row.status, appId: row.appId, appName, redirectUri: row.redirectUri, state: row.state, audience: origin(row.redirectUri), nonce: row.nonce, scopes: scopes(JSON.parse(row.scopesJson)), expiresAt: row.expiresAt, verifyUrl: verifyUrl(row.requestId), codeChallengeMethod: row.codeChallengeMethod || 'S256' } }
}
