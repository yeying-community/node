import type { NotificationListItem } from '@/plugins/notification'

export function getNotificationTypeLabel(t: (key: string) => string, type: string) {
  const normalized = String(type || '').trim()
  switch (normalized) {
    case 'audit.approved':
      return t('header_notification_audit_approved')
    case 'audit.created':
      return t('header_notification_audit_created')
    case 'audit.rejected':
      return t('header_notification_audit_rejected')
    case 'totp.request_approved':
      return t('header_notification_totp_approved')
    case 'totp.request_expired':
      return t('header_notification_totp_expired')
    case 'application.created':
      return t('notification_type_application_created')
    case 'application.updated':
      return t('notification_type_application_updated')
    case 'application.published':
      return t('notification_type_application_published')
    case 'application.unpublished':
      return t('notification_type_application_unpublished')
    case 'application.deleted':
      return t('notification_type_application_deleted')
    case 'application.config_updated':
      return t('notification_type_application_config_updated')
    default:
      return t('header_notification_system')
  }
}

export function resolveNotificationRoute(item: NotificationListItem) {
  const type = String(item.type || '').trim()
  if (type.startsWith('application.')) {
    const payload = item.payload || {}
    const applicationUid = String(payload.applicationUid || item.subjectId || '').trim()
    const targetDid = String(payload.did || '').trim()
    const targetVersionRaw = payload.version
    const targetVersion =
      typeof targetVersionRaw === 'number' ? targetVersionRaw : Number(targetVersionRaw)
    if (type === 'application.deleted') {
      return {
        path: '/market/dev/my-apps',
        query: {
          tab: 'myCreate',
          fromNotification: '1',
          notificationUid: item.notificationUid,
        },
      }
    }
    return {
      path: '/market/dev/my-apps',
      query: {
        tab: 'myCreate',
        fromNotification: '1',
        notificationUid: item.notificationUid,
        highlightUid: applicationUid || undefined,
        openUid: applicationUid || undefined,
        ...(applicationUid ? { uid: applicationUid } : {}),
        ...(targetDid ? { did: targetDid } : {}),
        ...(Number.isFinite(targetVersion) ? { version: String(targetVersion) } : {}),
      },
    }
  }
  if (type.startsWith('audit.')) {
    const payload = item.payload || {}
    const auditId = String(payload.auditId || item.subjectId || '').trim()
    const targetUid = String(payload.targetUid || '').trim()
    const targetDid = String(payload.targetDid || '').trim()
    const targetVersionRaw = payload.targetVersion
    const targetVersion =
      typeof targetVersionRaw === 'number' ? targetVersionRaw : Number(targetVersionRaw)
      return {
        path: type === 'audit.created' ? '/market/dev/approval' : '/market/dev/apply-detail',
        query:
          type === 'audit.created'
            ? {
                fromNotification: '1',
                notificationUid: item.notificationUid,
                ...(auditId ? { auditId } : {}),
              }
            : {
                fromNotification: '1',
                notificationUid: item.notificationUid,
                pageFrom: 'myApply',
                ...(auditId ? { auditId } : {}),
                ...(targetUid ? { uid: targetUid } : {}),
              ...(targetDid ? { did: targetDid } : {}),
              ...(Number.isFinite(targetVersion) ? { version: String(targetVersion) } : {}),
            },
    }
  }
  if (type.startsWith('totp.')) {
    const payload = item.payload || {}
    return {
      path: '/market/dev/my-config',
      query: {
        authTab: 'totp',
        fromNotification: '1',
        notificationUid: item.notificationUid,
        selectedAppUid: String(payload.appId || '').trim() || undefined,
      },
    }
  }
  return {
    path: '/market/',
    query: {
      fromNotification: '1',
      notificationUid: item.notificationUid,
    },
  }
}

export function getNotificationSourceLabel(t: (key: string) => string, source: string) {
  const normalized = String(source || '').trim()
  switch (normalized) {
    case 'application':
      return t('notification_source_application')
    case 'audit':
      return t('notification_source_audit')
    case 'totp':
      return t('notification_source_totp')
    default:
      return t('notification_source_system')
  }
}

export function getNotificationLevelLabel(t: (key: string) => string, level: string) {
  const normalized = String(level || '').trim()
  switch (normalized) {
    case 'success':
      return t('notification_level_success')
    case 'warning':
      return t('notification_level_warning')
    case 'error':
      return t('notification_level_error')
    default:
      return t('notification_level_info')
  }
}
