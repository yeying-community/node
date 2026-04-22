<template>
  <div class="mobile-auth-page">
    <div class="mobile-auth-card">
      <h1>UCAN 授权（服务）</h1>
      <p class="subtitle">请输入认证器验证码，完成本次中心化 UCAN 授权。</p>

      <div class="line">
        <span class="label">requestId</span>
        <el-input :model-value="requestId" readonly />
      </div>

      <div class="line">
        <span class="label">状态</span>
        <el-tag :type="statusType">{{ requestInfo?.status || '-' }}</el-tag>
        <el-button size="small" :loading="loadingRequest" @click="loadRequestInfo">刷新</el-button>
      </div>

      <div class="line">
        <span class="label">流程类型</span>
        <el-input :model-value="requestModeLabel" readonly />
      </div>

      <div class="line">
        <span class="label">应用</span>
        <el-input :model-value="requestInfo?.appName || '-'" readonly />
      </div>

      <div class="line">
        <span class="label">clientId</span>
        <el-input :model-value="requestClientId" readonly />
      </div>

      <div class="line">
        <span class="label">地址提示</span>
        <el-input :model-value="requestInfo?.subjectHint || '-'" readonly />
      </div>

      <div class="line">
        <span class="label">回跳地址</span>
        <el-input :model-value="requestInfo?.redirectUri || '-'" readonly />
      </div>

      <div class="line">
        <span class="label">过期时间</span>
        <el-input :model-value="formatTimestamp(requestInfo?.expiresAt)" readonly />
      </div>

      <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

      <div v-if="approveResult" class="success-box">
        <div>{{ approveSuccessText }}</div>
        <div v-if="approveResult.authorizationCode" class="success-line">
          <span>authorizationCode:</span>
          <span>{{ approveResult.authorizationCode }}</span>
        </div>
        <div v-if="approveResult.redirectTo" class="success-line">
          <span>redirectTo:</span>
          <span>{{ approveResult.redirectTo }}</span>
        </div>
        <div v-if="approveResult.redirectTo" class="success-line">
          <span>倒计时:</span>
          <span>{{ redirectCountdown }} 秒</span>
        </div>
        <el-button v-if="approveResult.redirectTo" type="success" size="small" @click="goRedirectNow">
          立即回跳
        </el-button>
      </div>

      <div class="line">
        <span class="label">TOTP Code</span>
        <el-input
          v-model="totpCode"
          maxlength="10"
          placeholder="请输入 6 位认证器验证码"
          @keyup.enter="approveRequest"
        />
        <el-button
          type="primary"
          :loading="approving"
          :disabled="!canApprove"
          @click="approveRequest"
        >
          确认授权
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiUrl } from '@/plugins/api';
import { notifyError, notifyInfo, notifySuccess } from '@/utils/message';

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
  clientId: string;
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
  authorizationCode?: string;
};

const route = useRoute();

const requestId = ref('');
const requestMode = ref<'authorize' | 'bind' | ''>('');
const requestInfo = ref<RequestInfo | null>(null);
const approveResult = ref<ApproveResultView | null>(null);
const errorMessage = ref('');
const totpCode = ref('');
const loadingRequest = ref(false);
const approving = ref(false);
const redirectCountdown = ref(0);

