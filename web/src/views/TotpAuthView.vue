<template>
  <div class="totp-auth-page">
    <div class="totp-auth-card">
      <h1>授权验证</h1>
      <p class="subtitle">输入 6 位验证码完成授权。</p>

      <div class="meta-row">
        <span class="app-name">{{ requestAppName }}</span>
        <span class="status-chip" :class="requestStatusClass">
          {{ requestStatusText }}
        </span>
      </div>

      <p v-if="requestSubjectHint" class="subject-hint">地址：{{ requestSubjectHint }}</p>

      <div v-if="requestExpired" class="expired-panel">
        <p class="expired-title">授权已过期</p>
        <p class="expired-desc">请返回应用重新发起授权。</p>
        <div class="expired-actions">
          <el-button type="primary" :disabled="!hasReturnTarget" @click="goBackToApp(false)">
            返回应用
          </el-button>
          <el-button :disabled="!hasReturnTarget" @click="goBackToApp(true)">重新发起</el-button>
        </div>
      </div>

      <template v-else>
        <div class="totp-timer">
          本次授权剩余
          <strong>{{ requestCountdownText }}</strong>
        </div>

        <div class="digit-group">
          <input
            v-for="(_, index) in digitValues"
            :key="`totp-digit-${index}`"
            :ref="(el) => setDigitRef(el as HTMLInputElement | null, index)"
            class="digit-input"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="1"
            autocomplete="one-time-code"
            :value="digitValues[index]"
            :disabled="inputDisabled"
            @input="onDigitInput($event, index)"
            @keydown="onDigitKeydown($event, index)"
          />
        </div>

        <p class="hint" :class="`hint-${hintType}`">{{ hintMessage }}</p>

        <el-button
          class="confirm-btn"
          type="primary"
          :loading="approving"
          :disabled="!canApprove"
          @click="approveRequest({ auto: false })"
        >
          确认
        </el-button>

        <p v-if="redirecting" class="redirect-tip">
          验证成功，{{ redirectCountdown }} 秒后返回应用…
        </p>
      </template>

      <p v-if="loadingRequest" class="loading-tip">加载请求中…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiUrl } from '@/plugins/api';
import { notifyInfo } from '@/utils/message';

type Envelope<T> = {
  code: number;
  message: string;
  data: T;
  timestamp: number;
};

type UcanCapability = {
  with?: string;
  can?: string;
};

type BindRequestInfo = {
  requestId: string;
  status: string;
  subjectHint: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  redirectUri?: string;
  createdAt: number;
  expiresAt: number;
  verifyUrl: string;
};

type AuthorizeRequestInfo = {
  requestId: string;
  status: string;
  subjectHint: string;
  appId: string;
  redirectUri: string;
  state?: string;
  audience: string;
  capabilities: UcanCapability[];
  appName: string;
  createdAt: number;
  expiresAt: number;
  verifyUrl: string;
};

type BindApproveResult = {
  requestId: string;
  approvedAt: number;
  subject: string;
  appName: string;
  redirectUri?: string;
};

type AuthorizeApproveResult = {
  requestId: string;
  appName: string;
  approvedAt: number;
  authorizationCode: string;
  authorizationCodeExpiresAt: number;
  redirectTo: string;
};

type RequestInfo = AuthorizeRequestInfo | BindRequestInfo;

type ApproveResultView = {
  mode: 'authorize' | 'bind';
  redirectTo: string;
};

const route = useRoute();
const DIGIT_COUNT = 6;
const AUTO_VERIFY_HINT = '输入 6 位后自动验证';
const REQUEST_INVALID_HINT = '请求无效，请返回应用重试';
const REQUEST_EXPIRED_HINT = '请求已失效，请返回应用重试';
const REQUEST_READ_FAILED_HINT = '请求读取失败，请返回应用重试';

