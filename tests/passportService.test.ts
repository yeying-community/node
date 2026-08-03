import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config/runtime', () => ({
  getConfig: vi.fn((key: string) => {
    const values: Record<string, unknown> = {
      'passportAuth.passkey.enabled': true,
      'passportAuth.passkey.rpId': 'project.example',
      'passportAuth.passkey.rpName': 'Project',
      'passportAuth.passkey.origin': 'https://project.example',
      'passportAuth.passkey.timeoutMs': 60000,
      'passportAuth.passkey.challengeTtlMs': 120000,
    }
    return values[key]
  }),
}))

const webauthnMock = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: 'register-challenge',
    rp: { id: 'project.example', name: 'Project' },
    user: { id: 'subject', name: 'subject', displayName: 'wallet' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 60000,
    excludeCredentials: [],
  })),
  generateAuthenticationOptions: vi.fn(async (input: any) => ({
    challenge: 'authorize-challenge',
    timeout: 60000,
    rpId: input.rpID,
    allowCredentials: input.allowCredentials,
    userVerification: input.userVerification,
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: Buffer.from('credential-1'),
        publicKey: Buffer.from('public-key-1'),
        counter: 1,
        transports: ['internal'],
      },
      aaguid: 'aaguid-1',
    },
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: {
      newCounter: 2,
    },
  })),
}))

vi.mock('@simplewebauthn/server', () => webauthnMock)

const { PassportService } = await import('../src/domain/service/passport')

function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function createHarness() {
  const subjects = new Map<string, any>()
  const walletBindings = new Map<string, any>()
  const passkeys = new Map<string, any>()
  const webauthnChallenges = new Map<string, any>()
  const requests = new Map<string, any>()
  const codes = new Map<string, any>()
  const auditLogs: any[] = []

  const manager = {
    getSubject: async (subjectId: string) => subjects.get(subjectId) || null,
    saveSubject: async (subject: any) => {
      subjects.set(subject.subjectId, subject)
      return subject
    },
    getWalletBinding: async (chain: string, address: string) => walletBindings.get(`${chain}:${address}`) || null,
    listWalletBindings: async (subjectId: string) =>
      Array.from(walletBindings.values()).filter((item) => item.subjectId === subjectId),
    saveWalletBinding: async (binding: any) => {
      walletBindings.set(`${binding.chain}:${binding.address}`, binding)
      return binding
    },
    listPasskeyCredentials: async (subjectId: string) =>
      Array.from(passkeys.values()).filter((item) => item.subjectId === subjectId),
    getPasskeyCredentialById: async (credentialId: string) => passkeys.get(credentialId) || null,
    savePasskeyCredential: async (credential: any) => {
      passkeys.set(credential.credentialId, credential)
      return credential
    },
    saveWebauthnChallenge: async (challenge: any) => {
      webauthnChallenges.set(challenge.challengeId, challenge)
      return challenge
    },
    getWebauthnChallenge: async (challengeId: string) => webauthnChallenges.get(challengeId) || null,
    saveAuthorizationRequest: async (request: any) => {
      requests.set(request.requestId, request)
      return request
    },
    getAuthorizationRequest: async (requestId: string) => requests.get(requestId) || null,
    saveAuthorizationCode: async (code: any) => {
      codes.set(code.code, code)
      return code
    },
    getAuthorizationCode: async (code: string) => codes.get(code) || null,
    saveAuditLog: async (log: any) => {
      auditLogs.push(log)
      return log
    },
  }

  const applicationService = {
    queryByUid: async (uid: string) => ({
      uid,
      name: 'Project',
      isOnline: true,
      redirectUris: 'https://project.example/passport/callback',
    }),
  }

  const service = new PassportService(manager as any, applicationService as any)
  return { service, subjects, walletBindings, passkeys, webauthnChallenges, requests, codes, auditLogs }
}

