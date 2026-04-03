import { runWithRequestContext } from '../src/common/requestContext'

const auditStore = new Map<string, any>()
const commentStore = new Map<string, any[]>()
const applicationStore = new Map<string, any>()
const serviceStore = new Map<string, any>()

const updateApplicationPublishStateMock = jest.fn()
const updateServicePublishStateMock = jest.fn()

function normalizeAuditLike(raw?: string) {
  if (!raw) return ''
  return String(raw).split('::')[0]?.trim().toLowerCase() || ''
}

function filterAudits(condition: {
  approver?: string
  applicant?: string
  name?: string
  auditType?: string
  startTime?: string
  endTime?: string
}) {
  return Array.from(auditStore.values())
    .filter((item) => {
      if (condition.approver) {
        const approver = normalizeAuditLike(condition.approver)
        if (approver && !String(item.approver || '').toLowerCase().includes(approver)) {
          return false
        }
      }
      if (condition.applicant) {
        const applicant = normalizeAuditLike(condition.applicant)
        if (applicant && !String(item.applicant || '').toLowerCase().includes(applicant)) {
          return false
        }
      }
      if (condition.auditType && String(item.auditType || '') !== condition.auditType) {
        return false
      }
      if (condition.name) {
        const keyword = String(condition.name)
        if (
          !String(item.targetName || '').includes(keyword) &&
          !String(item.appOrServiceMetadata || '').includes(`"name":"${keyword}`)
        ) {
          return false
        }
      }
      if (condition.startTime) {
        const start = Date.parse(condition.startTime)
        if (Number.isFinite(start) && item.createdAt.getTime() < start) {
          return false
        }
      }
      if (condition.endTime) {
        const end = Date.parse(condition.endTime)
        if (Number.isFinite(end) && item.createdAt.getTime() > end) {
          return false
        }
      }
      return true
    })
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
}

jest.mock('../src/common/permission', () => ({
  ensureUserActive: jest.fn().mockResolvedValue(undefined),
  ensureUserCanApproveAudit: jest.fn().mockResolvedValue(undefined),
  ensureUserCanSubmitAudit: jest.fn().mockResolvedValue(undefined),
  ensureUserCanWriteBusinessData: jest.fn().mockResolvedValue(undefined),
  isAdminUser: jest.fn().mockResolvedValue(false),
}))

jest.mock('../src/config/runtime', () => ({
  getConfig: jest.fn().mockReturnValue({}),
}))

jest.mock('../src/domain/manager/audit', () => ({
  AuditManager: jest.fn().mockImplementation(() => ({
    queryByTarget: async (targetType: string, did: string, version: number) =>
      Array.from(auditStore.values()).filter(
        (item) =>
          item.targetType === targetType &&
          item.targetDid === did &&
          Number(item.targetVersion) === Number(version)
      ),
    save: async (audit: any) => {
      auditStore.set(audit.uid, audit)
      return audit
    },
    queryById: async (uid: string) => auditStore.get(uid) || null,
    delete: async (uid: string) => {
      auditStore.delete(uid)
      return { deleted: true, uid }
    },
    queryByCondition: async (condition: any, page: number, pageSize: number) => {
      const filtered = filterAudits(condition || {})
      const start = (page - 1) * pageSize
      return {
        data: filtered.slice(start, start + pageSize),
        page: {
          total: filtered.length,
          page,
          pageSize,
        },
      }
    },
    queryByConditionAll: async (condition: any) => filterAudits(condition || {}),
  })),
}))

jest.mock('../src/domain/manager/comments', () => ({
  CommentManager: jest.fn().mockImplementation(() => ({
    queryByAuditId: async (auditId: string) => commentStore.get(auditId) || [],
    save: async (comment: any) => {
      const list = commentStore.get(comment.auditId) || []
      list.push(comment)
      commentStore.set(comment.auditId, list)
      return comment
    },
    delete: async (uid: string) => {
      for (const [auditId, comments] of commentStore.entries()) {
        commentStore.set(
          auditId,
          comments.filter((item) => item.uid !== uid)
        )
      }
      return { deleted: true, uid }
    },
  })),
}))

