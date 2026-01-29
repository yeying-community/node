import { v4 as uuidv4 } from 'uuid'
import { getCurrentAccount, signWithWallet } from './auth';
import { notifyError } from '@/utils/message';

type IndexedStoreIndex = {
    keyPath: string
    name: string
    unique?: boolean
}

type IndexedStoreSchema = {
    name: string
    key: string
    autoIncrement: boolean
    indexes?: IndexedStoreIndex[]
}

class IndexedCache {
    private name: string
    private version: number
    private db?: IDBDatabase

    constructor(name: string, version: number) {
        this.name = name
        this.version = version
    }

    async open(stores: IndexedStoreSchema[]) {
        return await new Promise<void>((resolve, reject) => {
            const request = window.indexedDB.open(this.name, this.version)
            request.onupgradeneeded = () => {
                const db = request.result
                for (const store of stores) {
                    let objectStore: IDBObjectStore
                    if (!db.objectStoreNames.contains(store.name)) {
                        objectStore = db.createObjectStore(store.name, {
                            keyPath: store.key,
                            autoIncrement: store.autoIncrement
                        })
                    } else if (request.transaction) {
                        objectStore = request.transaction.objectStore(store.name)
                    } else {
                        continue
                    }
                    for (const index of store.indexes || []) {
                        if (!objectStore.indexNames.contains(index.name)) {
                            objectStore.createIndex(index.name, index.keyPath, {
                                unique: Boolean(index.unique)
                            })
                        }
                    }
                }
            }
            request.onsuccess = () => {
                this.db = request.result
                resolve()
            }
            request.onerror = () => reject(request.error)
        })
    }

    async insert(storeName: string, value: unknown) {
        return await this.put(storeName, value)
    }

    async updateByKey(storeName: string, value: unknown) {
        return await this.put(storeName, value)
    }

    async deleteByKey(storeName: string, key: IDBValidKey) {
        const store = this.getStore(storeName, 'readwrite')
        return await this.requestToPromise(store.delete(key))
    }

    async getByKey(storeName: string, key: IDBValidKey) {
        const store = this.getStore(storeName, 'readonly')
        return await this.requestToPromise(store.get(key))
    }

    async indexAll(storeName: string, indexName: string, indexValue: IDBValidKey) {
        const store = this.getStore(storeName, 'readonly')
        if (store.indexNames.contains(indexName)) {
            const index = store.index(indexName)
            if ('getAll' in index) {
                return await this.requestToPromise((index as IDBIndex).getAll(indexValue))
            }
        }
        return await new Promise<any[]>((resolve, reject) => {
            const results: any[] = []
            const request = store.openCursor()
            request.onsuccess = () => {
                const cursor = request.result
                if (!cursor) {
                    resolve(results)
                    return
                }
                if (cursor.value && cursor.value[indexName] === indexValue) {
                    results.push(cursor.value)
                }
                cursor.continue()
            }
            request.onerror = () => reject(request.error)
        })
    }

    private async put(storeName: string, value: unknown) {
        const store = this.getStore(storeName, 'readwrite')
        return await this.requestToPromise(store.put(value))
    }

    private getStore(storeName: string, mode: IDBTransactionMode) {
        if (!this.db) {
            throw new Error('IndexedCache is not initialized')
        }
        return this.db.transaction(storeName, mode).objectStore(storeName)
    }

    private requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    }
}

let indexedCache: IndexedCache = new IndexedCache('yeying-protal', 1)
let currentAccount = null
let userInfo = null

type LocalIdentityMetadata = {
    did: string
    version: number
    name: string
    description: string
    avatar: string
    createdAt: string
    updatedAt: string
}

type LocalIdentity = {
    metadata: LocalIdentityMetadata
    applicationExtend: {
        code: string
        serviceCodes: string
        location: string
        hash: string
    }
}

async function digestHex(value: string): Promise<string> {
    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
        return uuidv4().replace(/-/g, '')
    }
    const data = new TextEncoder().encode(value)
    const hash = await window.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

