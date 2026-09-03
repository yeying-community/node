<template>
  <div class="notification-center">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>{{ $t('notification_page_breadcrumb') }}</el-breadcrumb-item>
    </el-breadcrumb>

    <el-tabs v-model="activeView" class="page-view-tabs">
      <el-tab-pane :label="$t('notification_tab_inbox')" name="inbox" />
      <el-tab-pane :label="$t('notification_tab_webhook')" name="webhook" />
      <el-tab-pane :label="$t('notification_tab_email')" name="email" />
    </el-tabs>

    <template v-if="activeView === 'inbox'">
    <div class="filter-bar compact">
      <el-select
        v-model="filters.applicationUid"
        class="filter-select application-select"
        clearable
        :placeholder="$t('notification_filter_application')"
      >
        <el-option :label="$t('notification_filter_all_applications')" value="" />
        <el-option
          v-for="item in applicationFilterOptions"
          :key="item.uid"
          :label="item.name || item.uid"
          :value="item.uid"
        />
      </el-select>
      <el-select
        v-model="filters.source"
        class="filter-select"
        clearable
        :placeholder="$t('notification_filter_source')"
      >
        <el-option :label="$t('notification_filter_all_sources')" value="" />
        <el-option :label="$t('notification_source_application')" value="application" />
        <el-option :label="$t('notification_source_audit')" value="audit" />
      </el-select>
      <el-select
        v-model="filters.level"
        class="filter-select"
        clearable
        :placeholder="$t('notification_filter_level')"
      >
        <el-option :label="$t('notification_filter_all_levels')" value="" />
        <el-option :label="$t('notification_level_info')" value="info" />
        <el-option :label="$t('notification_level_success')" value="success" />
        <el-option :label="$t('notification_level_warning')" value="warning" />
        <el-option :label="$t('notification_level_error')" value="error" />
      </el-select>
      <el-segmented
        v-model="unreadFilter"
        class="read-filter"
        :options="unreadOptions"
      />
      <el-button class="reload-button" @click="reloadCurrentPage">{{ $t('notification_reload') }}</el-button>
    </div>

    <div class="content-grid">
      <section class="list-panel">
        <div class="notification-list-scroll">
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
        </div>

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

    <template v-else-if="activeView === 'webhook'">
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
                <div class="webhook-action-buttons">
                  <el-button text @click="openDeliveryDialog(item)">{{ $t('notification_webhook_deliveries') }}</el-button>
                  <el-button text type="danger" @click="removeWebhook(item.uid)">{{ $t('notification_webhook_delete') }}</el-button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <template v-else>
      <div v-if="mailAccessLoading || !mailAccessChecked" class="email-permission-panel">
        <div class="panel-empty">{{ $t('notification_email_checking_permission') }}</div>
      </div>
      <div v-else-if="!canManageMail" class="email-permission-panel">
        <div class="permission-card">
          <div class="detail-section-title">{{ $t('notification_email_admin_required_title') }}</div>
          <p>{{ $t('notification_email_admin_required_desc') }}</p>
          <div v-if="mailAuthProfile" class="permission-meta">
            <div class="permission-meta-item">
              <span>{{ $t('notification_email_current_principal') }}</span>
              <strong>{{ mailAuthProfile.address || '-' }}</strong>
            </div>
            <div class="permission-meta-item">
              <span>{{ $t('notification_email_admin_status') }}</span>
              <el-tag :type="mailAuthProfile.isAdmin ? 'success' : 'danger'" effect="light">
                {{ mailAuthProfile.isAdmin ? $t('notification_email_admin_verified') : $t('notification_email_admin_not_verified') }}
              </el-tag>
            </div>
          </div>
          <p class="permission-hint">{{ $t('notification_email_admin_reload_hint') }}</p>
        </div>
      </div>
      <div v-else class="email-layout">
        <section class="email-settings-panel">
          <div class="panel-heading">
            <div class="detail-section-title">{{ $t('notification_email_settings') }}</div>
            <el-tag :type="mailSettings?.configured ? 'success' : 'warning'" effect="light">
              {{ mailSettings?.configured ? $t('notification_email_configured') : $t('notification_email_not_configured') }}
            </el-tag>
          </div>
          <div v-if="mailSettingsLoading" class="panel-empty">{{ $t('header_notification_loading') }}</div>
          <template v-else>
            <div class="mail-status-grid">
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_provider') }}</span>
                <span class="meta-value">{{ mailSettings?.provider || '-' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_host') }}</span>
                <span class="meta-value">{{ mailSettings?.host || '-' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_port') }}</span>
                <span class="meta-value">{{ mailSettings?.port || '-' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_secure') }}</span>
                <span class="meta-value">{{ yesNo(Boolean(mailSettings?.secure)) }}</span>
              </div>
              <div class="meta-item wide">
                <span class="meta-label">{{ $t('notification_email_from') }}</span>
                <span class="meta-value">{{ mailSettings?.from || '-' }}</span>
              </div>
              <div class="meta-item wide">
                <span class="meta-label">{{ $t('notification_email_reply_to') }}</span>
                <span class="meta-value">{{ mailSettings?.replyTo || '-' }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_auth_user') }}</span>
                <span class="meta-value">{{ yesNo(Boolean(mailSettings?.hasAuthUser)) }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_auth_password') }}</span>
                <span class="meta-value">{{ yesNo(Boolean(mailSettings?.hasAuthPassword)) }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_worker') }}</span>
                <span class="meta-value">{{ yesNo(Boolean(mailSettings?.delivery.enabled)) }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">{{ $t('notification_email_batch_size') }}</span>
                <span class="meta-value">{{ mailSettings?.delivery.batchSize || '-' }}</span>
              </div>
            </div>
            <div v-if="mailSettings?.issues?.length" class="mail-issues">
              <el-tag v-for="issue in mailSettings.issues" :key="issue" type="warning" effect="plain">{{ issue }}</el-tag>
            </div>
            <div class="email-test-form">
              <el-input v-model="mailTestForm.to" :placeholder="$t('notification_email_test_to')" />
              <el-input v-model="mailTestForm.subject" :placeholder="$t('notification_email_test_subject')" />
              <el-button type="primary" :loading="mailTestSending" :disabled="!mailSettings?.configured" @click="submitMailTest">
                {{ $t('notification_email_send_test') }}
              </el-button>
            </div>
          </template>
        </section>

        <section class="email-template-panel">
          <div class="template-head">
            <div class="detail-section-title">{{ $t('notification_email_templates') }}</div>
            <div class="template-actions">
              <el-button @click="resetEmailTemplateForm">{{ $t('notification_email_new_template') }}</el-button>
              <el-button @click="loadEmailTemplates">{{ $t('notification_reload') }}</el-button>
            </div>
          </div>
          <div class="email-template-grid">
            <div class="email-template-form">
              <el-input v-model="emailTemplateForm.templateId" :placeholder="$t('notification_email_template_id')" :disabled="Boolean(editingEmailTemplateId)" />
              <el-input-number v-model="emailTemplateForm.version" :min="1" controls-position="right" />
              <el-input v-model="emailTemplateForm.appId" :placeholder="$t('notification_email_template_app')" />
              <el-select v-model="emailTemplateForm.category" :placeholder="$t('notification_email_template_category')">
                <el-option v-for="item in emailCategoryOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
              <el-input v-model="emailTemplateForm.eventTypesText" type="textarea" :rows="2" :placeholder="$t('notification_email_template_events')" />
              <el-input v-model="emailTemplateForm.zhSubject" :placeholder="$t('notification_email_template_subject')" />
              <el-input v-model="emailTemplateForm.zhTextBody" type="textarea" :rows="4" :placeholder="$t('notification_email_template_text')" />
              <el-input v-model="emailTemplateForm.zhHtmlBody" type="textarea" :rows="5" :placeholder="$t('notification_email_template_html')" />
              <el-input v-model="emailTemplateForm.variablesText" type="textarea" :rows="2" :placeholder="$t('notification_email_template_variables')" />
              <div class="template-form-actions">
                <el-switch v-model="emailTemplateForm.enabled" />
                <el-button type="primary" :loading="emailTemplateSaving" @click="submitEmailTemplate">
                  {{ $t('notification_email_save_template') }}
                </el-button>
              </div>
            </div>
            <div class="email-template-list">
              <div v-if="emailTemplatesLoading" class="panel-empty">{{ $t('header_notification_loading') }}</div>
              <div v-else-if="emailTemplates.length === 0" class="panel-empty">{{ $t('notification_email_templates_empty') }}</div>
              <div v-else class="template-items">
                <div v-for="item in emailTemplates" :key="`${item.templateId}:${item.version}`" class="template-item">
                  <div class="template-item-head">
                    <div>
                      <div class="template-id">{{ item.templateId }} v{{ item.version }}</div>
                      <div class="template-meta">
                        <span>{{ $t('notification_email_template_app') }}：{{ item.appId || '-' }}</span>
                        <span>{{ item.category || '-' }}</span>
                      </div>
                    </div>
                    <div class="template-item-actions">
                      <el-tag :type="item.enabled ? 'success' : 'info'" effect="light">
                        {{ item.enabled ? $t('notification_email_enabled') : $t('notification_email_disabled') }}
                      </el-tag>
                      <el-button text @click="editEmailTemplate(item)">{{ $t('notification_email_edit_template') }}</el-button>
                    </div>
                  </div>
                  <div class="template-subject">{{ item.subject?.['zh-CN'] || '-' }}</div>
                  <div class="webhook-events">
                    <el-tag v-for="eventName in item.eventTypes" :key="eventName" size="small" effect="plain">
                      {{ eventName }}
                    </el-tag>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <el-dialog
      v-model="deliveryDialogVisible"
      :title="$t('notification_webhook_delivery_history')"
      width="760px"
      destroy-on-close
    >
      <div class="delivery-dialog-head">
        <div class="delivery-dialog-target">{{ selectedWebhookForDeliveries?.targetUrl || '-' }}</div>
        <div class="delivery-dialog-meta">
          <span>{{ $t('notification_webhook_app_id') }}：{{ selectedWebhookForDeliveries?.applicationUid || '-' }}</span>
        </div>
      </div>
      <div v-if="deliveryLoading" class="panel-empty">{{ $t('header_notification_loading') }}</div>
      <div v-else-if="deliveryItems.length === 0" class="panel-empty">{{ $t('notification_webhook_delivery_empty') }}</div>
          <div v-else class="delivery-list">
            <div v-for="item in deliveryItems" :key="item.uid" class="delivery-item">
              <div class="delivery-item-head">
                <div class="delivery-item-tags">
              <el-tag size="small" :type="deliveryStatusType(item.status)">{{ deliveryStatusLabel(item.status) }}</el-tag>
              <el-tag size="small" effect="plain">#{{ item.attemptCount }}</el-tag>
                </div>
                <div class="delivery-item-head-actions">
                  <span class="delivery-item-time">{{ formatFullTime(item.createdAt) }}</span>
                  <el-button text :loading="deliveryActionUid === item.uid" @click="handleRetryDelivery(item)">
                    {{ $t('notification_webhook_retry_now') }}
                  </el-button>
                  <el-button
                    text
                    :loading="deliveryReplayUid === item.uid"
                    @click="handleReplayDelivery(item)"
                  >
                    {{ $t('notification_webhook_replay_now') }}
                  </el-button>
                </div>
              </div>
          <div class="delivery-item-grid">
            <div class="meta-item">
              <span class="meta-label">{{ $t('notification_webhook_delivery_notification') }}</span>
              <span class="meta-value">{{ item.notificationUid }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ $t('notification_webhook_delivery_target') }}</span>
              <span class="meta-value">{{ item.target || '-' }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ $t('notification_webhook_delivery_delivered_at') }}</span>
              <span class="meta-value">{{ formatFullTime(item.deliveredAt) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ $t('notification_webhook_delivery_retry_at') }}</span>
              <span class="meta-value">{{ formatFullTime(item.nextRetryAt) }}</span>
            </div>
          </div>
          <div v-if="item.lastError" class="delivery-error">{{ item.lastError }}</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { useRoute, useRouter } from 'vue-router'
import $notification, { type EmailTemplateItem, type MailSettings, type NotificationDeliveryItem, type NotificationListItem, type NotificationStreamPayload, type NotificationWebhookItem } from '@/plugins/notification'
import { getNotificationLevelLabel, getNotificationSourceLabel, getNotificationTypeLabel, resolveNotificationRoute } from '@/plugins/notificationMeta'
import $application, { type ApplicationMetadata } from '@/plugins/application'
import { getVerifiedAuthProfile } from '@/plugins/auth'
import { notifyError, notifySuccess } from '@/utils/message'

const route = useRoute()
const router = useRouter()
const { proxy } = getCurrentInstance()!
const { $t } = proxy

const items = ref<NotificationListItem[]>([])
const loading = ref(false)
const detailLoading = ref(false)
const unreadCount = ref(0)
const activeView = ref<'inbox' | 'webhook' | 'email'>('inbox')
const selectedUid = ref('')
const selectedItem = ref<NotificationListItem | null>(null)
const ownedApplications = ref<ApplicationMetadata[]>([])
const webhooks = ref<NotificationWebhookItem[]>([])
const webhookLoading = ref(false)
const mailSettings = ref<MailSettings | null>(null)
const mailSettingsLoading = ref(false)
const mailAccessChecked = ref(false)
const mailAccessLoading = ref(false)
const canManageMail = ref(false)
const mailAuthProfile = ref<Awaited<ReturnType<typeof getVerifiedAuthProfile>>>(null)
const mailTestSending = ref(false)
const emailTemplates = ref<EmailTemplateItem[]>([])
const emailTemplatesLoading = ref(false)
const emailTemplateSaving = ref(false)
const editingEmailTemplateId = ref('')
const deliveryDialogVisible = ref(false)
const deliveryLoading = ref(false)
const deliveryItems = ref<NotificationDeliveryItem[]>([])
const selectedWebhookForDeliveries = ref<NotificationWebhookItem | null>(null)
const deliveryActionUid = ref('')
const deliveryReplayUid = ref('')
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
const mailTestForm = reactive({
  to: '',
  subject: '',
})
const emailTemplateForm = reactive({
  templateId: '',
  version: 1,
  appId: '',
  category: 'transactional',
  eventTypesText: '',
  zhSubject: '',
  zhTextBody: '',
  zhHtmlBody: '',
  variablesText: '',
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
])
const emailCategoryOptions = computed(() => [
  { label: String($t('notification_email_category_security')), value: 'security' },
  { label: String($t('notification_email_category_transactional')), value: 'transactional' },
  { label: String($t('notification_email_category_digest')), value: 'digest' },
  { label: String($t('notification_email_category_marketing')), value: 'marketing' },
])

let notificationStream: { close: () => Promise<void> } | null = null
let streamErrorShown = false
let emailDataLoaded = false
let emailDataLoadPromise: Promise<void> | null = null

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

function deliveryStatusLabel(status: string) {
  const normalized = String(status || '').trim()
  switch (normalized) {
    case 'delivered':
      return String($t('notification_level_success'))
    case 'delivering':
      return String($t('notification_webhook_delivery_status_delivering'))
    case 'failed':
      return String($t('notification_level_warning'))
    default:
      return String($t('notification_level_info'))
  }
}

function deliveryStatusType(status: string): 'success' | 'info' | 'warning' | 'danger' | undefined {
  const normalized = String(status || '').trim()
  switch (normalized) {
    case 'delivered':
      return 'success'
    case 'delivering':
      return 'info'
    case 'failed':
      return 'warning'
    default:
      return undefined
  }
}

function yesNo(value: boolean) {
  return value ? String($t('notification_email_yes')) : String($t('notification_email_no'))
}

function parseDelimitedList(value: string) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
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

async function loadMailSettings() {
  mailSettingsLoading.value = true
  try {
    mailSettings.value = await $notification.getMailSettings()
  } catch (error) {
    notifyError(`${$t('notification_email_settings_load_failed')}：${error}`)
  } finally {
    mailSettingsLoading.value = false
  }
}

async function ensureMailAccess() {
  if (mailAccessChecked.value) {
    return
  }
  mailAccessLoading.value = true
  try {
    const profile = await getVerifiedAuthProfile()
    mailAuthProfile.value = profile
    canManageMail.value = Boolean(profile?.isAdmin)
  } catch {
    mailAuthProfile.value = null
    canManageMail.value = false
  } finally {
    mailAccessChecked.value = true
    mailAccessLoading.value = false
  }
}

async function submitMailTest() {
  const to = String(mailTestForm.to || '').trim()
  if (!to) {
    notifyError(String($t('notification_email_test_to_required')))
    return
  }
  mailTestSending.value = true
  try {
    const result = await $notification.sendMailTest({
      to,
      subject: mailTestForm.subject || undefined,
    })
    notifySuccess(`${$t('notification_email_test_success')}：${result.messageId || '-'}`)
  } catch (error) {
    notifyError(`${$t('notification_email_test_failed')}：${error}`)
  } finally {
    mailTestSending.value = false
  }
}

async function loadEmailTemplates() {
  emailTemplatesLoading.value = true
  try {
    const result = await $notification.listEmailTemplates()
    emailTemplates.value = Array.isArray(result.items) ? result.items : []
  } catch (error) {
    notifyError(`${$t('notification_email_templates_load_failed')}：${error}`)
  } finally {
    emailTemplatesLoading.value = false
  }
}

async function loadEmailData(options: { force?: boolean } = {}) {
  await ensureMailAccess()
  if (!canManageMail.value) {
    return
  }
  if (emailDataLoadPromise) {
    await emailDataLoadPromise
    return
  }
  if (emailDataLoaded && !options.force) {
    return
  }
  emailDataLoadPromise = Promise.all([loadMailSettings(), loadEmailTemplates()])
    .then(() => {
      emailDataLoaded = true
    })
    .finally(() => {
      emailDataLoadPromise = null
    })
  await emailDataLoadPromise
}

function resetEmailTemplateForm() {
  editingEmailTemplateId.value = ''
  emailTemplateForm.templateId = ''
  emailTemplateForm.version = 1
  emailTemplateForm.appId = ''
  emailTemplateForm.category = 'transactional'
  emailTemplateForm.eventTypesText = ''
  emailTemplateForm.zhSubject = ''
  emailTemplateForm.zhTextBody = ''
  emailTemplateForm.zhHtmlBody = ''
  emailTemplateForm.variablesText = ''
  emailTemplateForm.enabled = true
}

function editEmailTemplate(item: EmailTemplateItem) {
  editingEmailTemplateId.value = item.templateId
  emailTemplateForm.templateId = item.templateId
  emailTemplateForm.version = Number(item.version || 1)
  emailTemplateForm.appId = item.appId || ''
  emailTemplateForm.category = item.category || 'transactional'
  emailTemplateForm.eventTypesText = (item.eventTypes || []).join('\n')
  emailTemplateForm.zhSubject = item.subject?.['zh-CN'] || ''
  emailTemplateForm.zhTextBody = item.textBody?.['zh-CN'] || ''
  emailTemplateForm.zhHtmlBody = item.htmlBody?.['zh-CN'] || ''
  emailTemplateForm.variablesText = (item.variables || []).join('\n')
  emailTemplateForm.enabled = item.enabled !== false
}

async function submitEmailTemplate() {
  const templateId = String(emailTemplateForm.templateId || '').trim()
  if (!templateId || !emailTemplateForm.zhSubject || !emailTemplateForm.zhTextBody || !emailTemplateForm.zhHtmlBody) {
    notifyError(String($t('notification_email_template_required')))
    return
  }
  emailTemplateSaving.value = true
  try {
    const payload = {
      templateId,
      version: Number(emailTemplateForm.version || 1),
      appId: emailTemplateForm.appId || undefined,
      category: emailTemplateForm.category || 'transactional',
      eventTypes: parseDelimitedList(emailTemplateForm.eventTypesText),
      subject: { 'zh-CN': emailTemplateForm.zhSubject },
      textBody: { 'zh-CN': emailTemplateForm.zhTextBody },
      htmlBody: { 'zh-CN': emailTemplateForm.zhHtmlBody },
      variables: parseDelimitedList(emailTemplateForm.variablesText),
      enabled: emailTemplateForm.enabled,
    }
    const saved = editingEmailTemplateId.value
      ? await $notification.updateEmailTemplate(editingEmailTemplateId.value, payload)
      : await $notification.upsertEmailTemplate(payload)
    const index = emailTemplates.value.findIndex((item) => item.templateId === saved.templateId && Number(item.version) === Number(saved.version))
    if (index >= 0) {
      emailTemplates.value[index] = saved
    } else {
      emailTemplates.value.unshift(saved)
    }
    editingEmailTemplateId.value = saved.templateId
    notifySuccess(String($t('notification_email_template_save_success')))
  } catch (error) {
    notifyError(`${$t('notification_email_template_save_failed')}：${error}`)
  } finally {
    emailTemplateSaving.value = false
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

async function openDeliveryDialog(item: NotificationWebhookItem) {
  selectedWebhookForDeliveries.value = item
  deliveryDialogVisible.value = true
  deliveryLoading.value = true
  deliveryItems.value = []
  try {
    const result = await $notification.listWebhookDeliveries(item.uid, 20)
    deliveryItems.value = Array.isArray(result.items) ? result.items : []
  } catch (error) {
    notifyError(`${$t('notification_webhook_delivery_load_failed')}：${error}`)
  } finally {
    deliveryLoading.value = false
  }
}

async function handleRetryDelivery(item: NotificationDeliveryItem) {
  const webhook = selectedWebhookForDeliveries.value
  if (!webhook) {
    return
  }
  deliveryActionUid.value = item.uid
  try {
    const updated = await $notification.retryWebhookDelivery(webhook.uid, item.uid)
    const index = deliveryItems.value.findIndex((entry) => entry.uid === item.uid)
    if (index >= 0) {
      deliveryItems.value[index] = updated
    }
    await loadWebhooks()
  } catch (error) {
    notifyError(`${$t('notification_webhook_retry_failed')}：${error}`)
  } finally {
    deliveryActionUid.value = ''
  }
}

async function handleReplayDelivery(item: NotificationDeliveryItem) {
  const webhook = selectedWebhookForDeliveries.value
  if (!webhook) {
    return
  }
  deliveryReplayUid.value = item.uid
  try {
    const replayed = await $notification.replayWebhookDelivery(webhook.uid, item.notificationUid)
    deliveryItems.value.unshift(replayed)
    deliveryItems.value = deliveryItems.value.slice(0, 20)
    await loadWebhooks()
  } catch (error) {
    notifyError(`${$t('notification_webhook_replay_failed')}：${error}`)
  } finally {
    deliveryReplayUid.value = ''
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
  () => activeView.value,
  (value) => {
    if (value === 'email') {
      void loadEmailData()
    }
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
    const nextValue = normalized === 'webhook' || normalized === 'email' ? normalized : 'inbox'
    if (nextValue !== activeView.value) {
      activeView.value = nextValue
    }
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    await Promise.all([reloadCurrentPage(), loadOwnedApplications(), loadWebhooks()])
    if (activeView.value === 'email') {
      await loadEmailData()
    }
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
  height: calc(100dvh - 72px);
  min-height: 0;
  padding: 20px;
  background: #f5f7fb;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.filter-bar.compact {
  align-items: center;
  flex-wrap: nowrap;
  margin-top: -4px;
}

.filter-select {
  flex: 0 1 168px;
  min-width: 140px;
}

.application-select {
  flex-basis: 260px;
  min-width: 220px;
}

.read-filter,
.reload-button {
  flex: 0 0 auto;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(340px, 420px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
  flex: 1;
}

.page-view-tabs {
  margin: 16px 0 12px;
}

.list-panel,
.detail-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  min-height: 0;
  overflow: hidden;
}

.list-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
}

.detail-panel {
  padding: 18px;
  overflow-y: auto;
}

.notification-list-scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  flex: 0 0 auto;
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

.email-layout {
  display: grid;
  grid-template-columns: minmax(340px, 420px) minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
}

.email-permission-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 18px;
}

.permission-card {
  max-width: 640px;

  p {
    margin: 0;
    color: #4b5563;
    font-size: 14px;
    line-height: 1.7;
  }
}

.permission-meta {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.permission-meta-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  color: #4b5563;
  font-size: 13px;

  strong {
    color: #111827;
    font-weight: 600;
    word-break: break-all;
    text-align: right;
  }
}

.permission-hint {
  margin-top: 12px !important;
}

.webhook-form-panel,
.webhook-list-panel,
.email-settings-panel,
.email-template-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 18px;
}

.email-template-panel {
  min-width: 0;
}

.panel-heading,
.template-head,
.template-item-head,
.template-form-actions,
.template-item-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mail-status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  .wide {
    grid-column: span 2;
  }
}

.mail-issues {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.email-test-form {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.email-template-grid {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  gap: 16px;
}

.email-template-form {
  display: grid;
  gap: 12px;
  align-content: start;
}

.email-template-list,
.template-items {
  min-width: 0;
}

.template-items {
  display: grid;
  gap: 12px;
}

.template-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  background: #f8fafc;
}

.template-id {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  word-break: break-all;
}

.template-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}

.template-subject {
  margin-top: 12px;
  color: #374151;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.template-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
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

.webhook-action-buttons {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.webhook-time {
  font-size: 12px;
  color: #6b7280;
}

.delivery-dialog-head {
  margin-bottom: 16px;
}

.delivery-dialog-target {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  word-break: break-all;
}

.delivery-dialog-meta {
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
}

.delivery-list {
  display: grid;
  gap: 12px;
}

.delivery-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px;
  background: #f8fafc;
}

.delivery-item-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.delivery-item-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.delivery-item-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.delivery-item-time {
  font-size: 12px;
  color: #6b7280;
}

.delivery-item-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.delivery-error {
  margin-top: 12px;
  padding: 12px;
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

@media (max-width: 1100px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .webhook-layout {
    grid-template-columns: 1fr;
  }

  .email-layout,
  .email-template-grid {
    grid-template-columns: 1fr;
  }

  .list-panel,
  .detail-panel {
    min-height: auto;
    overflow: visible;
  }

  .notification-center {
    height: auto;
    min-height: calc(100dvh - 72px);
    overflow: visible;
  }

  .notification-list-scroll {
    max-height: none;
    overflow: visible;
  }
}

@media (max-width: 768px) {
  .filter-bar.compact {
    flex-wrap: wrap;
  }

  .filter-select,
  .application-select {
    flex: 1 1 100%;
    min-width: 0;
  }

  .read-filter {
    flex: 1 1 auto;
  }

  .meta-grid {
    grid-template-columns: 1fr;
  }

  .delivery-item-grid {
    grid-template-columns: 1fr;
  }
}
</style>
