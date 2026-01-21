import { AuditDetailBox } from '@/plugins/audit'
import { defineStore } from 'pinia'

export const useDataStore = defineStore('data', {
  state: () => ({
    items: [] as AuditDetailBox[]
  }),
  actions: {
    setItems(data: AuditDetailBox[]) {
      this.items = data
    }
  }
})