import { indexedCache } from './account'
import { setLocalStorage, getLocalStorage } from '@/utils/common'
import $audit from '@/plugins/audit'
import { getCurrentAccount, getAuthToken } from './auth'
import { notifyError } from '@/utils/message'
import { getWalletDataStore } from '@/stores/auth'
import { apiUrl } from './api'

export { businessStatusMap, businessStatusOptions, resolveBusinessStatus, isBusinessOnline } from '@/utils/businessStatus'


export interface ApplicationDetail {
    name: string
    description: string
    location: string
    code: string
    serviceCodes: string[]
    avatar: string
    owner: string
    ownerName: string
    codePackagePath: string
}

// 应用编码
export const codeMapTrans = {
    0: 'APPLICATION_CODE_UNKNOWN',
    1: 'APPLICATION_CODE_MARKET',
    2: 'APPLICATION_CODE_ASSET',
    3: 'APPLICATION_CODE_KNOWLEDGE',
    4: 'APPLICATION_CODE_KEEPER',
    5: 'APPLICATION_CODE_SOCIAL',
    6: 'APPLICATION_CODE_WORKBENCH'
}
// 应用依赖的服务编码
export const serviceCodeMapTrans = {
    0: 'SERVICE_CODE_UNKNOWN',
    1: 'SERVICE_CODE_NODE',
    2: 'SERVICE_CODE_WAREHOUSE',
    3: 'SERVICE_CODE_AGENT',
    4: 'SERVICE_CODE_MCP'
}
// // 应用编码
export const codeMap = {
    APPLICATION_CODE_UNKNOWN: '未知',
    APPLICATION_CODE_MARKET: '社区集市',
    APPLICATION_CODE_ASSET: '资产应用',
    APPLICATION_CODE_KNOWLEDGE: '知识库应用',
    APPLICATION_CODE_KEEPER: '智能管家应用',
    APPLICATION_CODE_SOCIAL: '社交应用',
    APPLICATION_CODE_WORKBENCH: '工作台应用'
}
// 应用依赖的服务编码
export const serviceCodeMap = {
    SERVICE_CODE_UNKNOWN: '未知',
    SERVICE_CODE_NODE: '网络节点供应商',
    SERVICE_CODE_WAREHOUSE: '仓储服务供应商',
    SERVICE_CODE_AGENT: '智能体供应商',
    SERVICE_CODE_MCP: '模型上下文供应商'
}
export interface ApplicationMetadata {
    owner?: string;
    ownerName?: string;
    network?: string;
    address?: string;
    did?: string;
    version?: number;
    name?: string;
    code?: string;
    description?: string;
    location?: string;
    serviceCodes?: string[];
    avatar?: string;
    createdAt?: string;
    updatedAt?: string;
    signature?: string;
    codePackagePath?: string;
    uid?: string
    status?: string;
    isOnline?: boolean;
}
export interface ApplicationSearchCondition {
    code?: string;
    status?: string;
    owner?: string;
    name?: string;
    keyword?: string;
}

export type ApplicationConfigItem = {
    code: string;
    instance: string;
}

function toServiceCodes(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => String(item)).filter((item) => item.length > 0)
    }
    if (value === undefined || value === null) {
        return []
    }
    const text = String(value)
    if (!text) return []
    return text.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
}

function normalizeApplication<T extends Record<string, any>>(app: T | null | undefined): T | null | undefined {
    if (!app) return app
    if ('serviceCodes' in app) {
        return { ...app, serviceCodes: toServiceCodes(app.serviceCodes) }
    }
    return app
}

class $application {

    /**
     * 应用中心 -> 创建应用
     * @param {*} params 
     */
    async create(params: ApplicationMetadata) {
        await indexedCache.insert('applications', params)
    }

