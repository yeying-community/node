type Ed25519KeyPair = { publicKey: CryptoKey; privateKey: CryptoKey }
const IDENTITY_DB = 'yeying-node-identity'
const IDENTITY_STORE = 'materials'

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('IDENTITY_CANONICAL_VALUE_INVALID')
}

async function generateEd25519(): Promise<Ed25519KeyPair> {
  if (!crypto?.subtle) throw new Error('IDENTITY_WEBCRYPTO_UNAVAILABLE')
  return await crypto.subtle.generateKey({ name: 'Ed25519' } as any, true, ['sign', 'verify']) as Ed25519KeyPair
}

async function exportPublicKey(key: CryptoKey) {
  return base64Url(await crypto.subtle.exportKey('raw', key))
}

function openIdentityDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') throw new Error('IDENTITY_LOCAL_STORAGE_UNAVAILABLE')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDENTITY_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(IDENTITY_STORE, { keyPath: 'identity' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IDENTITY_LOCAL_STORAGE_UNAVAILABLE'))
  })
}

async function persistIdentityMaterial(identity: string, controller: Ed25519KeyPair, recovery: Ed25519KeyPair) {
  const db = await openIdentityDb()
  const [controllerPrivateJwk, recoveryPrivateJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', controller.privateKey),
    crypto.subtle.exportKey('jwk', recovery.privateKey),
  ])
  const wrappingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify({ controllerPrivateJwk, recoveryPrivateJwk }))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, plaintext)
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(IDENTITY_STORE, 'readwrite')
    transaction.objectStore(IDENTITY_STORE).put({ identity, wrappingKey, iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)), createdAt: new Date().toISOString() })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IDENTITY_LOCAL_STORAGE_UNAVAILABLE'))
  })
  db.close()
}

async function signDocument(document: Record<string, unknown>, key: CryptoKey, verificationMethod: string) {
  const { proof: _proof, ...unsigned } = document
  const signature = await crypto.subtle.sign({ name: 'Ed25519' } as any, key, new TextEncoder().encode(canonicalize(unsigned)))
  return {
    ...unsigned,
    proof: {
      type: 'YeyingIdentityDocumentProofV1',
      created: new Date().toISOString(),
      verificationMethod,
      purpose: 'assertionMethod',
      proofValue: base64Url(signature),
    },
  }
}

export async function createBrowserIdentity() {
  const identityBytes = crypto.getRandomValues(new Uint8Array(16))
  const walletIdentityId = `wid_${base64Url(identityBytes)}`
  const identity = `did:yeying:${walletIdentityId}`
  const controllerId = 'controller-1'
  const controller = await generateEd25519()
  const recovery = await generateEd25519()
  const createdAt = new Date().toISOString()
  const document = {
    version: 1,
    id: identity,
    walletIdentityId,
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    controllers: [{ controllerId, kind: 'wallet_key', publicKey: await exportPublicKey(controller.publicKey), algorithm: 'Ed25519', purposes: ['authentication', 'assertion', 'manage'], status: 'active', addedAt: createdAt }],
    accounts: [],
    issuers: [],
    recovery: { version: 1, manageThreshold: 1, controllerChangeDelaySeconds: 86400, publicKey: await exportPublicKey(recovery.publicKey), algorithm: 'Ed25519' },
  }
  const signedDocument = await signDocument(document, controller.privateKey, `${identity}#${controllerId}`)
  await persistIdentityMaterial(identity, controller, recovery)
  return { identity, document: signedDocument }
}
