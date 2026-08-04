<template>
  <div class="passport-auth-page">
    <div class="passport-auth-card">
      <h1>{{ t('passport_auth_title') }}</h1>
      <p class="subtitle">{{ t('passport_auth_subtitle') }}</p>

      <div class="meta-row">
        <span class="app-name">{{ requestAppName }}</span>
        <span class="status-chip" :class="requestStatusClass">{{ requestStatusText }}</span>
      </div>

      <p v-if="requestSubjectHint" class="subject-hint">{{ t('passport_auth_subject') }}{{ requestSubjectHint }}</p>

      <div v-if="requestExpired" class="expired-panel">
        <p class="expired-title">{{ t('passport_auth_expired_title') }}</p>
        <p class="expired-desc">{{ t('passport_auth_expired_desc') }}</p>
        <div class="expired-actions">
          <el-button type="primary" :disabled="!hasReturnTarget" @click="goBackToApp(false)">
            {{ t('passport_auth_back_app') }}
          </el-button>
          <el-button :disabled="!hasReturnTarget" @click="goBackToApp(true)">
            {{ t('passport_auth_retry') }}
          </el-button>
        </div>
      </div>

      <template v-else>
        <div class="passport-timer">
          {{ t('passport_auth_remaining') }}
          <strong>{{ requestCountdownText }}</strong>
        </div>

        <div class="passkey-panel">
          <div class="passkey-icon">P</div>
          <div>
            <p class="passkey-title">{{ t('passport_auth_passkey_title') }}</p>
            <p class="passkey-desc">{{ t('passport_auth_passkey_desc') }}</p>
          </div>
        </div>

        <p class="hint" :class="`hint-${hintType}`">{{ hintMessage }}</p>

        <el-button
          class="confirm-btn"
          type="primary"
          :loading="approving"
          :disabled="!canApprove"
          @click="approveWithPasskey"
        >
          {{ t('passport_auth_confirm') }}
        </el-button>

        <p v-if="redirecting" class="redirect-tip">
          {{ t('passport_auth_redirecting', { count: redirectCountdown }) }}
        </p>
      </template>

      <p v-if="loadingRequest" class="loading-tip">{{ t('passport_auth_loading') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiUrl } from '@/plugins/api'
import { translate } from '@/lang/messages'
import { notifyInfo } from '@/utils/message'
import { isWebAuthnAvailable, startAuthentication } from '@/utils/webauthn'

type Envelope<T> = {
  code: number
  message: string
  data: T
  timestamp: number
}

type PassportAuthorizeRequestInfo = {
  requestId: string
  status: string
  appId: string
  appName: string
  redirectUri: string
  state?: string
  codeChallengeMethod: string
  createdAt: string
  expiresAt: string
  verifyUrl: string
  subjectId?: string
  subjectHint?: string
}

type PassportChallengeResult = {
  authorizeRequest: PassportAuthorizeRequestInfo
  passkeyRequest: Record<string, any> & {
    requestId: string
  }
}

type PassportApproveResult = {
  requestId: string
  subjectId: string
  walletAddress: string
  authorizationCode: string
  authorizationCodeExpiresAt: string
  redirectTo: string
}

const route = useRoute()
const requestId = ref('')
const requestInfo = ref<PassportAuthorizeRequestInfo | null>(null)
const loadingRequest = ref(false)
const approving = ref(false)
const hintType = ref<'info' | 'error' | 'success'>('info')
const hintMessage = ref(translate('passport_auth_ready'))
const nowMs = ref(Date.now())
const redirectCountdown = ref(0)

let redirectTimer: number | null = null
let countdownTimer: number | null = null
let clockTimer: number | null = null

function t(key: string, params?: Record<string, unknown>) {
  return translate(key, params)
}

function setHint(type: 'info' | 'error' | 'success', message: string) {
  hintType.value = type
  hintMessage.value = message
}

function resolveRequestId(raw: unknown): string {
  if (Array.isArray(raw)) {
    return String(raw[0] || '').trim()
  }
  return String(raw || '').trim()
}

async function parseEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text()
  let payload: Envelope<T> | null = null
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>
    } catch {
      throw new Error(text || fallbackMessage)
    }
  }
  if (!response.ok) {
    throw new Error(payload?.message || `${fallbackMessage}: ${response.status}`)
  }
  if (!payload || payload.code !== 0) {
    throw new Error(payload?.message || fallbackMessage)
  }
  return payload.data
}

