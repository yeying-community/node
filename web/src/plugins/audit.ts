import { getWalletDataStore } from "@/stores/auth";
import { notifyError } from "@/utils/message";
import { getAuthToken } from "@/plugins/auth";

export interface AuditAuditMetadata {
    uid?: string;
    appOrServiceMetadata?: string;
    auditType?: string
    applicant?: string;
    approver?: string;
    reason?: string;
    createdAt?: string;
    updatedAt?: string;
    signature?: string;
}

export interface AuditAuditSearchCondition {
    approver?: string;
    name?: string;
    'type'?: string;
    applicant?: string;
    startTime?: string;
    endTime?: string;
}

export enum AuditCommentStatusEnum {
    COMMENTSTATUSAGREE = 'COMMENT_STATUS_AGREE',
    COMMENTSTATUSREJECT = 'COMMENT_STATUS_REJECT'
}

export interface AuditCommentMetadata {
    uid?: string;
    auditId?: string;
    text?: string;
    status?: AuditCommentStatusEnum;
    createdAt?: string;
    updatedAt?: string;
    signature?: string;
}

export interface AuditAuditDetail {
    meta?: AuditAuditMetadata;
    commentMeta?: AuditCommentMetadata[];
}

export interface AuditCommentMetadata {
    uid?: string;
    auditId?: string;
    text?: string;
    status?: AuditCommentStatusEnum;
    createdAt?: string;
    updatedAt?: string;
    signature?: string;
}

export interface AuditDetailBox {
    uid?: string,
    name? : string,
    desc? : string,
    applicantor?: string,
    state?: string,
    date?: string,
    serviceType?: string
}


function allEqualTo<T>(arr: T[], value: T): boolean {
  return arr.every(item => item === value);
}

function getState(metas?: AuditCommentMetadata[]) {
  let status: string = "待审批";
  if (metas === undefined || metas.length === 0) {
    return status;
  }

  // 过滤掉 status 为 undefined 的项
  const statusList: AuditCommentStatusEnum[] = metas
    .map(item => item.status)
    .filter((status): status is AuditCommentStatusEnum => status !== undefined);

  if (statusList.length === 0) {
    return status; // 如果没有有效状态，仍为“待审批”
  }

  if (statusList.includes(AuditCommentStatusEnum.COMMENTSTATUSREJECT)) {
    status = '审批驳回';
  } else if (allEqualTo(statusList, AuditCommentStatusEnum.COMMENTSTATUSAGREE)) {
    status = '审批通过';
  }

  return status;
}

function cvData(auditMyApply: AuditAuditDetail) {
    if (auditMyApply === undefined || auditMyApply.meta === undefined || auditMyApply.meta.appOrServiceMetadata === undefined || auditMyApply.meta.applicant === undefined) {
        return null
    }
    const rawData = JSON.parse(auditMyApply.meta.appOrServiceMetadata);
    const did = auditMyApply.meta.applicant.split('::')[0]

    const metadata: AuditDetailBox = {
        uid: auditMyApply.meta.uid,
        name: rawData.name,
        desc: rawData.description,
        serviceType: auditMyApply.meta.auditType,
        applicantor: did,
        state: getState(auditMyApply.commentMeta),
        date: auditMyApply.meta.createdAt
    };
    return metadata
 
}

export function convertAuditMetadata(auditMyApply: AuditAuditDetail[]) {
  return auditMyApply
    .map(cvData)
    .filter((item): item is AuditDetailBox => item !== null) // ✅ 过滤 null 并类型收窄
}

class $audit {

    async create(meta: AuditAuditMetadata) {
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
                "meta": meta
            }
        }
        const response = await fetch('/api/v1/audit/create', {
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

    async search(condition: AuditAuditSearchCondition) {
        if (localStorage.getItem("hasConnectedWallet") === "false") {
            notifyError('❌未检测到钱包，请先安装并连接钱包');
            return;
        }
        const token = await getAuthToken()
        if (!token) {
            notifyError('❌未获取到访问令牌');
            return;
        }
        console.log(`token=${token}`)
        const header = {
            "did": "xxxx"
        }
        const body = {
            "header": header,
            "body": {
                "condition": condition
            }
        }
        const response = await fetch('/api/v1/audit/search', {
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
        // console.log(`response=${JSON.stringify(r.body.detail)}`)
        return r.body.detail
    }

    async passed(metadata: AuditCommentMetadata) {
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
                "metadata": metadata
            }
        }
        const response = await fetch('/api/v1/admin/audit/approve', {
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
        return r.body.metadata
    }

    async reject(metadata: AuditCommentMetadata) {
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
                "metadata": metadata
            }
        }
        const response = await fetch('/api/v1/admin/audit/reject', {
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
        return r.body.metadata
    }

    async detail(uid: string) {
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
                "uid": uid
            }
        }
        const response = await fetch('/api/v1/audit/detail', {
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
        return r.body.detail
    }

    async cancel(uid: string) {
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
                "uid": uid
            }
        }
        const response = await fetch('/api/v1/audit/cancel', {
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
        return r.body.meta
    }
    
}

export default new $audit()
