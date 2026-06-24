<template>
  <div class="notification-center">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>{{ $t('notification_page_breadcrumb') }}</el-breadcrumb-item>
    </el-breadcrumb>

    <div class="page-head">
      <div>
        <h1>{{ $t('notification_page_title') }}</h1>
        <p>{{ $t('notification_page_subtitle') }}</p>
      </div>
      <div class="page-head-actions">
        <span class="summary">
          {{
            unreadCount > 0
              ? `${unreadCount}${$t('header_notification_unread_suffix')}`
              : $t('header_notification_summary_done')
          }}
        </span>
        <el-button :disabled="unreadCount <= 0" @click="handleMarkAllRead">
          {{ $t('header_notification_all_read') }}
        </el-button>
      </div>
    </div>

    <el-tabs v-model="activeView" class="page-view-tabs">
      <el-tab-pane :label="$t('notification_tab_inbox')" name="inbox" />
      <el-tab-pane :label="$t('notification_tab_webhook')" name="webhook" />
    </el-tabs>

    <template v-if="activeView === 'inbox'">
    <div class="filter-bar">
      <button
        v-for="group in sourceGroups"
        :key="group.value"
        type="button"
        class="source-group-card"
        :class="{ active: filters.source === group.value || (!filters.source && group.value === '') }"
        @click="applySourceGroup(group.value)"
      >
        <span class="group-title">{{ group.label }}</span>
        <span class="group-count">{{ group.count }}</span>
      </button>
    </div>

    <div class="filter-bar compact">
      <el-select v-model="filters.applicationUid" clearable :placeholder="$t('notification_filter_application')">
        <el-option :label="$t('notification_filter_all_applications')" value="" />
        <el-option
          v-for="item in applicationFilterOptions"
          :key="item.uid"
          :label="item.name || item.uid"
          :value="item.uid"
        />
      </el-select>
      <el-select v-model="filters.source" clearable :placeholder="$t('notification_filter_source')">
        <el-option :label="$t('notification_filter_all_sources')" value="" />
        <el-option :label="$t('notification_source_application')" value="application" />
        <el-option :label="$t('notification_source_audit')" value="audit" />
        <el-option :label="$t('notification_source_totp')" value="totp" />
      </el-select>
      <el-select v-model="filters.level" clearable :placeholder="$t('notification_filter_level')">
        <el-option :label="$t('notification_filter_all_levels')" value="" />
        <el-option :label="$t('notification_level_info')" value="info" />
        <el-option :label="$t('notification_level_success')" value="success" />
        <el-option :label="$t('notification_level_warning')" value="warning" />
        <el-option :label="$t('notification_level_error')" value="error" />
      </el-select>
      <el-segmented
        v-model="unreadFilter"
        :options="unreadOptions"
      />
      <el-button @click="reloadCurrentPage">{{ $t('notification_reload') }}</el-button>
    </div>

    <div class="content-grid">
      <section class="list-panel">
        <div v-if="loading" class="panel-empty">{{ $t('header_notification_loading') }}</div>
        <div v-else-if="items.length === 0" class="panel-empty">{{ $t('header_notification_empty') }}</div>
        <button
          v-for="item in items"
          :key="item.notificationUid"
          type="button"
          class="notification-row"
          :class="{ active: selectedUid === item.notificationUid, unread: !item.isRead }"
          @click="selectNotification(item)"
        >
          <span class="row-marker" :class="{ unread: !item.isRead }"></span>
          <div class="row-main">
            <div class="row-head">
              <span class="row-title">{{ item.title || notificationTypeLabel(item.type) }}</span>
              <span class="row-time">{{ formatTime(item.createdAt) }}</span>
            </div>
            <div class="row-meta">
              <el-tag size="small" effect="plain">{{ notificationSourceLabel(item.source) }}</el-tag>
              <el-tag size="small" effect="plain">{{ notificationLevelLabel(item.level) }}</el-tag>
            </div>
            <p class="row-body">{{ item.body || notificationTypeLabel(item.type) }}</p>
          </div>
        </button>

        <div class="pagination-wrap">
          <el-pagination
            layout="prev, pager, next"
            :total="pagination.total"
            :page-size="pagination.pageSize"
            :current-page="pagination.page"
            @current-change="handleCurrentChange"
          />
        </div>
      </section>

      <section class="detail-panel">
        <div v-if="detailLoading" class="panel-empty">{{ $t('notification_detail_loading') }}</div>
        <div v-else-if="!selectedItem" class="panel-empty">{{ $t('notification_detail_empty') }}</div>
        <template v-else>
          <div class="detail-head">
            <div>
              <div class="detail-tags">
                <el-tag size="small" effect="plain">{{ notificationSourceLabel(selectedItem.source) }}</el-tag>
                <el-tag size="small" effect="plain">{{ notificationLevelLabel(selectedItem.level) }}</el-tag>
                <el-tag size="small" :type="selectedItem.isRead ? 'info' : 'primary'" effect="light">
                  {{ selectedItem.isRead ? $t('notification_status_read') : $t('notification_status_unread') }}
                </el-tag>
              </div>
              <h2>{{ selectedItem.title || notificationTypeLabel(selectedItem.type) }}</h2>
              <p class="detail-time">{{ formatFullTime(selectedItem.createdAt) }}</p>
            </div>
            <el-button @click="openNotificationTarget(selectedItem)">
              {{ $t('notification_open_related') }}
            </el-button>
          </div>

          <div class="detail-body">
            <p>{{ selectedItem.body || notificationTypeLabel(selectedItem.type) }}</p>
          </div>

          <div class="detail-section">
            <div class="detail-section-title">{{ $t('notification_detail_related') }}</div>
            <div class="meta-grid">
              <div v-for="entry in relatedSummary" :key="entry.label" class="meta-item">
                <span class="meta-label">{{ entry.label }}</span>
                <span class="meta-value">{{ entry.value }}</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <div class="detail-section-title">{{ $t('notification_detail_meta') }}</div>
            <div class="meta-grid">
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_detail_type') }}</span>
                <span class="meta-value">{{ selectedItem.type || '-' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_detail_subject') }}</span>
                <span class="meta-value">{{ selectedItem.subjectId || '-' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_detail_actor') }}</span>
                <span class="meta-value">{{ selectedItem.actor || '-' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_detail_delivered') }}</span>
                <span class="meta-value">{{ formatFullTime(selectedItem.deliveredAt) }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_detail_read_at') }}</span>
                <span class="meta-value">{{ formatFullTime(selectedItem.readAt) }}</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <div class="detail-section-title">{{ $t('notification_detail_payload') }}</div>
            <pre class="payload-block">{{ payloadText }}</pre>
          </div>
        </template>
      </section>
    </div>
    </template>

    <template v-else>
      <div class="webhook-layout">
        <section class="webhook-form-panel">
          <div class="detail-section-title">{{ $t('notification_webhook_create') }}</div>
          <div class="webhook-form">
            <el-select v-model="webhookForm.applicationUid" clearable :placeholder="$t('notification_webhook_app')">
              <el-option
                v-for="item in ownedApplications"
                :key="item.uid"
                :label="item.name || item.uid"
                :value="item.uid"
              />
            </el-select>
            <el-select v-model="webhookForm.events" multiple clearable :placeholder="$t('notification_webhook_events')">
              <el-option v-for="item in webhookEventOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-input v-model="webhookForm.targetUrl" :placeholder="$t('notification_webhook_target')" />
            <el-input v-model="webhookForm.secret" :placeholder="$t('notification_webhook_secret')" />
            <el-switch v-model="webhookForm.enabled" />
            <el-button type="primary" @click="submitWebhook">{{ $t('notification_webhook_submit') }}</el-button>
          </div>
        </section>

        <section class="webhook-list-panel">
          <div class="detail-section-title">{{ $t('notification_webhook_list') }}</div>
          <div v-if="webhookLoading" class="panel-empty">{{ $t('header_notification_loading') }}</div>
          <div v-else-if="webhooks.length === 0" class="panel-empty">{{ $t('notification_webhook_empty') }}</div>
          <div v-else class="webhook-items">
            <div v-for="item in webhooks" :key="item.uid" class="webhook-item">
              <div class="webhook-item-head">
                <div>
                  <div class="webhook-url">{{ item.targetUrl }}</div>
                  <div class="webhook-meta">
                    <span>{{ $t('notification_webhook_app_id') }}：{{ item.applicationUid || '-' }}</span>
                    <span>{{ $t('notification_webhook_secret_masked') }}：{{ item.secretMasked || '-' }}</span>
                  </div>
                </div>
                <el-switch :model-value="item.enabled" @change="toggleWebhook(item, $event)" />
              </div>
              <div class="webhook-events">
                <el-tag v-for="eventName in item.events" :key="eventName" size="small" effect="plain">
                  {{ eventName }}
                </el-tag>
              </div>
              <div class="webhook-actions">
                <span class="webhook-time">{{ $t('notification_webhook_last_triggered') }}：{{ formatFullTime(item.lastTriggeredAt) }}</span>
                <el-button text type="danger" @click="removeWebhook(item.uid)">{{ $t('notification_webhook_delete') }}</el-button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { useRoute, useRouter } from 'vue-router'
import $notification, { type NotificationListItem, type NotificationStreamPayload, type NotificationWebhookItem } from '@/plugins/notification'
import { getNotificationLevelLabel, getNotificationSourceLabel, getNotificationTypeLabel, resolveNotificationRoute } from '@/plugins/notificationMeta'
import $application, { type ApplicationMetadata } from '@/plugins/application'
import { notifyError } from '@/utils/message'

const route = useRoute()
const router = useRouter()
const { proxy } = getCurrentInstance()!
const { $t } = proxy

const items = ref<NotificationListItem[]>([])
const loading = ref(false)
const detailLoading = ref(false)
const unreadCount = ref(0)
const activeView = ref<'inbox' | 'webhook'>('inbox')
const selectedUid = ref('')
const selectedItem = ref<NotificationListItem | null>(null)
const ownedApplications = ref<ApplicationMetadata[]>([])
const webhooks = ref<NotificationWebhookItem[]>([])
const webhookLoading = ref(false)
const filters = reactive({
  applicationUid: '',
  source: '',
  level: '',
})
const webhookForm = reactive({
  applicationUid: '',
  events: [] as string[],
  targetUrl: '',
  secret: '',
  enabled: true,
})
const unreadFilter = ref<'all' | 'unread'>('all')
const pagination = reactive({
  page: 1,
  pageSize: 12,
  total: 0,
})
const unreadOptions = computed(() => [
  { label: String($t('notification_filter_all')), value: 'all' },
  { label: String($t('notification_filter_unread_only')), value: 'unread' },
])
const applicationFilterOptions = computed(() => {
  const currentUid = String(filters.applicationUid || '').trim()
  const items = [...ownedApplications.value]
  if (currentUid && !items.some((item) => String(item.uid || '').trim() === currentUid)) {
    items.unshift({
      uid: currentUid,
      did: '',
      name: currentUid,
      owner: '',
      ownerName: '',
      path: '',
      homepage: '',
      logo: '',
      desc: '',
      tags: [],
      images: [],
      sourceCode: '',
      extensionConfig: {},
      status: '',
      version: 0,
      createAt: '',
      updateAt: '',
      createTime: '',
      updateTime: '',
    } as ApplicationMetadata)
  }
  return items
})
const sourceGroups = computed(() => {
  const counters = {
    all: items.value.length,
    application: 0,
    audit: 0,
    totp: 0,
  }
  for (const item of items.value) {
    const source = String(item.source || '').trim()
    if (source === 'application') counters.application += 1
    else if (source === 'audit') counters.audit += 1
    else if (source === 'totp') counters.totp += 1
  }
  return [
    { value: '', label: String($t('notification_filter_all_sources')), count: counters.all },
    { value: 'application', label: String($t('notification_source_application')), count: counters.application },
    { value: 'audit', label: String($t('notification_source_audit')), count: counters.audit },
    { value: 'totp', label: String($t('notification_source_totp')), count: counters.totp },
  ]
})
const webhookEventOptions = computed(() => [
  { label: 'application.created', value: 'application.created' },
  { label: 'application.updated', value: 'application.updated' },
  { label: 'application.published', value: 'application.published' },
  { label: 'application.unpublished', value: 'application.unpublished' },
  { label: 'application.deleted', value: 'application.deleted' },
  { label: 'application.config_updated', value: 'application.config_updated' },
  { label: 'audit.created', value: 'audit.created' },
  { label: 'audit.approved', value: 'audit.approved' },
  { label: 'audit.rejected', value: 'audit.rejected' },
  { label: 'totp.request_approved', value: 'totp.request_approved' },
  { label: 'totp.request_expired', value: 'totp.request_expired' },
])

let notificationStream: { close: () => Promise<void> } | null = null
let streamErrorShown = false

const payloadText = computed(() => {
  if (!selectedItem.value?.payload || Object.keys(selectedItem.value.payload).length === 0) {
    return '{}'
  }
  return JSON.stringify(selectedItem.value.payload, null, 2)
})
const relatedSummary = computed(() => {
  const item = selectedItem.value
  if (!item) {
    return []
  }
  const payload = item.payload || {}
  const entries: Array<{ label: string; value: string }> = []
  const pushEntry = (labelKey: string, rawValue: unknown) => {
    const value = String(rawValue || '').trim()
    if (!value) {
      return
    }
    entries.push({
      label: String($t(labelKey)),
      value,
    })
  }

  pushEntry('notification_related_name', payload.name || payload.targetName || payload.appName)
  pushEntry('notification_related_app_id', payload.applicationUid || payload.appId || payload.targetUid)
  pushEntry('notification_related_audit_id', payload.auditId)
  pushEntry('notification_related_did', payload.did || payload.targetDid)
  pushEntry('notification_related_version', payload.version ?? payload.targetVersion)
  pushEntry('notification_related_request_id', payload.requestId)

  return entries
})

function notificationTypeLabel(type: string) {
  return getNotificationTypeLabel((key) => String($t(key)), type)
}

function notificationSourceLabel(source: string) {
  return getNotificationSourceLabel((key) => String($t(key)), source)
}

function notificationLevelLabel(level: string) {
  return getNotificationLevelLabel((key) => String($t(key)), level)
}

function formatTime(value: string) {
  const parsed = dayjs(String(value || '').trim())
  if (!parsed.isValid()) {
    return '-'
  }
  return parsed.format('MM-DD HH:mm')
}

function formatFullTime(value: string) {
  const parsed = dayjs(String(value || '').trim())
  if (!parsed.isValid()) {
    return '-'
  }
  return parsed.format('YYYY-MM-DD HH:mm:ss')
}

function applySourceGroup(value: string) {
  filters.source = value
}

async function loadUnreadCount() {
  const result = await $notification.unreadCount()
  unreadCount.value = Number(result.unreadCount || 0)
}

async function loadList() {
  loading.value = true
  try {
    const result = await $notification.list({
      page: pagination.page,
      pageSize: pagination.pageSize,
      unreadOnly: unreadFilter.value === 'unread',
      applicationUid: filters.applicationUid || undefined,
      source: filters.source || undefined,
      level: filters.level || undefined,
    })
    items.value = Array.isArray(result.items) ? result.items : []
    pagination.total = Number(result.page?.total || 0)
    if (!items.value.find((item) => item.notificationUid === selectedUid.value)) {
      const next = items.value[0]
      if (next) {
        await selectNotification(next, { syncRoute: true })
      } else {
        selectedUid.value = ''
        selectedItem.value = null
        if (String(route.query.uid || '').trim()) {
          const nextQuery = { ...route.query }
          delete nextQuery.uid
          await router.replace({ path: route.path, query: nextQuery })
        }
      }
    }
  } finally {
    loading.value = false
  }
}

async function loadDetail(notificationUid: string) {
  const normalized = String(notificationUid || '').trim()
  if (!normalized) {
    selectedItem.value = null
    return
  }
  detailLoading.value = true
  try {
    const detail = await $notification.detail(normalized)
    selectedItem.value = detail
    selectedUid.value = normalized
  } finally {
    detailLoading.value = false
  }
}

async function markReadIfNeeded(item: NotificationListItem) {
  if (item.isRead) {
    return
  }
  try {
    await $notification.markRead(item.notificationUid)
    item.isRead = true
    item.readAt = dayjs().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
    if (selectedItem.value?.notificationUid === item.notificationUid) {
      selectedItem.value = {
        ...selectedItem.value,
        isRead: true,
        readAt: item.readAt,
      }
    }
  } catch (error) {
    notifyError(`${$t('header_notification_mark_failed')}：${error}`)
  }
}

async function selectNotification(item: NotificationListItem, options: { syncRoute?: boolean } = {}) {
  selectedUid.value = item.notificationUid
  selectedItem.value = item
  await markReadIfNeeded(item)
  await loadDetail(item.notificationUid)
  if (options.syncRoute !== false) {
    await router.replace({
      path: route.path,
      query: {
        ...route.query,
        uid: item.notificationUid,
      },
    })
  }
}

async function openNotificationTarget(item: NotificationListItem) {
  await markReadIfNeeded(item)
  await router.push(resolveNotificationRoute(item))
}

async function reloadCurrentPage() {
  await Promise.all([loadUnreadCount(), loadList()])
}

async function loadOwnedApplications() {
  try {
    const account = String(localStorage.getItem('currentAccount') || '').trim()
    if (!account) {
      ownedApplications.value = []
      return
    }
    const result = await $application.myCreateList(account)
    ownedApplications.value = Array.isArray(result) ? result : []
  } catch (error) {
    ownedApplications.value = []
    notifyError(`${$t('notification_webhook_load_apps_failed')}：${error}`)
  }
}

async function loadWebhooks() {
  webhookLoading.value = true
  try {
    const result = await $notification.listWebhooks()
    webhooks.value = Array.isArray(result.items) ? result.items : []
  } finally {
    webhookLoading.value = false
  }
}

async function submitWebhook() {
  try {
    await $notification.createWebhook({
      applicationUid: webhookForm.applicationUid || undefined,
      events: webhookForm.events,
      targetUrl: webhookForm.targetUrl,
      secret: webhookForm.secret || undefined,
      enabled: webhookForm.enabled,
    })
    webhookForm.applicationUid = ''
    webhookForm.events = []
    webhookForm.targetUrl = ''
    webhookForm.secret = ''
    webhookForm.enabled = true
    await loadWebhooks()
  } catch (error) {
    notifyError(`${$t('notification_webhook_submit_failed')}：${error}`)
  }
}

async function toggleWebhook(item: NotificationWebhookItem, value: string | number | boolean) {
  try {
    const nextEnabled = Boolean(value)
    const updated = await $notification.updateWebhook(item.uid, { enabled: nextEnabled })
    const index = webhooks.value.findIndex((entry) => entry.uid === item.uid)
    if (index >= 0) {
      webhooks.value[index] = updated
    }
  } catch (error) {
    notifyError(`${$t('notification_webhook_toggle_failed')}：${error}`)
  }
}

async function removeWebhook(uid: string) {
  try {
    await $notification.deleteWebhook(uid)
    webhooks.value = webhooks.value.filter((item) => item.uid !== uid)
  } catch (error) {
    notifyError(`${$t('notification_webhook_delete_failed')}：${error}`)
  }
}

async function handleMarkAllRead() {
  if (unreadCount.value <= 0) {
    return
  }
  try {
    await $notification.markAllRead()
    unreadCount.value = 0
    items.value = items.value.map((item) => ({
      ...item,
      isRead: true,
      readAt: item.readAt || dayjs().toISOString(),
    }))
    if (selectedItem.value) {
      selectedItem.value = {
        ...selectedItem.value,
        isRead: true,
        readAt: selectedItem.value.readAt || dayjs().toISOString(),
      }
    }
  } catch (error) {
    notifyError(`${$t('header_notification_read_all_failed')}：${error}`)
  }
}

function applyNotificationEvent(event: string, data: NotificationStreamPayload) {
  if (event === 'unread-count' && 'unreadCount' in data) {
    unreadCount.value = Number(data.unreadCount || 0)
    return
  }
  if ((event === 'notification.created' || event === 'notification.read') && 'unreadCount' in data) {
    unreadCount.value = Number(data.unreadCount || 0)
  }
  if (event === 'notification.created' || event === 'notification.read') {
    void loadList()
  }
}

function ensureNotificationStream() {
  if (notificationStream) {
    return
  }
  notificationStream = $notification.openStream({
    onEvent: (event, data) => {
      applyNotificationEvent(event, data)
    },
    onError: (error) => {
      if (streamErrorShown) {
        return
      }
      streamErrorShown = true
      notifyError(`${$t('header_notification_stream_failed')}：${error instanceof Error ? error.message : String(error)}`)
    },
  })
}

async function closeNotificationStream() {
  if (!notificationStream) {
    return
  }
  const stream = notificationStream
  notificationStream = null
  await stream.close()
}

function handleCurrentChange(page: number) {
  pagination.page = page
  void loadList()
}

watch(
  () => [filters.applicationUid, filters.source, filters.level, unreadFilter.value],
  () => {
    pagination.page = 1
    void loadList()
  }
)

watch(
  () => [filters.applicationUid, filters.source, filters.level, unreadFilter.value, activeView.value],
  async () => {
    const nextQuery = { ...route.query } as Record<string, string>
    if (filters.applicationUid) nextQuery.applicationUid = filters.applicationUid
    else delete nextQuery.applicationUid
    if (filters.source) nextQuery.source = filters.source
    else delete nextQuery.source
    if (filters.level) nextQuery.level = filters.level
    else delete nextQuery.level
    if (unreadFilter.value === 'unread') nextQuery.unreadOnly = 'true'
    else delete nextQuery.unreadOnly
    if (activeView.value !== 'inbox') nextQuery.view = activeView.value
    else delete nextQuery.view
    await router.replace({ path: route.path, query: nextQuery })
  }
)

watch(
  () => route.query.uid,
  (uid) => {
    const normalized = String(uid || '').trim()
    if (!normalized || normalized === selectedUid.value) {
      return
    }
    const existing = items.value.find((item) => item.notificationUid === normalized)
    if (existing) {
      void selectNotification(existing, { syncRoute: false })
      return
    }
    void loadDetail(normalized).catch((error) => {
      notifyError(`${$t('notification_detail_load_failed')}：${error}`)
    })
  },
  { immediate: true }
)

watch(
  () => route.query.applicationUid,
  (value) => {
    const normalized = String(value || '').trim()
    if (normalized !== filters.applicationUid) {
      filters.applicationUid = normalized
    }
  },
  { immediate: true }
)

watch(
  () => route.query.source,
  (value) => {
    const normalized = String(value || '').trim()
    if (normalized !== filters.source) {
      filters.source = normalized
    }
  },
  { immediate: true }
)

watch(
  () => route.query.level,
  (value) => {
    const normalized = String(value || '').trim()
    if (normalized !== filters.level) {
      filters.level = normalized
    }
  },
  { immediate: true }
)

watch(
  () => route.query.unreadOnly,
  (value) => {
    const nextValue = String(value || '').trim() === 'true' ? 'unread' : 'all'
    if (nextValue !== unreadFilter.value) {
      unreadFilter.value = nextValue
    }
  },
  { immediate: true }
)

watch(
  () => route.query.view,
  (value) => {
    const normalized = String(value || '').trim()
    const nextValue = normalized === 'webhook' ? 'webhook' : 'inbox'
    if (nextValue !== activeView.value) {
      activeView.value = nextValue
    }
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    await Promise.all([reloadCurrentPage(), loadOwnedApplications(), loadWebhooks()])
    const queryUid = String(route.query.uid || '').trim()
    if (queryUid) {
      const existing = items.value.find((item) => item.notificationUid === queryUid)
      if (existing) {
        await selectNotification(existing, { syncRoute: false })
      } else {
        await loadDetail(queryUid)
      }
    } else if (items.value[0]) {
      await selectNotification(items.value[0], { syncRoute: true })
    }
    ensureNotificationStream()
  } catch (error) {
    notifyError(`${$t('header_notification_load_failed')}：${error}`)
  }
})

onBeforeUnmount(() => {
  void closeNotificationStream()
})
</script>

<style scoped lang="less">
.notification-center {
  min-height: calc(100dvh - 72px);
  padding: 20px;
  background: #f5f7fb;
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin: 18px 0 16px;

  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    color: #111827;
  }

  p {
    margin: 8px 0 0;
    color: #6b7280;
    font-size: 14px;
  }
}

.page-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.summary {
  color: #4b5563;
  font-size: 14px;
  white-space: nowrap;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.filter-bar.compact {
  margin-top: -4px;
}

.source-group-card {
  min-width: 112px;
  padding: 12px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: #cbd5e1;
    background: #f8fafc;
  }

  &.active {
    border-color: #2563eb;
    background: #eff6ff;
  }
}

.group-title {
  font-size: 13px;
  color: #475569;
}

.group-count {
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(340px, 420px) minmax(0, 1fr);
  gap: 16px;
}

.page-view-tabs {
  margin-bottom: 12px;
}

.list-panel,
.detail-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  min-height: 640px;
}

.list-panel {
  padding: 12px;
}

.detail-panel {
  padding: 18px;
}

.panel-empty {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-size: 14px;
}

.notification-row {
  width: 100%;
  display: flex;
  gap: 12px;
  border: none;
  background: transparent;
  padding: 14px 12px;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;

  &:hover {
    background: #f8fafc;
  }

  &.active {
    background: #f3f6fb;
  }
}

.row-marker {
  width: 8px;
  height: 8px;
  margin-top: 8px;
  border-radius: 999px;
  background: transparent;

  &.unread {
    background: #2563eb;
  }
}

.row-main {
  min-width: 0;
  flex: 1;
}

.row-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.row-title {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.row-time {
  flex: 0 0 auto;
  font-size: 12px;
  color: #9ca3af;
}

.row-meta {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}

.row-body {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pagination-wrap {
  padding-top: 12px;
  display: flex;
  justify-content: center;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;

  h2 {
    margin: 10px 0 0;
    font-size: 22px;
    font-weight: 600;
    color: #111827;
  }
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-time {
  margin: 10px 0 0;
  color: #9ca3af;
  font-size: 13px;
}

.detail-body {
  padding: 16px 0 20px;
  border-top: 1px solid #f3f4f6;
  border-bottom: 1px solid #f3f4f6;
  color: #374151;
  line-height: 1.8;
}

.detail-section {
  margin-top: 18px;
}

.detail-section-title {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.meta-item {
  padding: 12px;
  background: #f8fafc;
  border-radius: 8px;
}

.meta-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: #6b7280;
}

.meta-value {
  display: block;
  font-size: 13px;
  color: #111827;
  word-break: break-all;
}

.payload-block {
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: #0f172a;
  color: #e5e7eb;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
}

.webhook-layout {
  display: grid;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr);
  gap: 16px;
}

.webhook-form-panel,
.webhook-list-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 18px;
}

.webhook-form {
  display: grid;
  gap: 12px;
}

.webhook-items {
  display: grid;
  gap: 12px;
}

.webhook-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  background: #f8fafc;
}

.webhook-item-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.webhook-url {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  word-break: break-all;
}

.webhook-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}

.webhook-events {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.webhook-actions {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.webhook-time {
  font-size: 12px;
  color: #6b7280;
}

@media (max-width: 1100px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .webhook-layout {
    grid-template-columns: 1fr;
  }

  .list-panel,
  .detail-panel {
    min-height: auto;
  }
}

@media (max-width: 768px) {
  .page-head {
    flex-direction: column;
  }

  .page-head-actions {
    width: 100%;
    justify-content: space-between;
  }

  .meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