async function loadRequestInfo() {
  if (!requestId.value) {
    setHint('error', t('passport_auth_invalid'))
    return
  }
  loadingRequest.value = true
  try {
    const response = await fetch(
      apiUrl(`/api/v1/public/auth/passport/authorize/request/${encodeURIComponent(requestId.value)}`),
      {
        method: 'GET',
        credentials: 'include',
      }
    )
    requestInfo.value = await parseEnvelope<PassportAuthorizeRequestInfo>(
      response,
      t('passport_auth_query_failed')
    )
    setHint(requestInfo.value.status === 'pending' ? 'info' : 'error', requestInfo.value.status === 'pending' ? t('passport_auth_ready') : t('passport_auth_expired_hint'))
  } catch (error) {
    const hint = normalizeErrorMessage(error, t('passport_auth_read_failed'))
    setHint('error', hint)
    notifyInfo(hint)
  } finally {
    loadingRequest.value = false
  }
}

function clearRedirectTimers() {
  if (redirectTimer !== null) {
    window.clearTimeout(redirectTimer)
    redirectTimer = null
  }
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer)
    countdownTimer = null
  }
  redirectCountdown.value = 0
}

function startRedirect(redirectTo: string) {
  if (!redirectTo) return
  clearRedirectTimers()
  redirectCountdown.value = 2
  countdownTimer = window.setInterval(() => {
    if (redirectCountdown.value <= 1) {
      if (countdownTimer !== null) {
        window.clearInterval(countdownTimer)
        countdownTimer = null
      }
      redirectCountdown.value = 0
      return
    }
    redirectCountdown.value -= 1
  }, 1000)
  redirectTimer = window.setTimeout(() => {
    window.location.href = redirectTo
  }, 2000)
}