let redirectTimer: number | null = null;
let countdownTimer: number | null = null;

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
    errorMessage.value = '缺少 requestId，请从应用发起授权流程后再访问该页面。';
    return;
  }
  loadingRequest.value = true;
  errorMessage.value = '';
  try {
    const authorizeResponse = await fetch(
      apiUrl(`/api/v1/public/auth/mobile/authorize/request/${encodeURIComponent(requestId.value)}`),
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
      return;
    }

    const bindResponse = await fetch(
      apiUrl(`/api/v1/public/auth/mobile/bind/request/${encodeURIComponent(requestId.value)}`),
      {
        method: 'GET',
        credentials: 'include',
      }
    );
    requestInfo.value = await parseEnvelope<BindRequestInfo>(bindResponse, '查询绑定请求失败');
    requestMode.value = 'bind';
  } catch (error) {
    errorMessage.value = String(error);
    notifyError(errorMessage.value);
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

function goRedirectNow() {
  const redirectTo = approveResult.value?.redirectTo || '';
  if (!redirectTo) {
    notifyInfo('当前没有可回跳的地址');
    return;
  }
  clearRedirectTimers();
  window.location.href = redirectTo;
}

async function approveRequest() {
  if (!requestId.value) {
    notifyError('缺少 requestId');
    return;
  }
  if (!requestMode.value) {
    notifyError('未识别授权流程，请先刷新请求状态');
    return;
  }
  const code = String(totpCode.value || '').replace(/[^0-9]/g, '');
  if (!code) {
    notifyError('请输入认证器验证码');
    return;
  }

  approving.value = true;
  errorMessage.value = '';
  try {
    if (requestMode.value === 'bind') {
      const response = await fetch(apiUrl('/api/v1/public/auth/mobile/bind/approve'), {
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
        notifySuccess('授权成功，正在回跳应用');
        startRedirect(result.redirectUri);
      } else {
        notifySuccess('授权成功，请返回应用继续');
      }
    } else {
      const response = await fetch(apiUrl('/api/v1/public/auth/mobile/authorize/approve'), {
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
        authorizationCode: result.authorizationCode,
      };
      notifySuccess('授权成功，正在回跳应用');
      startRedirect(result.redirectTo);
    }
    await loadRequestInfo();
  } catch (error) {
    errorMessage.value = String(error);
    notifyError(errorMessage.value);
  } finally {
    approving.value = false;
  }
}

function formatTimestamp(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return '-';
  return new Date(value).toLocaleString();
}

const canApprove = computed(() => {
  return requestInfo.value?.status === 'pending' && !approveResult.value;
});

const requestModeLabel = computed(() => {
  if (requestMode.value === 'authorize') return '地址授权（authorize）';
  if (requestMode.value === 'bind') return '会话桥接（bind）';
  return '-';
});

const requestClientId = computed(() => {
  if (requestMode.value !== 'authorize' || !requestInfo.value) return '-';
  return (requestInfo.value as AuthorizeRequestInfo).clientId || '-';
});

const approveSuccessText = computed(() => {
  if (!approveResult.value) return '';
  if (approveResult.value.mode === 'authorize') {
    return '授权成功，已生成一次性授权码并正在回跳应用。';
  }
  return approveResult.value.redirectTo
    ? '授权成功，正在回跳应用。'
    : '授权成功，请返回业务应用继续。';
});

const statusType = computed(() => {
  const status = requestInfo.value?.status;
  if (status === 'pending') return 'warning';
  if (status === 'used') return 'success';
  if (status === 'expired') return 'danger';
  if (status === 'revoked') return 'info';
  return 'info';
});

watch(
  () => route.query.requestId,
  (value) => {
    requestId.value = resolveRequestId(value);
    requestMode.value = '';
    requestInfo.value = null;
    approveResult.value = null;
    totpCode.value = '';
    clearRedirectTimers();
    loadRequestInfo().catch(() => {});
  }
);

onMounted(async () => {
  requestId.value = resolveRequestId(route.query.requestId);
  await loadRequestInfo();
});

onBeforeUnmount(() => {
  clearRedirectTimers();
});
</script>

<style scoped lang="less">
.mobile-auth-page {
  min-height: 100vh;
  background: #f3f5f8;
  padding: 20px;
}

.mobile-auth-card {
  max-width: 860px;
  margin: 0 auto;
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e5e7eb;
  padding: 20px;
}

h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
}

.subtitle {
  margin: 8px 0 20px;
  color: rgba(0, 0, 0, 0.65);
  font-size: 14px;
}

.line {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.label {
  color: rgba(0, 0, 0, 0.7);
  font-size: 13px;
}

.error-box {
  margin: 10px 0 16px;
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  color: #cf1322;
  font-size: 13px;
}

.success-box {
  margin: 10px 0 16px;
  padding: 12px;
  border-radius: 6px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  color: #135200;
  font-size: 13px;
}

.success-line {
  margin-top: 6px;
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px;
  word-break: break-all;
}

@media (max-width: 768px) {
  .mobile-auth-page {
    padding: 12px;
  }

  .mobile-auth-card {
    padding: 14px;
  }

  .line {
    grid-template-columns: 1fr;
  }
}
</style>
