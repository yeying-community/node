import { indexedCache } from './account'
import { setLocalStorage, getLocalStorage } from '@/utils/common'
import { createIdentity } from '@yeying-community/yeying-web3'
import $audit from '@/plugins/audit'
import { getCurrentAccount, getAuthToken } from './auth'
import { notifyError } from '@/utils/message'
import { getWalletDataStore } from '@/stores/auth'

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

class $application {

    /**
     * 应用中心 -> 创建应用
     * @param {*} params 
     */
    async create(params: ApplicationMetadata) {
        await indexedCache.insert('applications', params)
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
        let params: { page?: number; pageSize?: number; condition?: Record<string, any> } = {}
        params.page = page || 1
        params.pageSize = pageSize || 10
        params.condition = condition || {}
        const header = {
            "did": "xxxx"
        }
        const body = {
            "header": header,
            "body": {
                "condition": {
                    "code": condition.code,
                    "owner": condition.owner,
                    "name": condition.name,
                    "keyword": condition.keyword,
                    "status": condition.status
                },
                "page": {
                    "page": page || 1,
                    "pageSize": pageSize || 10
                }
            }
        }
        console.log(`authorization=${token}`)
        
        const response = await fetch('/api/v1/application/search', {
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

        const r =  await response.json();
        return r.body.applications
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

    async createIdentity(template, password) {
        return await createIdentity(template, password)
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
        const header = {
            "did": "xxxx"
        }
        const body = {
            "header": header,
            "body": {
                "did": did,
                "version": version
            }
        }
        const response = await fetch('/api/v1/application/detail', {
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

        const r =  await response.json();
        return r.body.application
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
        const header = {
            "did": "xxxx"
        }
        const body = {
            "header": header,
            "body": {
                "uid": uid,
            }
        }
        const response = await fetch('/api/v1/application/querybyuid', {
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

        const r =  await response.json();
        return r.body.application
    }

    async offline(did: string, version: number) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const header = {
            "did": "xxxx"
        }
        const body = {
            "header": header,
            "body": {
                "did": did,
                "version": version
            }
        }
        const response = await fetch('/api/v1/application/unpublish', {
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

        const r =  await response.json();
        return r.body.status
    }

    async online(application: ApplicationMetadata) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        const header = {
            "did": "xxxx"
        }
        const body = {
            "header": header,
            "body": {
                "did": application?.did,
                "version": application?.version
            }
        }
        const response = await fetch('/api/v1/application/publish', {
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

        const r =  await response.json();
        return r.body.application
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
        const detail = await $audit.search({applicant: applicant})
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
