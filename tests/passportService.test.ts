import crypto from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Wallet } from 'ethers'

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
  const emailChallenges = new Map<string, any>()
  const auditLogs: any[] = []

  const manager = {
    getSubject: async (subjectId: string) => subjects.get(subjectId) || null,
    saveSubject: async (subject: any) => {
      subjects.set(subject.subjectId, subject)
      return subject
    },
    saveEmailVerificationChallenge: async (challenge: any) => {
      emailChallenges.set(challenge.verificationId, challenge)
      return challenge
    },
    getEmailVerificationChallenge: async (verificationId: string) => emailChallenges.get(verificationId) || null,
    listEmailVerificationChallenges: async (subjectId: string) =>
      Array.from(emailChallenges.values())
        .filter((item) => item.subjectId === subjectId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
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
    listAuthorizationRequestsBySubject: async (subjectId: string) =>
      Array.from(requests.values()).filter((item) => item.subjectId === subjectId),
    saveAuthorizationCode: async (code: any) => {
      codes.set(code.code, code)
      return code
    },
    getAuthorizationCode: async (code: string) => codes.get(code) || null,
    listAuthorizationCodesBySubject: async (subjectId: string) =>
      Array.from(codes.values()).filter((item) => item.subjectId === subjectId),
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
  return { service, subjects, walletBindings, passkeys, webauthnChallenges, requests, codes, emailChallenges, auditLogs, manager, applicationService }
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
    expect(request.verifyUrl).toContain(`/passport/authorize?requestId=${encodeURIComponent(request.requestId)}`)

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
      deviceName: '未命名登录设备',
    })
    expect(passkeys.size).toBe(1)

    const renamed = await service.renamePasskeyCredentialByWallet(
      walletAddress,
      registered.credentialId,
      'Work MacBook',
    )
    expect(renamed.deviceName).toBe('Work MacBook')
    expect(passkeys.get(registered.credentialId).deviceName).toBe('Work MacBook')

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
      expect.arrayContaining([
        'passkey_register_requested',
        'passkey_registered',
        'passkey_credential_renamed',
        'authorize_passkey_approved',
      ]),
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

  it('requires a wallet signature to unlink a passport identity and revokes subject artifacts', async () => {
    const { service, subjects, walletBindings, passkeys, requests, codes, auditLogs } = createHarness()
    const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae441fb518eaed14f99d11d72')
    const walletAddress = wallet.address
    const pkce = createPkcePair()

    const registerRequest = await service.createPasskeyRegisterRequest({
      walletAddress,
      deviceName: 'iPhone',
    })
    const registered = await service.confirmPasskeyRegistration({
      walletAddress,
      requestId: registerRequest.passkeyRequest.requestId,
      credential: { id: 'credential-1', type: 'public-key', response: {} },
    })
    const request = await service.createAuthorizationRequest({
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeChallenge: pkce.challenge,
      codeChallengeMethod: 'S256',
    })
    const approved = await service.approveAuthorizationRequest({
      requestId: request.requestId,
      walletAddress,
    })

    const unbindRequest = await service.createWalletUnbindRequest(walletAddress)
    expect(unbindRequest.action).toBe('passport_wallet_unbind')
    expect(unbindRequest.subjectId).toBe(registerRequest.subjectId)
    expect(unbindRequest.message).toContain('Action: passport_wallet_unbind')
    expect(unbindRequest.message).toContain(`Actor: ${walletAddress.toLowerCase()}`)

    await expect(
      service.confirmWalletUnbind({
        walletAddress,
        requestId: unbindRequest.requestId,
        timestamp: unbindRequest.timestamp,
        signature: await Wallet.createRandom().signMessage(unbindRequest.message),
      }),
    ).rejects.toThrow('Invalid signature')

    const result = await service.confirmWalletUnbind({
      walletAddress,
      requestId: unbindRequest.requestId,
      timestamp: unbindRequest.timestamp,
      signature: await wallet.signMessage(unbindRequest.message),
    })

    expect(result).toMatchObject({
      success: true,
      subjectId: registerRequest.subjectId,
      walletAddress: walletAddress.toLowerCase(),
      revokedWalletBindings: 1,
      revokedPasskeyCredentials: 1,
      revokedAuthorizationRequests: 1,
      revokedAuthorizationCodes: 1,
      subjectStatus: 'revoked',
    })
    expect(Array.from(walletBindings.values())[0].status).toBe('revoked')
    expect(subjects.get(registerRequest.subjectId).status).toBe('revoked')
    expect(passkeys.get(registered.credentialId).revokedAt).toBeTruthy()
    expect(requests.get(request.requestId).status).toBe('revoked')
    expect(codes.get(approved.authorizationCode).used).toBe(true)
    expect(auditLogs.map((item) => item.action)).toEqual(
      expect.arrayContaining(['wallet_unbind_requested', 'wallet_unbound']),
    )

    await expect(
      service.exchangeAuthorizationCode({
        code: approved.authorizationCode,
        appId: 'project-app',
        redirectUri: 'https://project.example/passport/callback',
        codeVerifier: pkce.verifier,
      }),
    ).rejects.toThrow('Authorization code already used')

    const bindings = await service.listBindingsByWallet(walletAddress)
    expect(bindings).toEqual({ subjectId: '', walletBindings: [] })
  })

  it('persists requested scopes and releases verified email only to an email-scoped application', async () => {
    const { service, subjects, codes } = createHarness()
    const walletAddress = '0xAbC0000000000000000000000000000000000001'
    const emailPkce = createPkcePair()
    const emailRequest = await service.createAuthorizationRequest({
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeChallenge: emailPkce.challenge,
      scopes: ['identity.basic', 'identity.email'],
    })
    const emailApproved = await service.approveAuthorizationRequest({
      requestId: emailRequest.requestId,
      walletAddress,
    })
    const subject = subjects.get(emailApproved.subjectId)
    subject.email = 'person@example.com'
    subject.emailStatus = 'verified'
    subject.emailVerifiedAt = '2026-08-09T00:00:00.000Z'

    const emailExchanged = await service.exchangeAuthorizationCode({
      code: emailApproved.authorizationCode,
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeVerifier: emailPkce.verifier,
    })
    expect(emailRequest.scopes).toEqual(['identity.basic', 'identity.email'])
    expect(codes.get(emailApproved.authorizationCode).scopesJson).toBe(JSON.stringify(emailRequest.scopes))
    expect(emailExchanged.walletAddress).toBeUndefined()
    expect(emailExchanged.claims).toEqual({
      subjectId: emailApproved.subjectId,
      email: 'person@example.com',
      emailVerified: true,
      emailVerifiedAt: '2026-08-09T00:00:00.000Z',
    })

    const walletPkce = createPkcePair()
    const walletRequest = await service.createAuthorizationRequest({
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeChallenge: walletPkce.challenge,
    })
    const walletApproved = await service.approveAuthorizationRequest({
      requestId: walletRequest.requestId,
      walletAddress,
    })
    const walletExchanged = await service.exchangeAuthorizationCode({
      code: walletApproved.authorizationCode,
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeVerifier: walletPkce.verifier,
    })
    expect(walletRequest.scopes).toEqual(['identity.basic', 'identity.wallet'])
    expect(walletExchanged.claims).toEqual({
      subjectId: walletApproved.subjectId,
      walletAddress: walletAddress.toLowerCase(),
    })
  })

  it('rejects unsupported authorization scopes', async () => {
    const { service } = createHarness()
    const pkce = createPkcePair()
    await expect(service.createAuthorizationRequest({
      appId: 'project-app',
      redirectUri: 'https://project.example/passport/callback',
      codeChallenge: pkce.challenge,
      scopes: ['identity.basic', 'identity.admin'],
    })).rejects.toThrow('Unsupported scope: identity.admin')
  })

  it('verifies an email for a Passport subject without persisting the plaintext code', async () => {
    const harness = createHarness()
    const delivered: Array<{ code: string }> = []
    const service = new PassportService(harness.manager as any, harness.applicationService as any, async (message) => {
      delivered.push({ code: message.code })
    })
    const subject = await service.ensureWalletSubject('0xAbC0000000000000000000000000000000000001')
    const requested = await service.requestEmailVerification({
      subjectId: subject.subjectId,
      email: 'Person@Example.com',
    })
    expect(requested.emailHint).toBe('p***@example.com')
    expect(delivered).toHaveLength(1)
    expect(JSON.stringify(Array.from(harness.emailChallenges.values()))).not.toContain(delivered[0].code)

    const confirmed = await service.confirmEmailVerification({
      subjectId: subject.subjectId,
      verificationId: requested.verificationId,
      code: delivered[0].code,
    })
    expect(confirmed.email).toBe('person@example.com')
    expect(harness.subjects.get(subject.subjectId)).toMatchObject({
      email: 'person@example.com',
      emailStatus: 'verified',
    })
  })
})
