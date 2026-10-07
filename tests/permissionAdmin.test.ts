const actor = '0x1111111111111111111111111111111111111111'

let runtimeSecrets: Record<string, string> = {}
let userState: { did: string; role: string; status: string; createdAt: string; updatedAt: string; signature: string } | null = null

vi.doMock('../src/security/secretVault', () => ({
  getRuntimeSecret: vi.fn((name: string) => runtimeSecrets[name] || ''),
}))

vi.doMock('../src/domain/service/user', () => ({
  UserService: class {
    async getState() {
      return userState
    }

    async saveState(nextState: typeof userState) {
      userState = nextState
      return nextState
    }

    async insertStateIfAbsent(nextState: typeof userState) {
      if (!userState) {
        userState = nextState
      }
      return userState
    }
  },
}))

const { getAdminDidAllowList, isAdminUser, provisionUserState } = await import('../src/common/permission')

describe('admin permission bootstrap', () => {
  beforeEach(() => {
    runtimeSecrets = {}
    userState = null
    process.env.ADMIN_DIDS = actor
  })

  afterEach(() => {
    delete process.env.ADMIN_DIDS
  })

  it('does not grant admin access from environment variables', async () => {
    await expect(isAdminUser(actor)).resolves.toBe(false)
  })

  it('grants admin access from the encrypted ADMIN_DIDS secret', async () => {
    runtimeSecrets.ADMIN_DIDS = actor.toUpperCase()

    expect(getAdminDidAllowList().has(actor)).toBe(true)
    await expect(isAdminUser(actor)).resolves.toBe(true)
  })

  it('keeps USER_ROLE_OWNER as the long-lived database admin role', async () => {
    userState = {
      did: actor,
      role: 'USER_ROLE_OWNER',
      status: 'USER_STATUS_ACTIVE',
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      signature: '',
    }

    await expect(isAdminUser(actor)).resolves.toBe(true)
  })

  it('provisions a missing state through an insert-if-absent operation', async () => {
    const state = await provisionUserState(actor)

    expect(state).toMatchObject({
      did: actor,
      role: 'USER_ROLE_NORMAL',
      status: 'USER_STATUS_ACTIVE',
    })
    expect(userState).toEqual(state)
  })
})
