import { defineStore } from 'pinia'

/**
 * 存放钱包状态
 */
export const walletReadyDataStore = defineStore('walletReady', {
  state: () => ({
    walletReady: false as boolean
  }),
  actions: {
    setWalletReady(walletReady: boolean) {
      this.walletReady = walletReady
      localStorage.setItem('hasConnectedWallet', String(walletReady))
    }
  }
})

export function getWalletDataStore() {
  return walletReadyDataStore()
}
