export type BusinessStatusKey =
  | 'BUSINESS_STATUS_PENDING'
  | 'BUSINESS_STATUS_REVIEWING'
  | 'BUSINESS_STATUS_REJECTED'
  | 'BUSINESS_STATUS_ONLINE'
  | 'BUSINESS_STATUS_OFFLINE'
  | 'BUSINESS_STATUS_UNKNOWN'

export const businessStatusMap: Record<BusinessStatusKey, { text: string; type: string }> = {
  BUSINESS_STATUS_PENDING: { text: '待审核', type: 'info' },
  BUSINESS_STATUS_REVIEWING: { text: '审核中', type: 'warning' },
  BUSINESS_STATUS_REJECTED: { text: '已拒绝', type: 'danger' },
  BUSINESS_STATUS_ONLINE: { text: '已上架', type: 'success' },
  BUSINESS_STATUS_OFFLINE: { text: '已下架', type: 'info' },
  BUSINESS_STATUS_UNKNOWN: { text: '未知', type: 'info' }
}

export const businessStatusOptions: Array<{ label: string; value: BusinessStatusKey }> = [
  { label: '已上架', value: 'BUSINESS_STATUS_ONLINE' },
  { label: '已下架', value: 'BUSINESS_STATUS_OFFLINE' },
  { label: '待审核', value: 'BUSINESS_STATUS_PENDING' },
  { label: '审核中', value: 'BUSINESS_STATUS_REVIEWING' },
  { label: '已拒绝', value: 'BUSINESS_STATUS_REJECTED' }
]

export function resolveBusinessStatus(detail?: { status?: string; isOnline?: boolean }): BusinessStatusKey {
  if (detail?.status) {
    return detail.status as BusinessStatusKey
  }
  if (detail?.isOnline === true) {
    return 'BUSINESS_STATUS_ONLINE'
  }
  if (detail?.isOnline === false) {
    return 'BUSINESS_STATUS_OFFLINE'
  }
  return 'BUSINESS_STATUS_UNKNOWN'
}

export function isBusinessOnline(detail?: { status?: string; isOnline?: boolean }): boolean {
  return resolveBusinessStatus(detail) === 'BUSINESS_STATUS_ONLINE'
}