describe('PassportService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a persisted authorization request and exchanges a PKCE-bound one-time code', async () => {
    const { service, subjects, walletBindings, codes, auditLogs } = createHarness()
    const pkce = createPkcePair()

    const request = await service.createAuthorizationRequest({
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      state: 'login-session-1',
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
    })

    expect(request.status).toBe('pending')
    expect(request.appId).toBe('project-app')
    expect(request.verifyUrl).toContain(`/passport-auth?requestId=${encodeURIComponent(request.requestId)}`)

    const approved = await service.approveAuthorizationRequest({
      requestId: request.requestId,
      walletAddress: '0xAbC0000000000000000000000000000000000001',
    })

    expect(approved.subjectId).toMatch(/^sub_/)
    expect(approved.walletAddress).toBe('0xabc0000000000000000000000000000000000001')
    expect(approved.redirectTo).toContain('code=')
    expect(subjects.size).toBe(1)
    expect(walletBindings.size).toBe(1)

    await expect(
      service.exchangeAuthorizationCode({
        code: approved.authorizationCode,
        appId: 'project-app',
        redirectUri: 'https://project.example/passport/callback',
        codeVerifier: createPkcePair().verifier,
      }),
    ).rejects.toThrow('Invalid codeVerifier')

    const exchanged = await service.exchangeAuthorizationCode({
      code: approved.authorizationCode,
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeVerifier: pkce.verifier,
    })

    expect(exchanged).toMatchObject({
      requestId: request.requestId,
      subjectId: approved.subjectId,
      walletAddress: approved.walletAddress,
      appId: 'project-app',
      state: 'login-session-1',
    })
    expect(codes.get(approved.authorizationCode).used).toBe(true)
    expect(auditLogs.map((item) => item.action)).toEqual(
      expect.arrayContaining(['authorize_requested', 'wallet_bound', 'authorize_approved', 'authorize_exchanged']),
    )

    await expect(
      service.exchangeAuthorizationCode({
        code: approved.authorizationCode,
        appId: 'project-app',
        redirectUri: 'https://project.example/passport/callback',
        codeVerifier: pkce.verifier,
      }),
    ).rejects.toThrow('Authorization code already used')
  })

  it('registers a subject-level passkey and uses it to approve a passport request', async () => {
    const { service, passkeys, webauthnChallenges, codes, auditLogs } = createHarness()
    const walletAddress = '0xAbC0000000000000000000000000000000000001'
    const pkce = createPkcePair()

    const registerRequest = await service.createPasskeyRegisterRequest({
      walletAddress,
      deviceName: 'MacBook',
    })
    expect(registerRequest.passkeyRequest.requestId).toMatch(/^pwc_/)
    expect(webauthnChallenges.size).toBe(1)

    const registered = await service.confirmPasskeyRegistration({
      walletAddress,
      requestId: registerRequest.passkeyRequest.requestId,
      credential: { id: 'credential-1', type: 'public-key', response: {} },
    })
    expect(registered).toMatchObject({
      subjectId: registerRequest.subjectId,
      credentialId: Buffer.from('credential-1').toString('base64url'),
    })
    expect(passkeys.size).toBe(1)

    const request = await service.createAuthorizationRequest({
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
    })
    const challenge = await service.createPasskeyAuthorizationChallenge({ requestId: request.requestId })
    expect(challenge.passkeyRequest.requestId).toMatch(/^pwc_/)
    expect(challenge.passkeyRequest.allowCredentials).toBeUndefined()

    const approved = await service.confirmPasskeyAuthorization({
      requestId: request.requestId,
      passkeyRequestId: challenge.passkeyRequest.requestId,
      credential: { id: registered.credentialId, type: 'public-key', response: {} },
    })

    expect(approved.subjectId).toBe(registerRequest.subjectId)
    expect(approved.walletAddress).toBe('0xabc0000000000000000000000000000000000001')
    expect(codes.get(approved.authorizationCode).codeChallenge).toBe(pkce.challenge)
    expect(passkeys.get(registered.credentialId).signCount).toBe('2')
    expect(auditLogs.map((item) => item.action)).toEqual(
      expect.arrayContaining(['passkey_register_requested', 'passkey_registered', 'authorize_passkey_approved']),
    )

    await expect(
      service.confirmPasskeyAuthorization({
        requestId: request.requestId,
        passkeyRequestId: challenge.passkeyRequest.requestId,
        credential: { id: registered.credentialId, type: 'public-key', response: {} },
      }),
    ).rejects.toThrow('passport authorize request is not pending')
  })

  it('rejects redirect URIs outside the published application policy', async () => {
    const { service } = createHarness()
    const pkce = createPkcePair()

    await expect(
      service.createAuthorizationRequest({
        appId: 'project-app',
        redirectUri: 'https://evil.example/callback',
        codeChallenge: pkce.challenge,
        codeChallengeMethod: 'S256',
      }),
    ).rejects.toThrow('redirectUri is not allowed')
  })
})
