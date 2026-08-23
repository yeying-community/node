import { mockClass } from './support/mockClass'

const managerMocks = {
  getSession: vi.fn(),
  listSessions: vi.fn(),
  saveSession: vi.fn(),
  updateSession: vi.fn(),
  getParticipant: vi.fn(),
  listParticipants: vi.fn(),
  saveMessage: vi.fn(),
  getMaxMessageSeq: vi.fn(),
  queryMessages: vi.fn(),
  getSignRequest: vi.fn(),
  querySignRequests: vi.fn(),
  saveSignRequest: vi.fn(),
  saveAuditLog: vi.fn(),
}

const notificationCreateMock = vi.fn()

vi.doMock('../src/domain/manager/mpc', () => ({
  MpcManager: mockClass(() => managerMocks),
}))

vi.doMock('../src/domain/service/notification', () => ({
  NotificationService: mockClass(() => ({
    create: notificationCreateMock,
  })),
  safelyRunNotificationTask: async (task: () => Promise<void>) => {
    try {
      await task()
    } catch {
      // Notification failures must not block MPC session creation.
    }
  },
}))

vi.doMock('../src/domain/service/mpcEvents', () => ({
  publishMpcEvent: vi.fn(),
}))

const { MpcService } = await import('../src/domain/service/mpc')