jest.mock('../src/domain/manager/application', () => ({
  ApplicationManager: jest.fn().mockImplementation(() => ({
    query: async (did: string, version: number) =>
      applicationStore.get(`${did}:${version}`) || null,
    updatePublishState: async (did: string, version: number, status: string, isOnline: boolean) => {
      updateApplicationPublishStateMock(did, version, status, isOnline)
      const key = `${did}:${version}`
      const existing = applicationStore.get(key)
      if (existing) {
        applicationStore.set(key, {
          ...existing,
          status,
          isOnline,
        })
      }
      return true
    },
  })),
}))

jest.mock('../src/domain/manager/service', () => ({
  ServiceManager: jest.fn().mockImplementation(() => ({
    query: async (did: string, version: number) => serviceStore.get(`${did}:${version}`) || null,
    updatePublishState: async (did: string, version: number, status: string, isOnline: boolean) => {
      updateServicePublishStateMock(did, version, status, isOnline)
      const key = `${did}:${version}`
      const existing = serviceStore.get(key)
      if (existing) {
        serviceStore.set(key, {
          ...existing,
          status,
          isOnline,
        })
      }
      return true
    },
  })),
}))

const { AuditService } = jest.requireActual('../src/domain/service/audit') as typeof import('../src/domain/service/audit')

function runAs<T>(address: string, execute: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    runWithRequestContext(
      {
        address,
        authType: 'jwt',
      },
      () => {
        Promise.resolve(execute()).then(resolve, reject)
      }
    )
  })
}

