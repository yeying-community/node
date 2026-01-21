import { IndexedCache } from '@yeying-community/yeying-next'
import { createIdentity, IdentityApplicationExtend, IdentityCodeEnum, IdentityTemplate, NetworkTypeEnum, serializeIdentityToJson, verifyIdentity } from '@yeying-community/yeying-web3';
import { getCurrentAccount } from './auth';
import { notifyError } from '@/utils/message';

let indexedCache: IndexedCache = new IndexedCache('yeying-protal', 1)
let currentAccount = null
let userInfo = null

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
export async function generateIdentity(code: string, serviceCodes: string, location: string, hash: string, name: string, description: string, avatar: string, password: string) {
    const extend = IdentityApplicationExtend.create({
        code: code,
        serviceCodes: serviceCodes,
        location: location,
        hash: hash
    })

    const template: IdentityTemplate = {
        language: "LANGUAGE_CODE_ZH_CH",
        parent: "",
        network: NetworkTypeEnum.NETWORK_TYPE_YEYING,
        code: IdentityCodeEnum.IDENTITY_CODE_APPLICATION,
        name: name,
        description: description,
        avatar: avatar,
        extend: extend,
    }

    const identity = await createIdentity(template, password)
    const success = await verifyIdentity(identity)
    if (!success) {
        throw new Error("create identity error")
    }
    if (!identity.metadata?.did) {
        throw new Error("create identity error")
    }
    const identityCache = new LocalCache()
    identityCache.set(identity.metadata?.did, serializeIdentityToJson(identity))
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
