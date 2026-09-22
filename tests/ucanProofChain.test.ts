import { generateKeyPairSync, sign as signBytes } from 'node:crypto'
import { Wallet } from 'ethers'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/config/runtime', () => ({
  getConfig: (key: string) => ({
    'app.port': 8100,
    'ucan.aud': 'did:web:node.example',
    'ucan.with': 'node:application:*',
    'ucan.can': 'invoke',
    'issuer.ucan.enabled': false,
    'issuer.ucan.mode': 'verify',
    'issuer.baseUrl': 'https://node.example',
  } as Record<string, unknown>)[key],
}))

vi.mock('../src/security/secretVault', () => ({
  getRuntimeSecret: () => '',
}))

const { verifyUcanInvocationWithCap } = await import('../src/auth/ucan')

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(input: Buffer): string {
  const digits: number[] = [0]
  for (const byte of input) {
    let carry = byte
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] * 256
      digits[index] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let zeros = 0
  while (zeros < input.length && input[zeros] === 0) zeros += 1
  return '1'.repeat(zeros) + digits.reverse().map(index => BASE58_ALPHABET[index]).join('')
}

function createDidKey() {
  const keyPair = generateKeyPairSync('ed25519')
  const der = keyPair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  const rawPublicKey = der.subarray(-32)
  const did = `did:key:z${base58Encode(Buffer.concat([Buffer.from([0xed, 0x01]), rawPublicKey]))}`
  return { did, privateKey: keyPair.privateKey }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function createUcanToken(input: {
  issuer: { did: string; privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'] }
  audience: string
  capabilities: Array<{ with: string; can: string }>
  expiresAt: number
  proof?: unknown[]
}) {
  const header = { alg: 'EdDSA', typ: 'UCAN', ucv: '0.10.0' }
  const payload = {
    iss: input.issuer.did,
    aud: input.audience,
    cap: input.capabilities,
    exp: input.expiresAt,
    ...(input.proof ? { prf: input.proof } : {}),
  }
  const signingInput = `${encode(header)}.${encode(payload)}`
  const signature = signBytes(null, Buffer.from(signingInput), input.issuer.privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

async function createRootProof(input: {
  audience: string
  capabilities: Array<{ with: string; can: string }>
  expiresAt: number
}) {
  const wallet = Wallet.createRandom()
  const message = [
    'YeYing UCAN authorization',
    `UCAN-AUTH: ${JSON.stringify({
      aud: input.audience,
      cap: input.capabilities,
      exp: input.expiresAt,
    })}`,
  ].join('\n')
  return {
    type: 'siwe' as const,
    iss: `did:pkh:eth:${wallet.address.toLowerCase()}`,
    aud: input.audience,
    cap: input.capabilities,
    exp: input.expiresAt,
    siwe: {
      message,
      signature: await wallet.signMessage(message),
    },
  }
}

describe('wallet UCAN proof chain', () => {
  it('accepts a delegated invocation whose audience, capability, and expiry are bounded by root', async () => {
    const session = createDidKey()
    const root = await createRootProof({
      audience: session.did,
      capabilities: [{ with: 'node:application:*', can: 'read,invoke' }],
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    })
    const invocation = createUcanToken({
      issuer: session,
      audience: 'did:web:node.example',
      capabilities: [{ with: 'node:application:own', can: 'read' }],
      expiresAt: Math.floor(Date.now() / 1000) + 120,
      proof: [root],
    })

    await expect(verifyUcanInvocationWithCap(invocation, [
      { with: 'node:application:own', can: 'read' },
    ])).resolves.toMatchObject({ source: 'wallet' })
  })

  it('rejects a child that expands the resource, action, or expiry beyond root', async () => {
    const session = createDidKey()
    const root = await createRootProof({
      audience: session.did,
      capabilities: [{ with: 'node:application:own', can: 'read' }],
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    })

    const expandedResource = createUcanToken({
      issuer: session,
      audience: 'did:web:node.example',
      capabilities: [{ with: 'node:application:*', can: 'read' }],
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      proof: [root],
    })
    await expect(verifyUcanInvocationWithCap(expandedResource, [
      { with: 'node:application:*', can: 'read' },
    ])).rejects.toThrow('Root capability denied')

    const expandedAction = createUcanToken({
      issuer: session,
      audience: 'did:web:node.example',
      capabilities: [{ with: 'node:application:own', can: 'write' }],
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      proof: [root],
    })
    await expect(verifyUcanInvocationWithCap(expandedAction, [
      { with: 'node:application:own', can: 'write' },
    ])).rejects.toThrow('Root capability denied')

    const extendedExpiry = createUcanToken({
      issuer: session,
      audience: 'did:web:node.example',
      capabilities: [{ with: 'node:application:own', can: 'read' }],
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      proof: [root],
    })
    await expect(verifyUcanInvocationWithCap(extendedExpiry, [
      { with: 'node:application:own', can: 'read' },
    ])).rejects.toThrow('Root expired')
  })

  it('rejects a proof whose audience is not the child issuer', async () => {
    const session = createDidKey()
    const wrongAudience = createDidKey()
    const root = await createRootProof({
      audience: wrongAudience.did,
      capabilities: [{ with: 'node:application:*', can: 'read' }],
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    })
    const invocation = createUcanToken({
      issuer: session,
      audience: 'did:web:node.example',
      capabilities: [{ with: 'node:application:own', can: 'read' }],
      expiresAt: Math.floor(Date.now() / 1000) + 120,
      proof: [root],
    })

    await expect(verifyUcanInvocationWithCap(invocation, [
      { with: 'node:application:own', can: 'read' },
    ])).rejects.toThrow('Root audience mismatch')
  })
})