const requestId = ref('');
const requestMode = ref<'authorize' | 'bind' | ''>('');
const requestInfo = ref<RequestInfo | null>(null);
const approveResult = ref<ApproveResultView | null>(null);
const loadingRequest = ref(false);
const approving = ref(false);
const redirectCountdown = ref(0);
const digitValues = ref<string[]>(Array.from({ length: DIGIT_COUNT }, () => ''));
const digitRefs = ref<Array<HTMLInputElement | null>>(
  Array.from({ length: DIGIT_COUNT }, () => null)
);
const lastSubmittedCode = ref('');
const hintMessage = ref(AUTO_VERIFY_HINT);
const hintType = ref<'info' | 'error' | 'success'>('info');
const nowSec = ref(Math.floor(Date.now() / 1000));

let redirectTimer: number | null = null;
let countdownTimer: number | null = null;
let clockTimer: number | null = null;

function clearRedirectTimers() {
  if (redirectTimer !== null) {
    window.clearTimeout(redirectTimer);
    redirectTimer = null;
  }
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
  redirectCountdown.value = 0;
}

function clearClockTimer() {
  if (clockTimer !== null) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
}

function updateNowTick() {
  nowSec.value = Math.floor(Date.now() / 1000);
}

function startClockTimer() {
  clearClockTimer();
  updateNowTick();
  clockTimer = window.setInterval(() => {
    updateNowTick();
  }, 1000);
}

function setHint(type: 'info' | 'error' | 'success', message: string) {
  hintType.value = type;
  hintMessage.value = message;
}

function resolveRequestId(raw: unknown): string {
  if (Array.isArray(raw)) {
    return String(raw[0] || '').trim();
  }
  return String(raw || '').trim();
}

async function parseEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let payload: Envelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new Error(text || fallbackMessage);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.message || `${fallbackMessage}: ${response.status}`);
  }
  if (!payload || payload.code !== 0) {
    throw new Error(payload?.message || fallbackMessage);
  }
  return payload.data;
}

