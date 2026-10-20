import { afterEach, describe, expect, it } from 'vitest'
import {
  clearEmailRegistrationDraft,
  hasEmailRegistrationDraft,
  loadEmailRegistrationDraft,
  saveEmailRegistrationDraft,
} from '../web/src/utils/identity'

type MemoryRequest<T> = IDBRequest<T> & { result: T }
type MemoryRow = { id: string; verificationId: string; ciphertext: string; expiresAt: string }

function request<T>(run: () => T, transaction?: any): MemoryRequest<T> {
  const result: any = { result: undefined, onsuccess: null, onerror: null }
  queueMicrotask(() => {
    try {
      result.result = run()
      result.onsuccess?.({ target: result })
      transaction?.oncomplete?.({ target: transaction })
    } catch (error) {
      result.error = error
      result.onerror?.({ target: result })
      transaction?.onerror?.({ target: transaction })
    }
  })
  return result
}

function createIndexedDbMock() {
  const rows = new Map<string, MemoryRow>()
  const database = {
    objectStoreNames: { contains: (name: string) => name === 'drafts' },
    createObjectStore: () => ({}),
    transaction: () => {
      const transaction: any = { oncomplete: null, onerror: null, onabort: null }
      transaction.objectStore = () => ({
        get: (id: string) => request(() => rows.get(id) && { ...rows.get(id)! }, transaction),
        put: (row: MemoryRow) => request(() => { rows.set(row.id, { ...row }); return row.id }, transaction),
        delete: (id: string) => request(() => rows.delete(id), transaction),
      })
      return transaction
    },
    close() {},
  }
  const indexedDb = {
    open() {
      const result: any = { result: database, onupgradeneeded: null, onsuccess: null, onerror: null }
      queueMicrotask(() => {
        result.onupgradeneeded?.({ target: result })
        result.onsuccess?.({ target: result })
      })
      return result
    },
  }
  return { indexedDb: indexedDb as unknown as IDBFactory, rows }
}

const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')

afterEach(() => {
  if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb)
  else Reflect.deleteProperty(globalThis, 'indexedDB')
})

describe('email registration draft storage', () => {
  it('stores only encrypted client material and restores it with the account password', async () => {
    const mock = createIndexedDbMock()
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: mock.indexedDb })
    const password = 'private-account-password'
    const draft = {
      email: 'alice@example.com',
      walletPrivateKey: 'wallet-private-key-material',
      identityMaterial: { privateJwk: { d: 'identity-private-key-material' } },
    }
    const expiresAt = new Date(Date.now() + 60_000).toISOString()

    await saveEmailRegistrationDraft(draft, password, 'verification-id', expiresAt)

    const stored = [...mock.rows.values()][0]
    expect(stored).toMatchObject({ verificationId: 'verification-id', expiresAt })
    expect(stored.ciphertext).toMatch(/^v2\./)
    expect(JSON.stringify(stored)).not.toContain(password)
    expect(JSON.stringify(stored)).not.toContain(draft.walletPrivateKey)
    expect(JSON.stringify(stored)).not.toContain('identity-private-key-material')
    expect(await hasEmailRegistrationDraft()).toBe(true)
    await expect(loadEmailRegistrationDraft<typeof draft>(password)).resolves.toMatchObject({
      value: draft,
      verificationId: 'verification-id',
      expiresAt,
    })
    await expect(loadEmailRegistrationDraft<typeof draft>('incorrect-password')).rejects.toThrow('IDENTITY_DRAFT_DECRYPT_FAILED')
  })

  it('clears expired drafts before reporting that no registration can be resumed', async () => {
    const mock = createIndexedDbMock()
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: mock.indexedDb })
    await saveEmailRegistrationDraft({ key: 'value' }, 'private-account-password', 'expired-id', new Date(Date.now() - 1).toISOString())

    await expect(hasEmailRegistrationDraft()).resolves.toBe(false)
    expect(mock.rows.size).toBe(0)
    await clearEmailRegistrationDraft()
    expect(mock.rows.size).toBe(0)
  })
})
