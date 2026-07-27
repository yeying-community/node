import { vi } from 'vitest'

const managerMock = vi.hoisted(() => ({
  countActivePasskeys: vi.fn(),
  listKeyRecords: vi.fn(),
  getKeyRecord: vi.fn(),
  saveKeyRecord: vi.fn(),
  deleteKeyRecord: vi.fn(),
}))

vi.mock('../src/domain/manager/custody', () => ({
  CustodyManager: class {
    constructor() {
      return managerMock
    }
  },
}))

const { CustodyService } = await import('../src/domain/service/custody')

describe('CustodyService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    managerMock.countActivePasskeys.mockResolvedValue(0)
    managerMock.listKeyRecords.mockResolvedValue([])
    managerMock.getKeyRecord.mockResolvedValue(null)
    managerMock.saveKeyRecord.mockImplementation(async (record) => record)
  })

  it('rejects custody writes when no active passkey is bound', async () => {
    const service = new CustodyService()

    await expect(
      service.upsertRecord('0xAbC0000000000000000000000000000000000001', {
        walletId: 'wallet-1',
        ciphertext: 'encrypted-secret',
      }),
    ).rejects.toThrow('PASSKEY_REQUIRED')

    expect(managerMock.saveKeyRecord).not.toHaveBeenCalled()
  })

  it('stores encrypted custody data after passkey binding', async () => {
    managerMock.countActivePasskeys.mockResolvedValue(1)
    const service = new CustodyService()

    const saved = await service.upsertRecord('0xAbC0000000000000000000000000000000000001', {
      walletId: 'wallet-1',
      accountId: 'account-1',
      address: '0xAbC0000000000000000000000000000000000001',
      ciphertext: 'encrypted-secret',
      metadata: { version: 1 },
    })

    expect(saved).toMatchObject({
      walletId: 'wallet-1',
      accountId: 'account-1',
      address: '0xabc0000000000000000000000000000000000001',
      metadata: { version: 1 },
    })
    expect(saved.ciphertext).toBeUndefined()
    expect(managerMock.saveKeyRecord).toHaveBeenCalledOnce()
  })

  it('reports passkey and custody record status without returning ciphertext', async () => {
    managerMock.countActivePasskeys.mockResolvedValue(1)
    managerMock.listKeyRecords.mockResolvedValue([
      {
        walletId: 'wallet-1',
        accountId: 'account-1',
        address: '0xabc0000000000000000000000000000000000001',
        ciphertext: 'encrypted-secret',
        metadataJson: '{"version":1}',
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
        lastVerifiedAt: '2026-07-11T00:00:00.000Z',
      },
    ])
    const service = new CustodyService()

    await expect(service.getStatus('0xABC0000000000000000000000000000000000001')).resolves.toMatchObject({
      passkeyBound: true,
      passkeyCount: 1,
      enabled: true,
      recordCount: 1,
      records: [{ walletId: 'wallet-1' }],
    })

    const status = await service.getStatus('0xABC0000000000000000000000000000000000001')
    expect(status.records[0].ciphertext).toBeUndefined()
  })
})