async function loadRequestInfo() {
  if (!requestId.value) {
    setHint('error', REQUEST_INVALID_HINT);
    return;
  }
  loadingRequest.value = true;
  try {
    const authorizeResponse = await fetch(
      apiUrl(`/api/v1/public/auth/totp/authorize/request/${encodeURIComponent(requestId.value)}`),
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    if (authorizeResponse.status !== 404) {
      requestInfo.value = await parseEnvelope<AuthorizeRequestInfo>(
        authorizeResponse,
        '查询授权请求失败'
      );
      requestMode.value = 'authorize';
      if (requestInfo.value.status === 'pending') {
        setHint('info', AUTO_VERIFY_HINT);
      } else {
        setHint('error', REQUEST_EXPIRED_HINT);
      }
      return;
    }

    const bindResponse = await fetch(
      apiUrl(`/api/v1/public/auth/totp/bind/request/${encodeURIComponent(requestId.value)}`),
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    requestInfo.value = await parseEnvelope<BindRequestInfo>(bindResponse, '查询绑定请求失败');
    requestMode.value = 'bind';
    if (requestInfo.value.status === 'pending') {
      setHint('info', AUTO_VERIFY_HINT);
    } else {
      setHint('error', REQUEST_EXPIRED_HINT);
    }
  } catch (error) {
    setHint('error', REQUEST_READ_FAILED_HINT);
    notifyInfo('请求读取失败，请重试');
  } finally {
    loadingRequest.value = false;
  }
}

function startRedirect(redirectTo: string) {
  if (!redirectTo) return;
  clearRedirectTimers();
  redirectCountdown.value = 2;
  countdownTimer = window.setInterval(() => {
    if (redirectCountdown.value <= 1) {
      if (countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
      redirectCountdown.value = 0;
      return;
    }
    redirectCountdown.value -= 1;
  }, 1000);
  redirectTimer = window.setTimeout(() => {
    window.location.href = redirectTo;
  }, 2000);
}

function resolveRequestRedirectUri(): string {
  const info = requestInfo.value;
  if (!info) return '';
  if (requestMode.value === 'authorize') {
    return String((info as AuthorizeRequestInfo).redirectUri || '').trim();
  }
  return String((info as BindRequestInfo).redirectUri || '').trim();
}

function buildRedirectUrl(baseUrl: string, params: Record<string, string>) {
  try {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      }
    });
    return url.toString();
  } catch {
    const query = Object.entries(params)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    if (!query) {
      return baseUrl;
    }
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}`;
  }
}

function resolveExpiredRedirectTarget(retry: boolean) {
  const baseUrl = resolveRequestRedirectUri();
  if (!baseUrl) return '';
  const state =
    requestMode.value === 'authorize'
      ? String((requestInfo.value as AuthorizeRequestInfo | null)?.state || '').trim()
      : '';
  const params: Record<string, string> = {
    error: 'access_denied',
    error_code: 'request_expired',
    error_description: 'request expired',
  };
  if (state) {
    params.state = state;
  }
  if (retry) {
    params.retry = '1';
  }
  return buildRedirectUrl(baseUrl, params);
}

function goBackToApp(retry: boolean) {
  const target = resolveExpiredRedirectTarget(retry);
  if (!target) {
    notifyInfo('缺少返回地址，请回到应用重试');
    return;
  }
  window.location.href = target;
}

function setDigitRef(el: HTMLInputElement | null, index: number) {
  digitRefs.value[index] = el;
}

function focusDigit(index: number) {
  const target = digitRefs.value[index];
  if (!target) return;
  target.focus();
  target.select();
}

function focusFirstDigit() {
  focusDigit(0);
}

function clearDigits(focus = false) {
  digitValues.value = Array.from({ length: DIGIT_COUNT }, () => '');
  if (focus) {
    window.setTimeout(() => {
      focusFirstDigit();
    }, 0);
  }
}

function sanitizeDigits(raw: string): string {
  return String(raw || '').replace(/[^0-9]/g, '');
}

function onDigitInput(event: Event, index: number) {
  if (inputDisabled.value) return;
  const target = event.target as HTMLInputElement;
  const normalized = sanitizeDigits(target.value);
  if (hintType.value === 'error') {
    setHint('info', AUTO_VERIFY_HINT);
  }
  if (!normalized) {
    digitValues.value[index] = '';
    return;
  }
  if (normalized.length === 1) {
    digitValues.value[index] = normalized;
    if (index < DIGIT_COUNT - 1) {
      focusDigit(index + 1);
    }
    return;
  }

  let cursor = index;
  for (const item of normalized) {
    if (cursor >= DIGIT_COUNT) break;
    digitValues.value[cursor] = item;
    cursor += 1;
  }
  if (cursor < DIGIT_COUNT) {
    focusDigit(cursor);
  } else {
    focusDigit(DIGIT_COUNT - 1);
  }
}

function onDigitKeydown(event: KeyboardEvent, index: number) {
  if (inputDisabled.value) return;
  if (event.key === 'Backspace') {
    if (digitValues.value[index]) {
      digitValues.value[index] = '';
      return;
    }
    if (index > 0) {
      event.preventDefault();
      digitValues.value[index - 1] = '';
      focusDigit(index - 1);
    }
    return;
  }
  if (event.key === 'ArrowLeft' && index > 0) {
    event.preventDefault();
    focusDigit(index - 1);
    return;
  }
  if (event.key === 'ArrowRight' && index < DIGIT_COUNT - 1) {
    event.preventDefault();
    focusDigit(index + 1);
  }
}

function normalizeErrorMessage(error: unknown): string {
  const raw = String(error || '').replace(/^Error:\s*/i, '').trim();
  if (!raw) return '验证失败，请稍后重试';
  return raw;
}

function resolveApproveHint(error: unknown): string {
  const message = normalizeErrorMessage(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('code') &&
    (normalized.includes('invalid') || normalized.includes('mismatch') || normalized.includes('wrong'))
  ) {
    return '验证码错误';
  }
  if (normalized.includes('expired')) {
    return '请求已过期，请返回应用重试';
  }
  if (normalized.includes('used') || normalized.includes('processed')) {
    return '请求已处理，请返回应用查看';
  }
  if (normalized.includes('request') && normalized.includes('not found')) {
    return '请求不存在，请返回应用重试';
  }
  return message;
}

async function approveRequest(options: { auto: boolean }) {
  if (!requestId.value) {
    setHint('error', REQUEST_INVALID_HINT);
    return;
  }
  if (!requestMode.value) {
    setHint('error', '流程无效，请返回应用重试');
    return;
  }
  if (requestExpired.value) {
    setHint('error', REQUEST_EXPIRED_HINT);
    return;
  }
  if (requestInfo.value?.status !== 'pending') {
    setHint('error', REQUEST_EXPIRED_HINT);
    return;
  }
  const code = totpCode.value;
  if (code.length !== DIGIT_COUNT) {
    if (!options.auto) {
      notifyInfo('请输入 6 位验证码');
    }
    return;
  }
  if (options.auto && lastSubmittedCode.value === code) {
    return;
  }

  approving.value = true;
  lastSubmittedCode.value = code;
  try {
    if (requestMode.value === 'bind') {
      const response = await fetch(apiUrl('/api/v1/public/auth/totp/bind/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          requestId: requestId.value,
          code,
        }),
      });
      const result = await parseEnvelope<BindApproveResult>(response, '授权失败');
      approveResult.value = {
        mode: 'bind',
        redirectTo: result.redirectUri || '',
      };
      if (result.redirectUri) {
        setHint('success', '验证成功，正在返回…');
        startRedirect(result.redirectUri);
      } else {
        setHint('success', '验证成功，请返回应用继续');
      }
    } else {
      const response = await fetch(apiUrl('/api/v1/public/auth/totp/authorize/approve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          requestId: requestId.value,
          code,
        }),
      });
      const result = await parseEnvelope<AuthorizeApproveResult>(response, '授权失败');
      approveResult.value = {
        mode: 'authorize',
        redirectTo: result.redirectTo,
      };
      setHint('success', '验证成功，正在返回…');
      startRedirect(result.redirectTo);
    }
  } catch (error) {
    const hint = resolveApproveHint(error);
    setHint('error', hint);
    notifyInfo(hint);
    approveResult.value = null;
    lastSubmittedCode.value = '';
    clearDigits(true);
    await loadRequestInfo();
  } finally {
    approving.value = false;
  }
}

const totpCode = computed(() => digitValues.value.join(''));

const requestExpiresSec = computed(() => {
  const raw = Number(requestInfo.value?.expiresAt || 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return Math.floor(raw / 1000);
});

const requestRemainingSec = computed(() => {
  const expiresSec = requestExpiresSec.value;
  if (expiresSec === null) {
    return null;
  }
  return Math.max(0, expiresSec - nowSec.value);
});

const canApprove = computed(() => {
  return (
    requestInfo.value?.status === 'pending' &&
    !requestExpired.value &&
    totpCode.value.length === DIGIT_COUNT &&
    !approving.value &&
    !redirecting.value
  );
});

const redirecting = computed(() => redirectCountdown.value > 0);

const inputDisabled = computed(() => {
  return approving.value || redirecting.value || requestInfo.value?.status !== 'pending' || requestExpired.value;
});

const requestExpired = computed(() => {
  if (requestInfo.value?.status === 'expired') {
    return true;
  }
  const remain = requestRemainingSec.value;
  if (remain === null) {
    return false;
  }
  return remain <= 0;
});

const hasReturnTarget = computed(() => {
  return resolveRequestRedirectUri().length > 0;
});

const requestCountdownText = computed(() => {
  const remain = requestRemainingSec.value;
  if (remain === null) {
    return '-';
  }
  const minute = Math.floor(remain / 60);
  const second = remain % 60;
  if (minute > 0) {
    return `${minute}分${String(second).padStart(2, '0')}秒`;
  }
  return `${second}秒`;
});

const requestAppName = computed(() => {
  const name = String(requestInfo.value?.appName || '').trim();
  return name || '应用';
});

const requestSubjectHint = computed(() => {
  const text = String(requestInfo.value?.subjectHint || '').trim();
  return text || '';
});

const requestStatusText = computed(() => {
  if (requestExpired.value) return '已过期';
  const status = requestInfo.value?.status || '';
  if (status === 'pending') return '待处理';
  if (status === 'used') return '已处理';
  if (status === 'expired') return '已过期';
  if (status === 'revoked') return '已撤销';
  if (!status) return loadingRequest.value ? '加载中' : '无效请求';
  return status;
});

const requestStatusClass = computed(() => {
  if (requestExpired.value) return 'status-expired';
  const status = String(requestInfo.value?.status || '').trim();
  return status ? `status-${status}` : 'status-unknown';
});

watch(
  () => route.query.requestId,
  async (value) => {
    requestId.value = resolveRequestId(value);
    requestMode.value = '';
    requestInfo.value = null;
    approveResult.value = null;
    lastSubmittedCode.value = '';
    clearDigits(false);
    clearRedirectTimers();
    setHint('info', AUTO_VERIFY_HINT);
    await loadRequestInfo();
    if (!requestExpired.value) {
      focusFirstDigit();
    }
  }
);

watch(
  () => totpCode.value,
  (value, oldValue) => {
    if (
      value.length === DIGIT_COUNT &&
      requestInfo.value?.status === 'pending' &&
      !requestExpired.value &&
      !approving.value &&
      !redirecting.value
    ) {
      approveRequest({ auto: true }).catch(() => {});
      return;
    }
    if (oldValue !== value && hintType.value === 'error' && value.length > 0) {
      setHint('info', AUTO_VERIFY_HINT);
    }
  }
);

onMounted(async () => {
  startClockTimer();
  requestId.value = resolveRequestId(route.query.requestId);
  await loadRequestInfo();
  if (!requestExpired.value) {
    focusFirstDigit();
  }
});

onBeforeUnmount(() => {
  clearRedirectTimers();
  clearClockTimer();
});
</script>

<style scoped lang="less">
.totp-auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1200px 500px at -10% -10%, #f6fbff 0%, transparent 60%),
    radial-gradient(1000px 450px at 110% 0%, #f4f7ff 0%, transparent 60%),
    linear-gradient(180deg, #f7f9fc 0%, #eef3f9 100%);
  padding: 24px;
}

.totp-auth-card {
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

.status-used {
  color: #03693f;
  background: #f0fdf4;
  border-color: #86efac;
}

.status-expired,
.status-revoked,
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

.totp-timer {
  margin-top: 4px;
  align-self: flex-start;
  border-radius: 10px;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 500;
}

.totp-timer strong {
  font-size: 16px;
  margin: 0 4px;
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

.digit-group {
  margin-top: 4px;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.digit-input {
  height: 52px;
  border-radius: 12px;
  border: 1px solid #d5dbe7;
  background: #fff;
  text-align: center;
  font-size: 24px;
  font-weight: 600;
  color: #0f172a;
  transition: all 0.2s ease;
}

.digit-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
}

.digit-input:disabled {
  background: #f8fafc;
  color: #94a3b8;
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

.redirect-tip {
  margin: 0;
  font-size: 13px;
  color: #047857;
}

.loading-tip {
  margin: 0;
  font-size: 13px;
  color: #64748b;
}

@media (max-width: 768px) {
  .totp-auth-page {
    padding: 12px 10px;
  }

  .totp-auth-card {
    padding: 20px 16px;
    border-radius: 14px;
  }

  .digit-group {
    gap: 8px;
  }

  .digit-input {
    height: 48px;
    font-size: 22px;
  }
}
</style>
