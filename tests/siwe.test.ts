import { Wallet } from 'ethers'
import { deleteChallenge, getChallenge, issueChallenge, verifyChallengeSignature } from '../src/auth/siwe'

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
