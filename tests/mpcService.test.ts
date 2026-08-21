import { mockClass } from './support/mockClass'

const managerMocks = {
  getSession: vi.fn(),
  listSessions: vi.fn(),
  saveSession: vi.fn(),
  updateSession: vi.fn(),
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
      createdAt: '1',
      expiresAt: '1893456000000',
    }))
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
})
