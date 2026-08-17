type Row = Record<string, any>

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) => row[key] === value)
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
      async save(row: Row) {
        if (target.name === 'IdentityUsernameDO' && rows.some(item => item.namespace === row.namespace && item.normalizedUsername === row.normalizedUsername && ['active', 'reserved'].includes(item.status))) {
          throw new Error('duplicate username')
        }
        const index = rows.findIndex(item => item.uid && row.uid && item.uid === row.uid)
        if (index >= 0) rows[index] = { ...rows[index], ...row }
        else rows.push({ ...row })
        return row
      },
      async findOneBy(where: Row) { return rows.find(row => matches(row, where)) || null },
      async update(where: Row, values: Row) {
        let affected = 0
        rows.forEach(row => { if (matches(row, where)) { Object.assign(row, values); affected += 1 } })
        return { affected }
      },
    }
  }
  const dataSource: any = {
    isInitialized: true,
    getRepository: repository,
    async transaction(callback: (manager: any) => Promise<any>) {
      return callback({ getRepository: repository })
    },
  }
  return dataSource
}