function buildRedirectUrl(baseUrl: string, params: Record<string, string>) {
  try {
    const url = new URL(baseUrl)
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value)
    })
    return url.toString()
  } catch {
    const query = Object.entries(params)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')
    return query ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}` : baseUrl
  }
}

function resolveExpiredRedirectTarget(retry: boolean) {
  const baseUrl = String(requestInfo.value?.redirectUri || '').trim()
  if (!baseUrl) return ''
  const state = String(requestInfo.value?.state || '').trim()
  const params: Record<string, string> = {
    error: 'access_denied',
    error_code: 'request_expired',
    error_description: 'request expired',
  }
  if (state) params.state = state
  if (retry) params.retry = '1'
  return buildRedirectUrl(baseUrl, params)
}

function goBackToApp(retry: boolean) {
  const target = resolveExpiredRedirectTarget(retry)
  if (!target) {
    notifyInfo(t('passport_auth_missing_return'))
    return
  }
  window.location.href = target
}

function normalizeErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || '')
  const message = raw.replace(/^Error:\s*/i, '').trim()
  return message || fallback
}

function resolveApproveHint(error: unknown): string {
  const message = normalizeErrorMessage(error, t('passport_auth_failed'))
  const normalized = message.toLowerCase()
  if (message === 'WEBAUTHN_UNAVAILABLE') return t('passport_auth_webauthn_unavailable')
  if (normalized.includes('notallowed') || normalized.includes('user') || normalized.includes('cancel')) {
    return t('passport_auth_user_cancelled')
  }
  if (normalized.includes('expired')) return t('passport_auth_request_expired')
  if (normalized.includes('used') || normalized.includes('not pending')) return t('passport_auth_request_used')
  if (normalized.includes('not found')) return t('passport_auth_request_not_found')
  return message
}

async function approveWithPasskey() {
  if (!canApprove.value || !requestInfo.value) return
  if (!isWebAuthnAvailable()) {
    setHint('error', t('passport_auth_webauthn_unavailable'))
    return
  }

  approving.value = true
  try {
    const challengeResponse = await fetch(apiUrl('/api/v1/public/auth/passport/authorize/challenge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ requestId: requestId.value }),
    })
    const challenge = await parseEnvelope<PassportChallengeResult>(
      challengeResponse,
      t('passport_auth_challenge_failed')
    )
    const credential = await startAuthentication(challenge.passkeyRequest)
    const approveResponse = await fetch(apiUrl('/api/v1/public/auth/passport/authorize/approve'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        requestId: requestId.value,
        passkeyRequestId: challenge.passkeyRequest.requestId,
        credential,
      }),
    })
    const approved = await parseEnvelope<PassportApproveResult>(approveResponse, t('passport_auth_failed'))
    setHint('success', t('passport_auth_success_redirect'))
    startRedirect(approved.redirectTo)
  } catch (error) {
    const hint = resolveApproveHint(error)
    setHint('error', hint)
    notifyInfo(hint)
    await loadRequestInfo()
  } finally {
    approving.value = false
  }
}

function startClockTimer() {
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
  }
  nowMs.value = Date.now()
  clockTimer = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
}

const requestExpiresMs = computed(() => {
  const raw = String(requestInfo.value?.expiresAt || '').trim()
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
})

const requestRemainingSec = computed(() => {
  if (!requestExpiresMs.value) return null
  return Math.max(0, Math.floor((requestExpiresMs.value - nowMs.value) / 1000))
})

const requestExpired = computed(() => {
  if (requestInfo.value?.status === 'expired') return true
  const remain = requestRemainingSec.value
  return remain !== null && remain <= 0
})

const hasReturnTarget = computed(() => String(requestInfo.value?.redirectUri || '').trim().length > 0)
const redirecting = computed(() => redirectCountdown.value > 0)

const canApprove = computed(() => {
  return Boolean(
    requestInfo.value?.status === 'pending' &&
      !requestExpired.value &&
      !approving.value &&
      !redirecting.value
  )
})

const requestCountdownText = computed(() => {
  const remain = requestRemainingSec.value
  if (remain === null) return '-'
  const minute = Math.floor(remain / 60)
  const second = remain % 60
  if (minute > 0) {
    return t('passport_auth_minute_second', { minute, second: String(second).padStart(2, '0') })
  }
  return t('passport_auth_second', { second })
})

const requestAppName = computed(() => {
  const name = String(requestInfo.value?.appName || '').trim()
  return name || t('passport_auth_app_fallback')
})

const requestSubjectHint = computed(() => String(requestInfo.value?.subjectHint || '').trim())

const requestStatusText = computed(() => {
  if (requestExpired.value) return t('passport_auth_status_expired')
  const status = requestInfo.value?.status || ''
  if (status === 'pending') return t('passport_auth_status_pending')
  if (status === 'approved') return t('passport_auth_status_used')
  if (status === 'expired') return t('passport_auth_status_expired')
  if (!status) return loadingRequest.value ? t('passport_auth_status_loading') : t('passport_auth_status_invalid')
  return status
})

const requestStatusClass = computed(() => {
  if (requestExpired.value) return 'status-expired'
  const status = String(requestInfo.value?.status || '').trim()
  return status ? `status-${status}` : 'status-unknown'
})

watch(
  () => route.query.requestId,
  async (value) => {
    requestId.value = resolveRequestId(value)
    requestInfo.value = null
    clearRedirectTimers()
    setHint('info', t('passport_auth_ready'))
    await loadRequestInfo()
  }
)

onMounted(async () => {
  startClockTimer()
  requestId.value = resolveRequestId(route.query.requestId)
  await loadRequestInfo()
})

onBeforeUnmount(() => {
  clearRedirectTimers()
  if (clockTimer !== null) {
    window.clearInterval(clockTimer)
  }
})
</script>

<style scoped lang="less">
.passport-auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #f8fafc 0%, #eef3f9 100%);
  padding: 24px;
}

.passport-auth-card {
  width: 100%;
  max-width: 460px;
  background: #fff;
  border-radius: 16px;
  border: 1px solid #e6ecf5;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 600;
  color: #0f172a;
}

.subtitle {
  margin: 0;
  color: #5b6475;
  font-size: 14px;
  line-height: 1.5;
}

.meta-row {
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.app-name {
  font-size: 16px;
  font-weight: 500;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
}

.status-pending {
  color: #8a5500;
  background: #fff7e8;
  border-color: #ffd591;
}

.status-approved {
  color: #03693f;
  background: #f0fdf4;
  border-color: #86efac;
}

.status-expired,
.status-unknown {
  color: #5b6475;
  background: #f2f4f8;
  border-color: #d8dce6;
}

.subject-hint {
  margin: 0;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.4;
}

.passport-timer {
  margin-top: 4px;
  align-self: flex-start;
  border-radius: 10px;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 500;
}

.passport-timer strong {
  font-size: 16px;
  margin: 0 4px;
}

.passkey-panel {
  display: flex;
  gap: 12px;
  align-items: center;
  border: 1px solid #dbeafe;
  background: #f8fbff;
  border-radius: 12px;
  padding: 12px;
}

.passkey-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2563eb;
  color: #fff;
  font-size: 12px;
}

.passkey-title {
  margin: 0;
  color: #0f172a;
  font-weight: 600;
  font-size: 14px;
}

.passkey-desc {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.expired-panel {
  margin-top: 4px;
  border: 1px solid #fde68a;
  background: #fffbeb;
  border-radius: 12px;
  padding: 12px;
}

.expired-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #92400e;
}

.expired-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: #a16207;
}

.expired-actions {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hint {
  margin: 0;
  min-height: 20px;
  font-size: 13px;
  line-height: 1.5;
}

.hint-info {
  color: #64748b;
}

.hint-error {
  color: #dc2626;
}

.hint-success {
  color: #047857;
}

.confirm-btn {
  margin-top: 2px;
  width: 100%;
  height: 42px;
  border-radius: 10px;
}

.redirect-tip,
.loading-tip {
  margin: 0;
  font-size: 13px;
  color: #64748b;
}

.redirect-tip {
  color: #047857;
}

@media (max-width: 768px) {
  .passport-auth-page {
    padding: 12px 10px;
  }

  .passport-auth-card {
    padding: 20px 16px;
    border-radius: 14px;
  }
}
</style>
