import { Wallet } from 'ethers'
import { vi } from 'vitest'

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => {
    const values: Record<string, unknown> = {
      'auth.accessTtlMs': 15 * 60 * 1000,
      'auth.refreshTtlMs': 7 * 24 * 60 * 60 * 1000,
      'auth.challengeTtlMs': 5 * 60 * 1000,
      'auth.chainId': 1,
    }
    return values[key]
  },
}))

const { deleteChallenge, getChallenge, issueChallenge, verifyChallengeSignature } = await import('../src/auth/siwe')

describe('SIWE challenge', () => {
  it('creates independently addressable challenges for concurrent logins', () => {
    const wallet = Wallet.createRandom()
    const first = issueChallenge(wallet.address, { domain: 'node.example', uri: 'https://node.example', chainId: 1 })
    const second = issueChallenge(wallet.address, { domain: 'node.example', uri: 'https://node.example', chainId: 1 })

    expect(first.nonce).not.toBe(second.nonce)
    expect(getChallenge(first.nonce)?.challenge).toBe(first.challenge)
    expect(getChallenge(second.nonce)?.challenge).toBe(second.challenge)

    deleteChallenge(first.nonce)
    deleteChallenge(second.nonce)
  })

  it('verifies the complete EIP-4361 context', async () => {
    const wallet = Wallet.createRandom()
    const record = issueChallenge(wallet.address, { domain: 'node.example', uri: 'https://node.example/login', chainId: 1 })
    const signature = await wallet.signMessage(record.challenge)

    await expect(verifyChallengeSignature(record.challenge, signature, record)).resolves.toBe(true)
    await expect(verifyChallengeSignature(record.challenge, signature, { ...record, domain: 'evil.example' })).resolves.toBe(false)
    await expect(verifyChallengeSignature(record.challenge, signature, { ...record, nonce: 'wrongnonce' })).resolves.toBe(false)
    await expect(verifyChallengeSignature(record.challenge, signature, { ...record, chainId: 10 })).resolves.toBe(false)

    deleteChallenge(record.nonce)
  })
})
