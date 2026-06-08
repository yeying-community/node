import { defineStore, getActivePinia } from 'pinia'

function readWalletReady() {
  if (typeof localStorage === 'undefined') {
    return false
  }
  return localStorage.getItem('hasConnectedWallet') === 'true'
}

function writeWalletReady(walletReady: boolean) {
  if (typeof localStorage === 'undefined') {
    return
  }
  localStorage.setItem('hasConnectedWallet', String(walletReady))
}

/**
 * 存放钱包状态
 */
export const walletReadyDataStore = defineStore('walletReady', {
  state: () => ({
    walletReady: readWalletReady()
  }),
  actions: {
    setWalletReady(walletReady: boolean) {
      this.walletReady = walletReady
      writeWalletReady(walletReady)
    }
  }
})

export function getWalletDataStore() {
  if (!getActivePinia()) {
    return {
      walletReady: readWalletReady(),
      setWalletReady: writeWalletReady,
    } as ReturnType<typeof walletReadyDataStore>
  }
  return walletReadyDataStore()
}
