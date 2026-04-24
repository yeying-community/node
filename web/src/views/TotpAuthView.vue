<template>
  <div class="totp-auth-page">
    <div class="totp-auth-card">
      <h1>授权确认</h1>
      <p class="subtitle">请输入认证器中的 6 位验证码，完成本次授权。</p>

      <div class="meta-row">
        <span class="app-name">{{ requestAppName }}</span>
        <span class="status-chip" :class="`status-${requestInfo?.status || 'unknown'}`">
          {{ requestStatusText }}
        </span>
      </div>

      <p v-if="requestSubjectHint" class="subject-hint">地址：{{ requestSubjectHint }}</p>
      <p v-if="requestExpireText" class="expire-text">{{ requestExpireText }}</p>

      <div class="totp-timer">
        验证码剩余
        <strong>{{ totpCountdown }}</strong>
        秒
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
        确认授权
      </el-button>

      <p v-if="redirecting" class="redirect-tip">
        验证成功，{{ redirectCountdown }} 秒后自动返回应用…
      </p>

      <p v-if="loadingRequest" class="loading-tip">正在加载授权请求…</p>
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

type TotpStatus = {
  codePeriodSec?: number;
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
const DEFAULT_TOTP_PERIOD_SEC = 30;

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
const hintMessage = ref('输满 6 位验证码后会自动验证');
const hintType = ref<'info' | 'error' | 'success'>('info');
const totpPeriodSec = ref(DEFAULT_TOTP_PERIOD_SEC);
const totpCountdown = ref(DEFAULT_TOTP_PERIOD_SEC);
const nowSec = ref(Math.floor(Date.now() / 1000));

let redirectTimer: number | null = null;
let countdownTimer: number | null = null;
let totpTimer: number | null = null;

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

function clearTotpTimer() {
  if (totpTimer !== null) {
    window.clearInterval(totpTimer);
    totpTimer = null;
  }
}

function updateTimeTick() {
  nowSec.value = Math.floor(Date.now() / 1000);
  const period = Math.max(1, Number(totpPeriodSec.value || DEFAULT_TOTP_PERIOD_SEC));
  let remain = period - (nowSec.value % period);
  if (remain <= 0) {
    remain = period;
  }
  totpCountdown.value = remain;
}

function startTotpTimer() {
  clearTotpTimer();
  updateTimeTick();
  totpTimer = window.setInterval(() => {
    updateTimeTick();
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

async function loadTotpStatus() {
  try {
    const response = await fetch(apiUrl('/api/v1/public/auth/totp/status'), {
      method: 'GET',
      credentials: 'include',
    });
    const status = await parseEnvelope<TotpStatus>(response, '读取 TOTP 状态失败');
    const period = Number(status?.codePeriodSec || 0);
    if (Number.isFinite(period) && period > 0) {
      totpPeriodSec.value = Math.trunc(period);
      updateTimeTick();
    }
  } catch {
    // ignore status fetch errors and keep default 30s period
  }
}

async function loadRequestInfo() {
  if (!requestId.value) {
    setHint('error', '授权请求无效，请返回应用重新发起。');
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
        setHint('info', '输满 6 位验证码后会自动验证');
      } else {
        setHint('error', '该授权请求已失效，请返回应用重新发起。');
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
      setHint('info', '输满 6 位验证码后会自动验证');
    } else {
      setHint('error', '该授权请求已失效，请返回应用重新发起。');
    }
  } catch (error) {
    setHint('error', '授权请求读取失败，请返回应用重新发起。');
    notifyInfo('授权请求读取失败，请重试');
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
    setHint('info', '输满 6 位验证码后会自动验证');
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
    return '验证码错误，请重试';
  }
  if (normalized.includes('expired')) {
    return '请求已过期，请返回应用重新发起';
  }
  if (normalized.includes('used') || normalized.includes('processed')) {
    return '请求已处理，请返回应用查看结果';
  }
  if (normalized.includes('request') && normalized.includes('not found')) {
    return '授权请求不存在，请返回应用重新发起';
  }
  return message;
}

async function approveRequest(options: { auto: boolean }) {
  if (!requestId.value) {
    setHint('error', '授权请求无效，请返回应用重新发起。');
    return;
  }
  if (!requestMode.value) {
    setHint('error', '未识别授权流程，请返回应用重新发起。');
    return;
  }
  if (requestInfo.value?.status !== 'pending') {
    setHint('error', '该授权请求已失效，请返回应用重新发起。');
    return;
  }
  const code = totpCode.value;
  if (code.length !== DIGIT_COUNT) {
    if (!options.auto) {
      notifyInfo('请输入 6 位认证器验证码');
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
        setHint('success', '验证成功，正在返回应用…');
        startRedirect(result.redirectUri);
      } else {
        setHint('success', '验证成功，请返回应用继续。');
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
      setHint('success', '验证成功，正在返回应用…');
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

const canApprove = computed(() => {
  return (
    requestInfo.value?.status === 'pending' &&
    totpCode.value.length === DIGIT_COUNT &&
    !approving.value &&
    !redirecting.value
  );
});

const redirecting = computed(() => redirectCountdown.value > 0);

const inputDisabled = computed(() => {
  return approving.value || redirecting.value || requestInfo.value?.status !== 'pending';
});

const requestAppName = computed(() => {
  const name = String(requestInfo.value?.appName || '').trim();
  return name || '授权应用';
});

const requestSubjectHint = computed(() => {
  const text = String(requestInfo.value?.subjectHint || '').trim();
  return text || '';
});

const requestStatusText = computed(() => {
  const status = requestInfo.value?.status || '';
  if (status === 'pending') return '待确认';
  if (status === 'used') return '已处理';
  if (status === 'expired') return '已过期';
  if (status === 'revoked') return '已撤销';
  if (!status) return loadingRequest.value ? '加载中' : '无效请求';
  return status;
});

const requestExpireText = computed(() => {
  if (!requestInfo.value?.expiresAt) return '';
  const expireSec = Math.floor(Number(requestInfo.value.expiresAt) / 1000);
  if (!Number.isFinite(expireSec) || expireSec <= 0) return '';
  const remain = expireSec - nowSec.value;
  if (remain <= 0) {
    return '该请求已过期，请返回应用重新发起。';
  }
  const minute = Math.floor(remain / 60);
  const second = remain % 60;
  if (minute > 0) {
    return `授权请求剩余 ${minute} 分 ${second} 秒`;
  }
  return `授权请求剩余 ${second} 秒`;
});

watch(
  () => route.query.requestId,
  (value) => {
    requestId.value = resolveRequestId(value);
    requestMode.value = '';
    requestInfo.value = null;
    approveResult.value = null;
    lastSubmittedCode.value = '';
    clearDigits(false);
    clearRedirectTimers();
    setHint('info', '输满 6 位验证码后会自动验证');
    loadRequestInfo().catch(() => {});
  }
);

watch(
  () => totpCode.value,
  (value, oldValue) => {
    if (
      value.length === DIGIT_COUNT &&
      requestInfo.value?.status === 'pending' &&
      !approving.value &&
      !redirecting.value
    ) {
      approveRequest({ auto: true }).catch(() => {});
      return;
    }
    if (oldValue !== value && hintType.value === 'error' && value.length > 0) {
      setHint('info', '输满 6 位验证码后会自动验证');
    }
  }
);

onMounted(async () => {
  startTotpTimer();
  await loadTotpStatus();
  requestId.value = resolveRequestId(route.query.requestId);
  await loadRequestInfo();
  focusFirstDigit();
});

onBeforeUnmount(() => {
  clearRedirectTimers();
  clearTotpTimer();
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

.subject-hint,
.expire-text {
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