// 初始化提供者
async function initializeProviders() {
    currentAccount = getCurrentAccount()
    await indexedCache.open([
        {
            // 表名
            name: 'applications', 
            // 主键字段
            key: 'uid', 
            // 主键是否自增，走采用 uuid 作为主键
            autoIncrement: false, 
            // 索引：keyPath 表示列名； name 表示索引名； unique 表示字段值是否唯一
            indexes: [{ keyPath: 'owner', name: 'owner', unique: false }]
        },
        {
            name: 'services',
            key: 'uid',
            autoIncrement: false,
            indexes: [{ keyPath: 'owner', name: 'owner', unique: false }]
        },
        {
            // 表名
            name: 'applications_apply', 
            // 主键字段
            key: 'uid', 
            // 主键是否自增，走采用 uuid 作为主键
            autoIncrement: false, 
            // 索引：keyPath 表示列名； name 表示索引名； unique 表示字段值是否唯一
            indexes: [{ keyPath: 'applyOwner', name: 'applyOwner', unique: false }]
        },
        {
            name: 'services_apply',
            key: 'uid',
            autoIncrement: false,
            indexes: [{ keyPath: 'applyOwner', name: 'applyOwner', unique: false }]
        }
    ])
}

export class LocalCache {
    private storage: Storage

    constructor() {
        this.storage = window.localStorage
    }

    get(key: string) {
        return this.storage.getItem(key)
    }

    set(key: string, value: any) {
        this.storage.setItem(key, value)
    }

    remove(key: string) {
        this.storage.removeItem(key)
    }
}


/**
 * 生成身份
 * @param code 
 * @param serviceCodes 
 * @param location 
 * @param hash 
 * @param name 
 * @param description 
 * @param avatar 
 * @param password 
 * @returns 
 */
export async function generateIdentity(code: string, serviceCodes: unknown, location: string, hash: string, name: string, description: string, avatar: string) {
    const account = getCurrentAccount()
    if (!account) {
        throw new Error('No wallet account')
    }
    const now = new Date().toISOString()
    const serviceCodesValue = Array.isArray(serviceCodes) ? serviceCodes.join(',') : `${serviceCodes || ''}`
    const safeLocation = `${location || ''}`
    const safeHash = `${hash || ''}`
    const safeDescription = `${description || ''}`
    const kind = safeLocation.trim() ? 'application' : 'service'
    const signaturePayload = [
        'YeYing Identity v1',
        `Owner: ${account}`,
        `Kind: ${kind}`,
        `Code: ${code}`,
        `Name: ${name}`,
        `Description: ${safeDescription}`,
        `Location: ${safeLocation}`,
        `Hash: ${safeHash}`,
        `ServiceCodes: ${serviceCodesValue}`,
        `Issued At: ${now}`
    ].join('\n')
    const signature = await signWithWallet(signaturePayload)
    const didSeed = `${account}|${signature}|${code}|${name}|${safeDescription}|${safeLocation}|${safeHash}|${serviceCodesValue}`
    const did = `did:local:${await digestHex(didSeed)}`
    const identity: LocalIdentity = {
        metadata: {
            did,
            version: 1,
            name,
            description: safeDescription,
            avatar,
            createdAt: now,
            updatedAt: now
        },
        applicationExtend: {
            code,
            serviceCodes: serviceCodesValue,
            location: safeLocation,
            hash: safeHash
        }
    }
    const identityCache = new LocalCache()
    identityCache.set(did, JSON.stringify(identity))
    return identity
}

export async function exportIdentityInfo(did: string, name: string) {
    if (!did) {
        notifyError('❌未找到身份信息');
        return;
    }
    const identityCache = new LocalCache();
    const identity = identityCache.get(did);
    if (!identity) {
        notifyError('❌身份信息不存在，请先创建或导入');
        return;
    }
    const fileName = `${name}.id`;
    downloadTextFile(fileName, identity);
}

const downloadTextFile = (filename: string, text: any) => {
  // 创建一个 Blob 对象，存储文本数据
  const blob = new Blob([text], { type: "text/plain" });

  // 创建一个指向该 Blob 对象的 URL
  const url = URL.createObjectURL(blob);

  // 创建一个临时的 <a> 标签，用于触发下载
  const a = document.createElement("a");
  a.href = url;
  a.download = filename; // 设置下载文件名
  document.body.appendChild(a); // 将 <a> 标签添加到文档中
  a.click(); // 模拟点击下载

  // 下载完成后移除 <a> 标签和 URL 对象
  document.body.removeChild(a);
  URL.revokeObjectURL(url); // 释放 URL 对象
};

export {
    initializeProviders,
    indexedCache,
    currentAccount,
    userInfo
}