describe('MpcService notifications', () => {
  beforeEach(() => {
    for (const fn of Object.values(managerMocks)) {
      fn.mockReset()
    }
    notificationCreateMock.mockReset()

    managerMocks.getSession.mockResolvedValue(null)
    managerMocks.listSessions.mockResolvedValue([])
    managerMocks.saveSession.mockImplementation(async (session) => session)
    managerMocks.updateSession.mockImplementation(async (sessionId, patch) => ({
      id: sessionId,
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 2,
      participants: JSON.stringify([
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      ]),
      status: patch.status,
      round: 0,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      resultJson: patch.resultJson || '{}',
      createdAt: '1',
      expiresAt: '1893456000000',
    }))
    managerMocks.getParticipant.mockResolvedValue(null)
    managerMocks.listParticipants.mockResolvedValue([])
    managerMocks.saveMessage.mockImplementation(async (message) => message)
    managerMocks.getMaxMessageSeq.mockResolvedValue(0)
    managerMocks.queryMessages.mockResolvedValue([])
    managerMocks.getSignRequest.mockResolvedValue(null)
    managerMocks.querySignRequests.mockResolvedValue([])
    managerMocks.saveSignRequest.mockImplementation(async (request) => request)
    managerMocks.saveAuditLog.mockResolvedValue(undefined)
    notificationCreateMock.mockResolvedValue({ uid: 'notification-1' })
  })

  it('creates keygen invite notifications for other MPC participants', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const invited = '0x2222222222222222222222222222222222222222'
    const service = new MpcService()

    const session = await service.createSession(
      {
        id: 'session-1',
        name: '团队金库',
        type: 'keygen',
        walletId: 'mpc-wallet-1',
        threshold: 2,
        participants: [actor, invited, invited.toUpperCase()],
        curve: 'secp256k1',
        expiresAt: '1893456000000',
      },
      actor
    )

    expect(session.id).toBe('session-1')
    expect(session.name).toBe('团队金库')
    expect(notificationCreateMock).toHaveBeenCalledTimes(1)
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mpc.keygen.invited',
        source: 'mpc',
        subjectType: 'mpc.session',
        subjectId: 'session-1',
        actor,
        audienceType: 'wallet-address',
        recipients: [invited],
        title: 'MPC 钱包创建邀请',
        expiresAt: '1893456000000',
      })
    )
    expect(notificationCreateMock.mock.calls[0][0].payload).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        name: '团队金库',
        walletId: 'mpc-wallet-1',
        sessionType: 'keygen',
        threshold: 2,
        participants: [actor, invited, invited.toUpperCase()],
        curve: 'secp256k1',
        inviter: actor,
        expiresAt: '1893456000000',
      })
    )
  })

  it('lists MPC keygen invites from session records for invited participants', async () => {
    const actor = '0x2222222222222222222222222222222222222222'
    const inviter = '0x1111111111111111111111111111111111111111'
    managerMocks.listSessions.mockResolvedValue([
      {
        id: 'session-1',
        name: '团队金库',
        type: 'keygen',
        walletId: 'mpc-wallet-1',
        threshold: 2,
        participants: JSON.stringify([inviter, actor]),
        status: 'ready',
        round: 0,
        curve: 'secp256k1',
        keyVersion: 1,
        shareVersion: 1,
        createdAt: '2',
        expiresAt: '',
      },
      {
        id: 'session-owned',
        name: '发起者钱包',
        type: 'keygen',
        walletId: 'mpc-wallet-2',
        threshold: 1,
        participants: JSON.stringify([actor, inviter]),
        status: 'created',
        round: 0,
        curve: 'secp256k1',
        keyVersion: 1,
        shareVersion: 1,
        createdAt: '1',
        expiresAt: '',
      },
    ])
    const service = new MpcService()

    const result = await service.listInvites(actor)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(expect.objectContaining({
      uid: 'session-1',
      subjectId: 'session-1',
      actor: inviter,
      title: '团队金库',
    }))
    expect(result.items[0].payload).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      name: '团队金库',
      walletId: 'mpc-wallet-1',
      inviter,
    }))
  })

  it('does not create invite notifications for non-keygen sessions', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const service = new MpcService()

    await service.createSession(
      {
        id: 'session-sign-1',
        name: '签名会话',
        type: 'sign',
        walletId: 'mpc-wallet-1',
        threshold: 1,
        participants: [actor],
      },
      actor
    )

    expect(notificationCreateMock).not.toHaveBeenCalled()
  })

  it('keeps session creation successful when invite notification delivery fails', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const invited = '0x2222222222222222222222222222222222222222'
    notificationCreateMock.mockRejectedValueOnce(new Error('notification unavailable'))
    const service = new MpcService()

    const session = await service.createSession(
      {
        id: 'session-2',
        name: '项目金库',
        type: 'keygen',
        walletId: 'mpc-wallet-2',
        threshold: 2,
        participants: [actor, invited],
      },
      actor
    )

    expect(session.id).toBe('session-2')
    expect(notificationCreateMock).toHaveBeenCalledTimes(1)
  })

  it('lets the keygen initiator cancel a pending session and notifies invited participants', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const invited = '0x2222222222222222222222222222222222222222'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 2,
      participants: JSON.stringify([actor, invited]),
      status: 'created',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 1,
      shareVersion: 1,
      createdAt: '1',
      expiresAt: '1893456000000',
    })
    const service = new MpcService()

    const cancelled = await service.cancelSession('session-1', actor)

    expect(cancelled.status).toBe('cancelled')
    expect(managerMocks.updateSession).toHaveBeenCalledWith('session-1', { status: 'cancelled' })
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mpc.keygen.cancelled',
        source: 'mpc',
        subjectId: 'session-1',
        recipients: [invited],
        title: 'MPC 钱包创建已取消',
      })
    )
  })

  it('rejects cancellation by a non-initiator', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const invited = '0x2222222222222222222222222222222222222222'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 2,
      participants: JSON.stringify([actor, invited]),
      status: 'created',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 1,
      shareVersion: 1,
      createdAt: '1',
      expiresAt: '1893456000000',
    })
    const service = new MpcService()

    await expect(service.cancelSession('session-1', invited)).rejects.toThrow('FORBIDDEN')
  })

  it('lets a configured session participant read session detail before joining', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const invited = '0x2222222222222222222222222222222222222222'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 2,
      participants: JSON.stringify([actor, invited]),
      status: 'rounds',
      round: 1,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      resultJson: '{}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.listParticipants.mockResolvedValue([
      {
        sessionId: 'session-1',
        participantId: invited,
        deviceId: 'device-2',
        identity: `did:pkh:eth:${invited}`,
        e2ePublicKey: 'x25519:key',
        signingPublicKey: 'ed25519:key',
        status: 'active',
        joinedAt: '1',
      },
    ])
    const service = new MpcService()

    const detail = await service.getSession('session-1', actor)

    expect(detail.id).toBe('session-1')
    expect(detail.name).toBe('团队金库')
    expect(detail.joinedCount).toBe(1)
  })

  it('rejects session detail reads from addresses outside the configured participants', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const invited = '0x2222222222222222222222222222222222222222'
    const outsider = '0x3333333333333333333333333333333333333333'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 2,
      participants: JSON.stringify([actor, invited]),
      status: 'rounds',
      round: 1,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      resultJson: '{}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.listParticipants.mockResolvedValue([
      {
        sessionId: 'session-1',
        participantId: invited,
        deviceId: 'device-2',
        identity: `did:pkh:eth:${invited}`,
        e2ePublicKey: 'x25519:key',
        signingPublicKey: 'ed25519:key',
        status: 'active',
        joinedAt: '1',
      },
    ])
    const service = new MpcService()

    await expect(service.getSession('session-1', outsider)).rejects.toThrow('FORBIDDEN')
  })

  it('completes keygen session and stores generated address result', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const invited = '0x2222222222222222222222222222222222222222'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 1,
      participants: JSON.stringify([actor, invited]),
      status: 'rounds',
      round: 1,
      curve: 'secp256k1',
      keyVersion: 1,
      shareVersion: 1,
      resultJson: '{}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.getParticipant.mockResolvedValue({
      sessionId: 'session-1',
      participantId: actor,
      deviceId: 'device-1',
      identity: `did:pkh:eth:${actor}`,
      e2ePublicKey: 'x25519:key',
      signingPublicKey: 'ed25519:key',
      status: 'active',
      joinedAt: '1',
    })
    managerMocks.listParticipants.mockResolvedValue([
      {
        sessionId: 'session-1',
        participantId: actor,
        deviceId: 'device-1',
        identity: `did:pkh:eth:${actor}`,
        e2ePublicKey: 'x25519:key',
        signingPublicKey: 'ed25519:key',
        status: 'active',
        joinedAt: '1',
      },
    ])
    managerMocks.updateSession.mockImplementation(async (sessionId, patch) => ({
      id: sessionId,
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 1,
      participants: JSON.stringify([actor, invited]),
      status: patch.status,
      round: 1,
      curve: 'secp256k1',
      keyVersion: patch.keyVersion,
      shareVersion: patch.shareVersion,
      resultJson: patch.resultJson,
      createdAt: '1',
      expiresAt: '',
    }))
    const service = new MpcService()

    const completed = await service.completeKeygenSession(
      'session-1',
      {
        participantId: actor,
        result: {
          address: '0x9999999999999999999999999999999999999999',
          publicKey: '03abcdef',
          keyVersion: 2,
          shareVersion: 2,
        },
      },
      actor
    )

    expect(managerMocks.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: 'completed',
        keyVersion: 2,
        shareVersion: 2,
      })
    )
    const patch = managerMocks.updateSession.mock.calls[0][1]
    expect(JSON.parse(patch.resultJson)).toEqual(expect.objectContaining({
      address: '0x9999999999999999999999999999999999999999',
      publicKey: '03abcdef',
      groupPublicKey: '03abcdef',
      keyVersion: 2,
      shareVersion: 2,
    }))
    expect(completed.status).toBe('completed')
    expect(completed.result).toEqual(expect.objectContaining({
      address: '0x9999999999999999999999999999999999999999',
      publicKey: '03abcdef',
    }))
  })

  it('creates MPC sign request for a participant', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 1,
      participants: JSON.stringify([actor]),
      status: 'completed',
      round: 1,
      curve: 'secp256k1',
      keyVersion: 2,
      shareVersion: 2,
      resultJson: '{"address":"0x9999999999999999999999999999999999999999","publicKey":"03abcdef"}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.listParticipants.mockResolvedValue([
      {
        sessionId: 'session-1',
        participantId: actor,
        deviceId: 'device-1',
        identity: `did:pkh:eth:${actor}`,
        e2ePublicKey: 'x25519:key',
        signingPublicKey: 'ed25519:key',
        status: 'active',
        joinedAt: '1',
      },
    ])
    const service = new MpcService()

    const request = await service.createSignRequest(
      {
        id: 'sign-request-1',
        walletId: 'mpc-wallet-1',
        sessionId: 'session-1',
        payloadType: 'message',
        payloadHash: 'hash-1',
        payload: { message: 'hello' },
        chainId: 0,
      },
      actor
    )

    expect(managerMocks.saveSignRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sign-request-1',
      walletId: 'mpc-wallet-1',
      sessionId: 'session-1',
      initiator: actor,
      payloadType: 'message',
      payloadHash: 'hash-1',
      payloadJson: '{"message":"hello"}',
      status: 'pending',
    }))
    expect(request).toEqual(expect.objectContaining({
      id: 'sign-request-1',
      walletId: 'mpc-wallet-1',
      sessionId: 'session-1',
      payloadType: 'message',
      payloadHash: 'hash-1',
      payload: { message: 'hello' },
      status: 'pending',
    }))
  })

  it('completes MPC sign request for a participant', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    managerMocks.getSignRequest.mockResolvedValue({
      id: 'sign-request-1',
      walletId: 'mpc-wallet-1',
      sessionId: 'session-1',
      initiator: actor,
      payloadType: 'message',
      payloadHash: 'hash-1',
      chainId: 0,
      status: 'pending',
      approvals: '[]',
      signature: '',
      resultJson: '{}',
      completedAt: '',
      createdAt: '1',
    })
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 1,
      participants: JSON.stringify([actor]),
      status: 'completed',
      round: 1,
      curve: 'secp256k1',
      keyVersion: 2,
      shareVersion: 2,
      resultJson: '{"address":"0x9999999999999999999999999999999999999999","publicKey":"03abcdef"}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.listParticipants.mockResolvedValue([
      {
        sessionId: 'session-1',
        participantId: actor,
        deviceId: 'device-1',
        identity: `did:pkh:eth:${actor}`,
        e2ePublicKey: 'x25519:key',
        signingPublicKey: 'ed25519:key',
        status: 'active',
        joinedAt: '1',
      },
    ])
    const service = new MpcService()

    const request = await service.completeSignRequest(
      {
        requestId: 'sign-request-1',
        participantId: actor,
        signature: '0xmpcsig',
        result: { signature: '0xmpcsig', recoveryId: 1 },
      },
      actor
    )

    expect(managerMocks.saveSignRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sign-request-1',
      walletId: 'mpc-wallet-1',
      sessionId: 'session-1',
      status: 'completed',
      signature: '0xmpcsig',
      resultJson: '{"signature":"0xmpcsig","recoveryId":1}',
    }))
    expect(request).toEqual(expect.objectContaining({
      id: 'sign-request-1',
      status: 'completed',
      signature: '0xmpcsig',
      result: { signature: '0xmpcsig', recoveryId: 1 },
    }))
    expect(request.completedAt).toBeTruthy()
  })

  it('lists MPC sign requests visible to a participant', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 1,
      participants: JSON.stringify([actor]),
      status: 'completed',
      round: 1,
      curve: 'secp256k1',
      keyVersion: 2,
      shareVersion: 2,
      resultJson: '{}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.listParticipants.mockResolvedValue([
      {
        sessionId: 'session-1',
        participantId: actor,
        deviceId: 'device-1',
        identity: `did:pkh:eth:${actor}`,
        e2ePublicKey: 'x25519:key',
        signingPublicKey: 'ed25519:key',
        status: 'active',
        joinedAt: '1',
      },
    ])
    managerMocks.querySignRequests.mockResolvedValue([
      {
        id: 'sign-request-1',
        walletId: 'mpc-wallet-1',
        sessionId: 'session-1',
        initiator: actor,
        payloadType: 'message',
        payloadHash: 'hash-1',
        payloadJson: '{"message":"hello"}',
        chainId: 0,
        status: 'pending',
        approvals: '[]',
        signature: '',
        resultJson: '{}',
        completedAt: '',
        createdAt: '1',
      },
    ])
    const service = new MpcService()

    const result = await service.listSignRequests(actor, {
      sessionId: 'session-1',
      status: 'pending',
    })

    expect(managerMocks.querySignRequests).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      status: 'pending',
    }))
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'sign-request-1',
      status: 'pending',
      payload: { message: 'hello' },
    }))
    expect(result.page.total).toBe(1)
  })

  it('stores cggmp24 wire messages with server-assigned sequence', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const recipient = '0x2222222222222222222222222222222222222222'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 2,
      participants: JSON.stringify([actor, recipient]),
      status: 'ready',
      round: 0,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      resultJson: '{}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.getParticipant.mockResolvedValue({
      sessionId: 'session-1',
      participantId: actor,
      deviceId: 'device-1',
      identity: `did:pkh:eth:${actor}`,
      e2ePublicKey: 'x25519:key',
      signingPublicKey: 'ed25519:key',
      status: 'active',
      joinedAt: '1',
    })
    managerMocks.getMaxMessageSeq.mockResolvedValue(3)
    const service = new MpcService()

    const result = await service.sendWireMessage(
      'session-1',
      {
        protocol_version: 1,
        engine: 'cggmp24',
        session_id: 'session-1',
        protocol: 'sign',
        sequence: 99,
        sender_index: 0,
        audience: { 'one-party': { recipient_index: 1 } },
        payload: { Round1b: { ciphertext: 'opaque' } },
      },
      actor
    )

    expect(result).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      sender: '0',
      receiver: '1',
      type: 'sign',
      round: 1,
      seq: 4,
    }))
    expect(result.envelope).toEqual(expect.objectContaining({
      protocol_version: 1,
      engine: 'cggmp24',
      session_id: 'session-1',
      protocol: 'sign',
      sequence: 4,
      sender_index: 0,
      audience: { 'one-party': { recipient_index: 1 } },
      payload: { Round1b: { ciphertext: 'opaque' } },
    }))
    expect(managerMocks.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      sender: '0',
      receiver: '1',
      seq: 4,
    }))
  })

  it('fetches only messages visible to the requested participant index', async () => {
    const actor = '0x1111111111111111111111111111111111111111'
    const recipient = '0x2222222222222222222222222222222222222222'
    managerMocks.getSession.mockResolvedValue({
      id: 'session-1',
      name: '团队金库',
      type: 'keygen',
      walletId: 'mpc-wallet-1',
      threshold: 2,
      participants: JSON.stringify([actor, recipient]),
      status: 'rounds',
      round: 1,
      curve: 'secp256k1',
      keyVersion: 0,
      shareVersion: 0,
      resultJson: '{}',
      createdAt: '1',
      expiresAt: '',
    })
    managerMocks.listParticipants.mockResolvedValue([
      {
        sessionId: 'session-1',
        participantId: actor,
        deviceId: 'device-1',
        identity: `did:pkh:eth:${actor}`,
        e2ePublicKey: 'x25519:key',
        signingPublicKey: 'ed25519:key',
        status: 'active',
        joinedAt: '1',
      },
    ])
    managerMocks.queryMessages.mockResolvedValue([
      {
        id: 'msg-2',
        sessionId: 'session-1',
        sender: '1',
        receiver: '',
        round: 1,
        type: 'sign',
        seq: 2,
        envelope: '{"sequence":2}',
        createdAt: '2',
      },
    ])
    const service = new MpcService()

    const result = await service.fetchMessages('session-1', actor, undefined, undefined, 20, 1, 0)

    expect(managerMocks.queryMessages).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      afterSeq: 1,
      recipientIndex: 0,
      limit: 20,
    }))
    expect(result.messages).toHaveLength(1)
    expect(result.nextSequence).toBe(2)
  })
})
