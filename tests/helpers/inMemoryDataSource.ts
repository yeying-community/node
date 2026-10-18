type Row = Record<string, any>

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && (value as Row)._type === 'lessThan') {
      return row[key] < (value as Row)._value
    }
    return row[key] === value
  })
}

export function createInMemoryDataSource() {
  const tables = new Map<string, Row[]>()
  const tableFor = (target: any) => {
    const name = typeof target === 'function' ? target.name : String(target)
    if (!tables.has(name)) tables.set(name, [])
    return tables.get(name)!
  }
  const repository = (target: any) => {
    const rows = tableFor(target)
    return {
      create(row: Row = {}) {
        return { ...row }
      },
      async save(row: Row | Row[]) {
        if (Array.isArray(row)) {
          for (const item of row) {
            await this.save(item)
          }
          return row
        }
        const isPaymentEntity = typeof target.name === 'string' && target.name.startsWith('Payment')
        if (!row.uid && target.name && (isPaymentEntity || (!('nonce' in row) && !('credentialId' in row) && !('challengeId' in row) && !('requestId' in row) && !('code' in row)))) {
          row.uid = `${target.name}_${rows.length + 1}`
        }
        if (target.name === 'IdentityUsernameDO' && rows.some(item => item.namespace === row.namespace && item.normalizedUsername === row.normalizedUsername && ['active', 'reserved'].includes(item.status) && item.uid !== row.uid)) {
          throw new Error('duplicate username')
        }
        if (target.name === 'IdentityUsernameDO' && row.status === 'active' && rows.some(item => item.namespace === row.namespace && item.identityDid === row.identityDid && item.status === 'active' && item.uid !== row.uid)) {
          throw new Error('duplicate identity username')
        }
        const uniqueKeys: Record<string, string[][]> = {
          PaymentMerchantDO: [['merchantId']],
          PaymentTransactionDO: [['tradeNo'], ['merchantId', 'idempotencyKey']],
          PaymentRefundDO: [['refundNo'], ['merchantId', 'idempotencyKey']],
          PaymentRequestNonceDO: [['merchantId', 'nonce']],
          PaymentProviderEventDO: [['provider', 'eventId']],
          PaymentWebhookDeliveryDO: [['eventId']],
        }
        for (const keys of uniqueKeys[target.name] || []) {
          if (rows.some(item => item.uid !== row.uid && keys.every(key => item[key] === row[key]))) {
            throw new Error(`duplicate ${target.name} key`)
          }
        }
        const index = rows.findIndex(item => item.uid && row.uid && item.uid === row.uid)
        if (index >= 0) rows[index] = { ...rows[index], ...row }
        else rows.push({ ...row })
        return row
      },
      async findOneBy(where: Row) { return rows.find(row => matches(row, where)) || null },
      async findOne(options: any = {}) {
        const where = options.where || {}
        return rows.find(row => matches(row, where)) || null
      },
      async findBy(where: Row) { return rows.filter(row => matches(row, where)) },
      async find(options: any = {}) {
        let result = rows.slice()
        if (options.where && !Array.isArray(options.where)) {
          result = result.filter(row => matches(row, options.where))
        }
        if (options.order) {
          const entries = Object.entries(options.order)
          result.sort((left, right) => {
            for (const [key, direction] of entries) {
              if (left[key] === right[key]) continue
              const compare = left[key] > right[key] ? 1 : -1
              return String(direction).toUpperCase() === 'DESC' ? -compare : compare
            }
            return 0
          })
        }
        if (options.take) {
          result = result.slice(0, options.take)
        }
        return result
      },
      async update(where: Row, values: Row) {
        let affected = 0
        rows.forEach(row => { if (matches(row, where)) { Object.assign(row, values); affected += 1 } })
        return { affected }
      },
      async delete(where: Row) {
        const remaining = rows.filter(row => !matches(row, where))
        const affected = rows.length - remaining.length
        rows.splice(0, rows.length, ...remaining)
        return { affected }
      },
    }
  }
  const dataSource: any = {
    isInitialized: true,
    getRepository: repository,
    async transaction(callback: (manager: any) => Promise<any>) {
      const snapshot = new Map([...tables.entries()].map(([name, rows]) => [name, rows.map(row => ({ ...row }))]))
      try {
        return await callback({ getRepository: (target: any) => dataSource.getRepository(target) })
      } catch (error) {
        for (const [name, rows] of tables.entries()) {
          const previous = snapshot.get(name) || []
          rows.splice(0, rows.length, ...previous.map(row => ({ ...row })))
        }
        for (const [name, rows] of snapshot.entries()) {
          if (!tables.has(name)) tables.set(name, rows.map(row => ({ ...row })))
        }
        throw error
      }
    },
  }
  return dataSource
}