describe('AuditService', () => {
  beforeEach(() => {
    auditStore.clear()
    commentStore.clear()
    applicationStore.clear()
    serviceStore.clear()
    updateApplicationPublishStateMock.mockClear()
    updateServicePublishStateMock.mockClear()
  })

  it('allows non-owner usage requests without changing publish state', async () => {
    applicationStore.set('did:app:usage:1:1', {
      did: 'did:app:usage:1',
      version: 1,
      owner: '0x1111111111111111111111111111111111111111',
      name: 'Usage App',
      status: 'BUSINESS_STATUS_ONLINE',
      isOnline: true,
    })
    const service = new AuditService()

    const created = await runAs('0x2222222222222222222222222222222222222222', async () =>
      service.create({
        uid: 'audit-usage-create-1',
        auditType: 'application',
        applicant: '0x2222222222222222222222222222222222222222::0x2222222222222222222222222222222222222222',
        approver: '0x1111111111111111111111111111111111111111::owner',
        reason: '申请使用',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        signature: 'sig',
        appOrServiceMetadata: JSON.stringify({
          operateType: 'application',
          did: 'did:app:usage:1',
          version: 1,
          name: 'Usage App',
        }),
      })
    )

    expect(created.meta.uid).toBe('audit-usage-create-1')
    expect(created.meta.reason).toBe('申请使用')
    expect(updateApplicationPublishStateMock).not.toHaveBeenCalled()
  })

  it('keeps publish audits owner-only', async () => {
    applicationStore.set('did:app:publish:1:1', {
      did: 'did:app:publish:1',
      version: 1,
      owner: '0x1111111111111111111111111111111111111111',
      name: 'Publish App',
      status: 'BUSINESS_STATUS_OFFLINE',
      isOnline: false,
    })
    const service = new AuditService()

    await expect(
      runAs('0x2222222222222222222222222222222222222222', async () =>
        service.create({
          uid: 'audit-publish-create-1',
          auditType: 'application',
          applicant: '0x2222222222222222222222222222222222222222::0x2222222222222222222222222222222222222222',
          approver: '0x1111111111111111111111111111111111111111::owner',
          reason: '上架申请',
          createdAt: '2026-04-03T00:00:00.000Z',
          updatedAt: '2026-04-03T00:00:00.000Z',
          signature: 'sig',
          appOrServiceMetadata: JSON.stringify({
            operateType: 'application',
            did: 'did:app:publish:1',
            version: 1,
            name: 'Publish App',
          }),
        })
      )
    ).rejects.toThrow('Applicant is not owner')
  })

  it('does not update publish state when approving usage requests', async () => {
    applicationStore.set('did:app:usage:approve:1', {
      did: 'did:app:usage:approve',
      version: 1,
      owner: '0x1111111111111111111111111111111111111111',
      name: 'Usage App',
      status: 'BUSINESS_STATUS_ONLINE',
      isOnline: true,
    })
    auditStore.set('audit-usage-approve-1', {
      uid: 'audit-usage-approve-1',
      auditType: 'application',
      applicant: '0x2222222222222222222222222222222222222222::0x2222222222222222222222222222222222222222',
      approver: JSON.stringify({
        approvers: ['0x1111111111111111111111111111111111111111'],
        requiredApprovals: 1,
      }),
      reason: '申请使用',
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      signature: 'sig',
      appOrServiceMetadata: JSON.stringify({
        operateType: 'application',
        did: 'did:app:usage:approve',
        version: 1,
        name: 'Usage App',
      }),
      targetType: 'application',
      targetDid: 'did:app:usage:approve',
      targetVersion: 1,
      targetName: 'Usage App',
      previousTargetStatus: 'BUSINESS_STATUS_ONLINE',
      previousTargetIsOnline: true,
    })
    const service = new AuditService()

    const saved = await runAs('0x1111111111111111111111111111111111111111', async () =>
      service.approve({
        uid: 'comment-usage-approve-1',
        auditId: 'audit-usage-approve-1',
        text: 'ok',
        status: '',
        createdAt: new Date('2026-04-03T00:00:00.000Z'),
        updatedAt: new Date('2026-04-03T00:00:00.000Z'),
        signature: '',
      } as any)
    )

    expect(saved.status).toBe('COMMENT_STATUS_AGREE')
    expect(updateApplicationPublishStateMock).not.toHaveBeenCalled()
  })

  it('returns aggregated decision summary in audit detail', async () => {
    const approverA = '0x1111111111111111111111111111111111111111'
    const approverB = '0x2222222222222222222222222222222222222222'
    auditStore.set('audit-detail-summary-1', {
      uid: 'audit-detail-summary-1',
      auditType: 'application',
      applicant: '0x3333333333333333333333333333333333333333::user-c',
      approver: JSON.stringify({
        approvers: [`${approverA}::owner-a`, approverB],
        requiredApprovals: 2,
      }),
      reason: '申请使用',
      createdAt: new Date('2026-04-03T02:00:00.000Z'),
      updatedAt: new Date('2026-04-03T02:00:00.000Z'),
      signature: 'sig',
      appOrServiceMetadata: JSON.stringify({
        operateType: 'application',
        did: 'did:app:detail:1',
        version: 1,
        name: 'Summary App',
      }),
      targetType: 'application',
      targetDid: 'did:app:detail:1',
      targetVersion: 1,
      targetName: 'Summary App',
      previousTargetStatus: 'BUSINESS_STATUS_ONLINE',
      previousTargetIsOnline: true,
    })
    commentStore.set('audit-detail-summary-1', [
      {
        uid: 'comment-detail-summary-1',
        auditId: 'audit-detail-summary-1',
        text: 'ok-a',
        status: 'COMMENT_STATUS_AGREE',
        createdAt: new Date('2026-04-03T02:10:00.000Z'),
        updatedAt: new Date('2026-04-03T02:10:00.000Z'),
        signature: approverA,
      },
    ])

    const service = new AuditService()

    const detail = await runAs(approverA, async () => service.detail('audit-detail-summary-1'))

    expect(detail.summary).toEqual({
      state: '待审批',
      approvers: [approverA, approverB],
      requiredApprovals: 2,
      approvalCount: 1,
      rejectionCount: 0,
      approvedBy: [approverA],
      rejectedBy: [],
      pendingApprovers: [approverB],
      isDecided: false,
    })
  })

  it('filters approval search by state and auditType before pagination', async () => {
    const owner = '0x1111111111111111111111111111111111111111'
    auditStore.set('audit-query-1', {
      uid: 'audit-query-1',
      auditType: 'application',
      applicant: '0x2222222222222222222222222222222222222222::user-a',
      approver: JSON.stringify({
        approvers: [owner],
        requiredApprovals: 1,
      }),
      reason: '申请使用',
      createdAt: new Date('2026-04-03T02:00:00.000Z'),
      updatedAt: new Date('2026-04-03T02:00:00.000Z'),
      signature: 'sig',
      appOrServiceMetadata: JSON.stringify({
        operateType: 'application',
        did: 'did:app:query:1',
        version: 1,
        name: 'Search App A',
      }),
      targetType: 'application',
      targetDid: 'did:app:query:1',
      targetVersion: 1,
      targetName: 'Search App A',
      previousTargetStatus: 'BUSINESS_STATUS_ONLINE',
      previousTargetIsOnline: true,
    })
    auditStore.set('audit-query-2', {
      uid: 'audit-query-2',
      auditType: 'application',
      applicant: '0x3333333333333333333333333333333333333333::user-b',
      approver: JSON.stringify({
        approvers: [owner],
        requiredApprovals: 1,
      }),
      reason: '申请使用',
      createdAt: new Date('2026-04-03T01:00:00.000Z'),
      updatedAt: new Date('2026-04-03T01:00:00.000Z'),
      signature: 'sig',
      appOrServiceMetadata: JSON.stringify({
        operateType: 'application',
        did: 'did:app:query:2',
        version: 1,
        name: 'Search App B',
      }),
      targetType: 'application',
      targetDid: 'did:app:query:2',
      targetVersion: 1,
      targetName: 'Search App B',
      previousTargetStatus: 'BUSINESS_STATUS_ONLINE',
      previousTargetIsOnline: true,
    })
    auditStore.set('audit-query-3', {
      uid: 'audit-query-3',
      auditType: 'service',
      applicant: '0x4444444444444444444444444444444444444444::user-c',
      approver: JSON.stringify({
        approvers: [owner],
        requiredApprovals: 1,
      }),
      reason: '申请使用',
      createdAt: new Date('2026-04-03T00:00:00.000Z'),
      updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      signature: 'sig',
      appOrServiceMetadata: JSON.stringify({
        operateType: 'service',
        did: 'did:service:query:3',
        version: 1,
        name: 'Search Service C',
      }),
      targetType: 'service',
      targetDid: 'did:service:query:3',
      targetVersion: 1,
      targetName: 'Search Service C',
      previousTargetStatus: 'BUSINESS_STATUS_ONLINE',
      previousTargetIsOnline: true,
    })
    commentStore.set('audit-query-1', [
      {
        uid: 'comment-query-1',
        auditId: 'audit-query-1',
        text: 'ok-a',
        status: 'COMMENT_STATUS_AGREE',
        createdAt: new Date('2026-04-03T02:10:00.000Z'),
        updatedAt: new Date('2026-04-03T02:10:00.000Z'),
        signature: owner,
      },
    ])
    commentStore.set('audit-query-2', [
      {
        uid: 'comment-query-2',
        auditId: 'audit-query-2',
        text: 'ok-b',
        status: 'COMMENT_STATUS_AGREE',
        createdAt: new Date('2026-04-03T01:10:00.000Z'),
        updatedAt: new Date('2026-04-03T01:10:00.000Z'),
        signature: owner,
      },
    ])
    commentStore.set('audit-query-3', [])

    const service = new AuditService()

    const result = await runAs(owner, async () =>
      service.queryByCondition({
        approver: owner,
        auditType: 'application',
        states: ['审批通过'],
        page: 2,
        pageSize: 1,
      })
    )

    expect(result.page.total).toBe(2)
    expect(result.page.page).toBe(2)
    expect(result.page.pageSize).toBe(1)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].meta.uid).toBe('audit-query-2')
    expect(result.data[0].summary).toEqual({
      state: '审批通过',
      approvers: [owner],
      requiredApprovals: 1,
      approvalCount: 1,
      rejectionCount: 0,
      approvedBy: [owner],
      rejectedBy: [],
      pendingApprovers: [],
      isDecided: true,
    })
  })
})
