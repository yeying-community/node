import { Wallet } from 'ethers'
import { SingletonDataSource } from '../src/domain/facade/datasource'
import { createInMemoryDataSource } from './helpers/inMemoryDataSource'

SingletonDataSource.set(createInMemoryDataSource())

const identityKey = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const publicJwk = await crypto.subtle.exportKey('jwk', identityKey.publicKey)
const rawPublic = Buffer.from(publicJwk.x!, 'base64url').toString('base64url')
const identity = 'did:yeying:wid_1234567890123456789012'
const controllerId = 'controller-1'
const unsigned = {
  version: 1, id: identity, walletIdentityId: 'wid_1234567890123456789012', createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z', revision: 1,
  controllers: [{ controllerId, kind: 'wallet_key', publicKey: rawPublic, algorithm: 'Ed25519', purposes: ['authentication', 'assertion', 'manage'], status: 'active' }], accounts: [], issuers: [], recovery: { version: 1, manageThreshold: 1, controllerChangeDelaySeconds: 86400 }
}
function canonicalize(value: any): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
}
const signature = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, identityKey.privateKey, new TextEncoder().encode(canonicalize(unsigned)))).toString('base64url')
const document = { ...unsigned, proof: { type: 'YeyingIdentityDocumentProofV1', verificationMethod: `${identity}#${controllerId}`, proofValue: signature } }

const { issueAccountLinkChallenge, verifyAccountLink } = await import('../src/auth/identityAccountLink')

describe('identity account link', () => {
  it('requires both the wallet identity proof and EVM account signature', async () => {
    const wallet = Wallet.createRandom()
    const challenge = await issueAccountLinkChallenge({ identity, account: { chainKey: 'eip155:1', address: wallet.address } })
    const accountSignature = await wallet.signMessage(challenge.message)
    const result = await verifyAccountLink({ identityDocument: document, identity, account: challenge.account, nonce: challenge.nonce, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt, accountSignature })
    expect(result.account.address).toBe(wallet.address)
    await expect(verifyAccountLink({ identityDocument: document, identity, account: challenge.account, nonce: challenge.nonce, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt, accountSignature })).rejects.toThrow('IDENTITY_ACCOUNT_PROOF_INVALID')
  })

  it('rejects a signature from another address', async () => {
    const wallet = Wallet.createRandom()
    const other = Wallet.createRandom()
    const challenge = await issueAccountLinkChallenge({ identity, account: { chainKey: 'eip155:1', address: wallet.address } })
    const accountSignature = await other.signMessage(challenge.message)
    await expect(verifyAccountLink({ identityDocument: document, identity, account: challenge.account, nonce: challenge.nonce, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt, accountSignature })).rejects.toThrow('IDENTITY_ACCOUNT_PROOF_INVALID')
  })
})
