import { getWalletDataStore } from "@/stores/auth";
import { notifyError } from "@/utils/message";
import { getAuthToken } from "@/plugins/auth";
import { apiUrl } from './api'

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

export interface ApproverPolicy {
  approvers: string[];
  requiredApprovals: number;
}

function normalizeApproverList(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return normalizeApproverList(parsed);
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  if (typeof input === 'object') {
    const obj = input as any;
    if (Array.isArray(obj.approvers)) {
      return normalizeApproverList(obj.approvers);
    }
  }
  return [];
}

function normalizeRequiredApprovals(value: unknown, maxApprovers: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  let required = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1;
  if (maxApprovers > 0) {
    required = Math.min(required, maxApprovers);
  }
  return required;
}

export function parseApproverPolicy(raw?: string): ApproverPolicy {
  if (!raw || !raw.trim()) {
    return { approvers: [], requiredApprovals: 1 };
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const approvers = normalizeApproverList(parsed);
      return { approvers, requiredApprovals: normalizeRequiredApprovals(1, approvers.length) };
    }
    if (parsed && typeof parsed === 'object') {
      const approvers = normalizeApproverList((parsed as any).approvers);
      const requiredApprovals = normalizeRequiredApprovals((parsed as any).requiredApprovals, approvers.length);
      return { approvers, requiredApprovals };
    }
  } catch {
    // ignore parse errors
  }
  const approvers = normalizeApproverList(raw);
  return { approvers, requiredApprovals: normalizeRequiredApprovals(1, approvers.length) };
}

export function resolveAuditState(metas?: AuditCommentMetadata[], approverRaw?: string) {
  let status: string = "待审批";
  if (metas === undefined || metas.length === 0) {
    return status;
  }

  const statusList: AuditCommentStatusEnum[] = metas
    .map(item => item.status)
    .filter((status): status is AuditCommentStatusEnum => status !== undefined);

  if (statusList.length === 0) {
    return status;
  }

  if (statusList.includes(AuditCommentStatusEnum.COMMENTSTATUSREJECT)) {
    return '审批驳回';
  }
  const { requiredApprovals } = parseApproverPolicy(approverRaw);
  const approvals = statusList.filter((item) => item === AuditCommentStatusEnum.COMMENTSTATUSAGREE).length;
  if (approvals >= Math.max(1, requiredApprovals)) {
    return '审批通过';
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
        state: resolveAuditState(auditMyApply.commentMeta, auditMyApply.meta.approver),
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
        
        const response = await fetch(apiUrl('/api/v1/public/audits'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
            body: JSON.stringify(meta),
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r =  await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Create audit failed');
        }
        return r
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
        const body = {
            condition: condition || {}
        }
        const response = await fetch(apiUrl('/api/v1/public/audits/search'), {
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
        if (r.code !== 0) {
            throw new Error(r.message || 'Search audits failed');
        }
        return r.data?.items || []
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
        const response = await fetch(apiUrl(`/api/v1/admin/audits/${metadata.auditId}/approve`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
            body: JSON.stringify({ text: metadata.text || '', signature: metadata.signature || '' }),
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r =  await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Approve failed');
        }
        return r.data
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
        const response = await fetch(apiUrl(`/api/v1/admin/audits/${metadata.auditId}/reject`), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
            body: JSON.stringify({ text: metadata.text || '', signature: metadata.signature || '' }),
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r =  await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Reject failed');
        }
        return r.data
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
        const response = await fetch(apiUrl(`/api/v1/public/audits/${uid}`), {
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

        const r =  await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Fetch audit failed');
        }
        return r.data
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
        const response = await fetch(apiUrl(`/api/v1/public/audits/${uid}`), {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                "authorization": `Bearer ${token}`,
                'accept': 'application/json'
            },
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create post: ${response.status} error: ${await response.text()}`);
        }

        const r =  await response.json();
        if (r.code !== 0) {
            throw new Error(r.message || 'Cancel audit failed');
        }
        return r.data
    }
    
}

export default new $audit()
