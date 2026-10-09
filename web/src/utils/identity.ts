export type BrowserIdentity = {
  identity: string
  document: Record<string, any>
  controllerId: string
  publicJwk: JsonWebKey
  privateJwk: JsonWebKey
  recoveryPublicJwk: JsonWebKey
  recoveryPrivateJwk: JsonWebKey
  encryptedKeyMaterial: string
}

const ENCRYPTED_DATA_VERSION = 'v2'
const PBKDF2_ITERATIONS = 210000

function base64(bytes: ArrayBuffer | Uint8Array) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(',')}}`
  throw new Error('IDENTITY_CANONICAL_VALUE_INVALID')
}

async function importPrivateJwk(jwk: JsonWebKey) {
  return await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' } as any, true, ['sign'])
}

export async function encryptObjectWithPassword(value: unknown, password: string) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('密码至少需要 8 位')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, passwordKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  const payload = new Uint8Array(salt.length + iv.length + encrypted.byteLength)
  payload.set(salt, 0)
  payload.set(iv, salt.length)
  payload.set(new Uint8Array(encrypted), salt.length + iv.length)
  return `${ENCRYPTED_DATA_VERSION}.${base64(payload)}`
}

async function signDocument(document: Record<string, any>, privateKey: CryptoKey, verificationMethod: string) {
  const { proof: _proof, ...unsigned } = document
  const signature = await crypto.subtle.sign({ name: 'Ed25519' } as any, privateKey, new TextEncoder().encode(canonicalize(unsigned)))
  return { ...unsigned, proof: { type: 'YeyingIdentityDocumentProofV1', created: new Date().toISOString(), verificationMethod, purpose: 'assertionMethod', proofValue: base64Url(signature) } }
}

async function exportKeyPair(pair: CryptoKeyPair) {
  const [publicJwk, privateJwk, rawPublic] = await Promise.all([crypto.subtle.exportKey('jwk', pair.publicKey), crypto.subtle.exportKey('jwk', pair.privateKey), crypto.subtle.exportKey('raw', pair.publicKey)])
  return { publicJwk, privateJwk, publicKey: base64Url(rawPublic) }
}

export async function createBrowserIdentity(password: string): Promise<BrowserIdentity> {
  if (typeof password !== 'string' || password.length < 8) throw new Error('密码至少需要 8 位')
  const identityBytes = crypto.getRandomValues(new Uint8Array(16))
  const walletIdentityId = `wid_${base64Url(identityBytes)}`
  const identity = `did:yeying:${walletIdentityId}`
  const controllerId = 'controller-1'
  const [controller, recovery] = await Promise.all([crypto.subtle.generateKey({ name: 'Ed25519' } as any, true, ['sign', 'verify']) as Promise<CryptoKeyPair>, crypto.subtle.generateKey({ name: 'Ed25519' } as any, true, ['sign', 'verify']) as Promise<CryptoKeyPair>])
  const [controllerKeys, recoveryKeys] = await Promise.all([exportKeyPair(controller), exportKeyPair(recovery)])
  const createdAt = new Date().toISOString()
  const unsigned = { version: 1, id: identity, walletIdentityId, createdAt, updatedAt: createdAt, revision: 1, controllers: [{ controllerId, kind: 'wallet_key', publicKey: controllerKeys.publicKey, algorithm: 'Ed25519', purposes: ['authentication', 'assertion', 'manage'], status: 'active', addedAt: createdAt }], accounts: [], issuers: [], recovery: { version: 1, manageThreshold: 1, controllerChangeDelaySeconds: 86400, publicKey: recoveryKeys.publicKey, algorithm: 'Ed25519' } }
  const document = await signDocument(unsigned, controller.privateKey, `${identity}#${controllerId}`)
  const encryptedKeyMaterial = await encryptObjectWithPassword({ privateJwk: controllerKeys.privateJwk, recoveryPrivateJwk: recoveryKeys.privateJwk }, password)
  return { identity, document, controllerId, publicJwk: controllerKeys.publicJwk, privateJwk: controllerKeys.privateJwk, recoveryPublicJwk: recoveryKeys.publicJwk, recoveryPrivateJwk: recoveryKeys.privateJwk, encryptedKeyMaterial }
}

export async function addBrowserIdentityAccount(identity: BrowserIdentity, account: { accountId: string; chainKey: string; address: string; publicKey?: string }) {
  const controller = await importPrivateJwk(identity.privateJwk)
  const accounts = Array.isArray(identity.document.accounts) ? identity.document.accounts.filter((item: any) => item.accountId !== account.accountId) : []
  const createdAt = new Date().toISOString()
  const document = await signDocument({ ...identity.document, updatedAt: createdAt, revision: Number(identity.document.revision || 1) + 1, accounts: [...accounts, { ...account, family: 'evm', controllerId: identity.controllerId, status: 'active', createdAt }] }, controller, `${identity.identity}#${identity.controllerId}`)
  return { ...identity, document }
}