    async syncToServer(params: ApplicationMetadata) {
        if (!params) {
            notifyError('❌应用数据为空，无法同步')
            return
        }
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const account = getCurrentAccount()
        const payload: ApplicationMetadata = {
            ...params,
            owner: params.owner || account || '',
            ownerName: params.ownerName || params.owner || account || '',
            version: params.version !== undefined ? Number(params.version) : params.version
        }
        if (!payload.did || payload.version === undefined) {
            notifyError('❌缺少应用 DID 或版本号')
            return
        }
        if (!payload.owner) {
            notifyError('❌缺少应用拥有者')
            return
        }
        const response = await fetch(apiUrl('/api/v1/public/applications'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Failed to sync application: ${response.status} error: ${await response.text()}`);
        }
        const r = await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Sync application failed');
        }
        return normalizeApplication(r.data)
    }
    /**
     * 应用中心 -> 我创建的列表展示接口
     * @param {*} did 
     * @returns 
     */
    async myCreateList(did: string) {
        const res = await indexedCache.indexAll('applications', 'owner', did)
        return res
    }

    async myCreateDelete(uid: string) {
        const res = await indexedCache.deleteByKey('applications', uid)
        return res
    }

    async myCreateUpdate(params) {
        return await indexedCache.updateByKey("applications", {
            uid: params.uid,
            ...params
        })
    }
    /**
     * 应用中心 -> 我创建的应用详情接口
     * @param {*} uid 
     * @returns 
     */
    async myCreateDetailByUid(uid: string) {
        const res = await indexedCache.getByKey('applications', uid)
        return res
    }

    /**
     * 应用中心 -> 我创建的应用详情接口
     * @param {*} uid 
     * @returns 
     */
    async myCreateDeleteByUid(uid: string) {
        const res = await indexedCache.deleteByKey('applications', uid)
        return res
    }

    async search(condition: ApplicationSearchCondition, page?: number, pageSize?: number) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const body = {
            condition: {
                code: condition.code,
                owner: condition.owner,
                name: condition.name,
                keyword: condition.keyword,
                status: condition.status
            },
            page: page || 1,
            pageSize: pageSize || 10
        }

        const response = await fetch(apiUrl('/api/v1/public/applications/search'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r = await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Search failed');
        }
        const items = r.data?.items || []
        return items.map((item) => normalizeApplication(item))
    }

    async myApplyList(applyOwner: string) {
        const res = await indexedCache.indexAll('applications_apply', 'applyOwner', applyOwner)
        return res
    }

    async myApplyCreate(params: ApplicationMetadata) {
        await indexedCache.insert('applications_apply', params)
    }

    async myApplyDelete(uid: string) {
        return await indexedCache.deleteByKey("applications_apply", uid)
    }

    async update(params) {
        // return await applicationProvider.create(params);
        // return new Promise((resolve, reject) => {
        //   resolve(params)
        // })
        return await indexedCache.updateByKey("applications", {
            id: params.did,
            ...params
        })
    }

    async delete(did, version) {
        return await applicationProvider.delete(did, version)
        // return new Promise((resolve, reject) => {
        //   resolve('success')
        // })
    }

    /**
     * 已上线的应用详情
     * @param did 
     * @param version 
     */
    async detail(did: string, version: number) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const url = apiUrl(`/api/v1/public/applications/by-did?did=${encodeURIComponent(did)}&version=${version}`)
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r = await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Fetch failed');
        }
        return normalizeApplication(r.data)
    }

    /**
     * 根据 uid 查询应用详情
     * @param uid 
     */
    async queryByUid(uid: string) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}`), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r = await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Fetch failed');
        }
        return normalizeApplication(r.data)
    }

    async getConfig(uid: string) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/config`), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch config: ${response.status} error: ${await response.text()}`);
        }

        const r = await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Fetch config failed');
        }
        return r.data?.config || [];
    }

    async saveConfig(uid: string, config: ApplicationConfigItem[]) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/config`), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
            body: JSON.stringify({ config }),
        });

        if (!response.ok) {
            throw new Error(`Failed to save config: ${response.status} error: ${await response.text()}`);
        }

        const r = await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Save config failed');
        }
        return r.data;
    }

    async offline(target: { uid?: string; did?: string; version?: number } | string, version?: number) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        let uid = ''
        if (typeof target === 'string') {
            uid = target
        } else if (target?.uid) {
            uid = target.uid
        } else if (target?.did && target?.version !== undefined) {
            const detail = await this.detail(target.did, Number(target.version))
            uid = detail?.uid
        } else if (typeof version === 'number') {
            const detail = await this.detail(target as string, version)
            uid = detail?.uid
        }
        if (!uid) {
            notifyError('❌未找到应用 UID')
            return
        }
        const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/unpublish`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r = await response.json();
        return r
    }

    async online(target: ApplicationMetadata | { uid?: string; did?: string; version?: number } | string, version?: number) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        let uid = ''
        if (typeof target === 'string') {
            uid = target
        } else if ((target as any)?.uid) {
            uid = (target as any).uid
        } else if ((target as any)?.did && (target as any)?.version !== undefined) {
            const detail = await this.detail((target as any).did, Number((target as any).version))
            uid = detail?.uid
        } else if (typeof version === 'number') {
            const detail = await this.detail(target as string, version)
            uid = detail?.uid
        }
        if (!uid) {
            notifyError('❌未找到应用 UID')
            return
        }
        const response = await fetch(apiUrl(`/api/v1/public/applications/${uid}/publish`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r = await response.json();
        return r
    }

    async unbind(uid: string) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const account = getCurrentAccount()
        if (account === undefined || account === null) {
            notifyError("❌未查询到当前账户，请登录")
            return
        }
        const res = await indexedCache.getByKey('applications_apply', uid)
        // 删除审批记录
        const applicant = `${account}::${account}`
        const detail = await $audit.search({ applicant: applicant })
        const auditUids = detail.filter((d) => d.meta.appOrServiceMetadata.includes(`"name":"${res.name}"`)).map((s) => s.meta.uid)
        // 删除申请
        for (const item of auditUids) {
            await $audit.cancel(item)
        }
        await indexedCache.deleteByKey('applications_apply', uid)
    }

    async audit(did, version, passed, signature, auditor, comment) {
        return await applicationProvider.audit(did, version, passed, signature, auditor, comment)
        // return new Promise((resolve, reject) => {
        //   resolve("success");
        // });
    }
    getNameSpaceId = async () => {
        let namespaceId = getLocalStorage('namespaceId')
        if (!namespaceId) {
            const nameSpace = await this.creatNameSpace('assistant')
            if (nameSpace.uid) {
                namespaceId = nameSpace.uid
                setLocalStorage('namespaceId', namespaceId)
            }
        }
        return namespaceId
    }
}

export default new $application()
