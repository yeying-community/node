<template>
  <div class="my-config">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>我的配置</el-breadcrumb-item>
    </el-breadcrumb>

    <div class="page-head">
      <div>
        <div class="page-title">中心化 UCAN 配置</div>
      </div>
      <div class="head-actions">
        <el-button @click="loadTotpStatus">刷新状态</el-button>
        <el-button type="primary" @click="loadTotpProvision">加载认证器配置</el-button>
      </div>
    </div>

    <div class="status-card">
      <div class="status-title">Totp Auth 状态</div>
      <div class="status-list">
        <div class="status-item">
          <span class="status-label">服务开关</span>
          <el-tag :type="totpStatus?.enabled ? 'success' : 'info'" effect="light">
            {{ totpStatus ? (totpStatus.enabled ? '已开启' : '未开启') : '-' }}
          </el-tag>
        </div>
        <div class="status-item">
          <span class="status-label">服务就绪</span>
          <el-tag :type="totpStatus?.ready ? 'success' : 'warning'" effect="light">
            {{ totpStatus ? (totpStatus.ready ? '就绪' : '未就绪') : '-' }}
          </el-tag>
        </div>
        <div class="status-item">
          <span class="status-label">Issuer</span>
          <span class="status-value">{{ totpStatus?.issuerName || '-' }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">验证路径</span>
          <span class="status-value path-text">{{ totpStatus?.verifyPath || '-' }}</span>
        </div>
      </div>
      <div v-if="totpStatus?.error" class="status-error">错误：{{ totpStatus.error }}</div>
    </div>

    <div v-if="totpProvision" class="totp-card">
      <div class="totp-head">
        <div class="totp-title">认证器配置（TOTP）</div>
      </div>
      <div class="totp-body">
        <div class="totp-meta">
          <div class="meta-item">
            <span class="status-label">issuer</span>
            <span class="status-value">{{ totpProvision.issuer }}</span>
          </div>
          <div class="meta-item">
            <span class="status-label">account</span>
            <span class="status-value">{{ totpProvision.accountName }}</span>
          </div>
          <div class="meta-item">
            <span class="status-label">period / digits</span>
            <span class="status-value">{{ totpProvision.period }}s / {{ totpProvision.digits }}</span>
          </div>
          <div class="field-line">
            <span class="label">secret</span>
            <el-input :model-value="totpProvision.secret" readonly />
            <el-button @click="copyText(totpProvision.secret, 'TOTP secret')">复制</el-button>
          </div>
          <div class="field-line">
            <span class="label">otpauthUri</span>
            <el-input :model-value="totpProvision.otpauthUri" readonly />
            <el-button @click="copyText(totpProvision.otpauthUri, 'otpauthUri')">复制</el-button>
            <el-button @click="openLink(totpProvision.otpauthUri)">打开</el-button>
          </div>
        </div>
        <div class="qr-box">
          <div class="label">二维码</div>
          <div class="qr-panel">
            <img v-if="totpQrDataUrl" :src="totpQrDataUrl" alt="TOTP QR Code" />
            <div v-else class="qr-placeholder">二维码生成中或不可用</div>
          </div>
        </div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="config-tabs">
      <el-tab-pane label="配置" name="config">
        <div class="panel">
          <el-form label-position="top" class="config-form">
            <div class="grid-two">
              <el-form-item label="区块链地址">
                <el-input v-model="form.address" placeholder="0x..." />
              </el-form-item>
              <el-form-item label="AppId">
                <el-input v-model="form.appId" placeholder="应用发布后生成的 AppId（UUID）" />
              </el-form-item>
              <el-form-item class="full" label="redirectUri">
                <el-input
                  v-model="form.redirectUri"
                  placeholder="必须命中应用发布中的授权回调地址，例如：https://app.example.com/callback"
                />
              </el-form-item>
              <el-form-item label="state">
                <el-input v-model="form.state" placeholder="可选" />
              </el-form-item>
              <el-form-item label="requestTtlMs">
                <el-input-number v-model="form.requestTtlMs" :min="60000" :step="30000" />
              </el-form-item>
            </div>
          </el-form>
          <div class="actions">
            <el-button type="primary" @click="saveConfig">保存配置</el-button>
            <el-button @click="restoreConfig">重载配置</el-button>
            <el-button type="success" @click="createAuthorizeRequest">创建授权请求</el-button>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="流程" name="flow">
        <div class="panel">
          <div class="flow-step">
            <div class="step-title"><span class="step-dot">1</span>查询授权请求</div>
            <div class="line">
              <span class="label">requestId</span>
              <el-input v-model="requestIdInput" placeholder="创建后自动填充，也可手动输入" />
              <el-button @click="queryAuthorizeRequest">查询</el-button>
            </div>
          </div>

          <div class="flow-step">
            <div class="step-title"><span class="step-dot">2</span>TOTP 批准授权</div>
            <div class="line">
              <span class="label">TOTP Code</span>
              <el-input v-model="totpCode" placeholder="6位认证器验证码" />
              <el-button type="success" @click="approveAuthorizeRequest">批准授权</el-button>
            </div>
          </div>

          <div class="flow-step">
            <div class="step-title"><span class="step-dot">3</span>兑换授权码</div>
            <div class="line">
              <span class="label">Auth Code</span>
              <el-input v-model="authCodeInput" placeholder="approve 后自动填充" />
              <el-button type="warning" @click="exchangeAuthorizeCode">兑换 Token</el-button>
            </div>
          </div>

          <div class="flow-step">
            <div class="step-title"><span class="step-dot">4</span>确认回调链接</div>
            <div class="line">
              <span class="label">verifyUrl</span>
              <el-input :model-value="requestResult?.verifyUrl || ''" readonly />
              <el-button @click="openVerifyUrl">打开</el-button>
              <el-button @click="copyText(requestResult?.verifyUrl || '', 'verifyUrl')">复制</el-button>
            </div>
            <div class="line">
              <span class="label">redirectTo</span>
              <el-input :model-value="approveResult?.redirectTo || ''" readonly />
              <el-button @click="openRedirectTo">打开</el-button>
              <el-button @click="copyText(approveResult?.redirectTo || '', 'redirectTo')">复制</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="验证" name="result">
        <div class="panel">
          <div class="flow-step">
            <div class="line">
              <span class="label">JWT Token</span>
              <el-input :model-value="exchangeResult?.token || ''" readonly />
              <el-button @click="copyText(exchangeResult?.token || '', 'JWT')">复制</el-button>
              <el-button @click="verifyProfileWithJwt">验证</el-button>
            </div>
          </div>
          <div class="flow-step">
            <div class="line">
              <span class="label">UCAN Token</span>
              <el-input :model-value="exchangeResult?.ucan || ''" readonly />
              <el-button @click="copyText(exchangeResult?.ucan || '', 'UCAN')">复制</el-button>
              <el-button @click="verifyProfileWithUcan">验证</el-button>
            </div>
          </div>
          <div class="result-json">
            <pre>{{ prettyResult }}</pre>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import QRCode from 'qrcode';
import { apiUrl } from '@/plugins/api';
import { getAuthToken, getCurrentAccount } from '@/plugins/auth';
import { notifyError, notifyInfo, notifySuccess } from '@/utils/message';

type Envelope<T> = {
  code: number;
  message: string;
  data: T;
  timestamp: number;
};

type TotpStatus = {
  enabled: boolean;
  ready: boolean;
  issuerName: string;
  verifyPath: string;
  portalBaseUrl: string;
  requestTtlMs: number;
  codeDigits: number;
  codePeriodSec: number;
  codeWindow: number;
  maxAttempts: number;
  error?: string;
};

type TotpProvision = {
  subject: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: 'SHA1';
  digits: number;
  period: number;
  otpauthUri: string;
};

type UcanCapability = {
  with?: string;
  can?: string;
  resource?: string;
  action?: string;
};

type AuthorizeRequestResult = {
  requestId: string;
  status: string;
  subject: string;
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

type AuthorizeApproveResult = {
  requestId: string;
  appName: string;
  approvedAt: number;
  authorizationCode: string;
  authorizationCodeExpiresAt: number;
  redirectTo: string;
};

type AuthorizeExchangeResult = {
  requestId: string;
  subject: string;
  appId: string;
  redirectUri: string;
  state?: string;
  token: string;
  expiresAt: number;
  refreshExpiresAt: number;
  ucan: string;
  issuer: string;
  audience: string;
  capabilities: UcanCapability[];
  notBefore: number;
  ucanExpiresAt: number;
  issuedAt: number;
};

type ProfileResult = {
  address: string;
  issuer?: string;
  ucanSource?: string;
  authType?: string;
  issuedAt: number;
};

type ConfigForm = {
  address: string;
  appId: string;
  redirectUri: string;
  state: string;
  requestTtlMs: number;
};

const STORAGE_KEY = 'node:web:my-config:totp-authorize';

const activeTab = ref('config');
const totpStatus = ref<TotpStatus | null>(null);
const totpProvision = ref<TotpProvision | null>(null);
const totpQrDataUrl = ref('');
const requestResult = ref<AuthorizeRequestResult | null>(null);
const approveResult = ref<AuthorizeApproveResult | null>(null);
const exchangeResult = ref<AuthorizeExchangeResult | null>(null);
const profileResult = ref<ProfileResult | null>(null);
const requestIdInput = ref('');
const totpCode = ref('');
const authCodeInput = ref('');

const form = reactive<ConfigForm>({
  address: '',
  appId: '',
  redirectUri: '',
  state: '',
  requestTtlMs: 300000,
});

async function parseEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let parsed: Envelope<T> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new Error(`${fallbackMessage}: ${text}`);
    }
  }
  if (!response.ok) {
    throw new Error(parsed?.message || `${fallbackMessage}: ${response.status}`);
  }
  if (!parsed || parsed.code !== 0) {
    throw new Error(parsed?.message || fallbackMessage);
  }
  return parsed.data;
}

async function getJson<T>(path: string, fallbackMessage: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'GET',
    credentials: 'include',
  });
  return await parseEnvelope<T>(response, fallbackMessage);
}

async function postJson<T>(path: string, body: unknown, fallbackMessage: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return await parseEnvelope<T>(response, fallbackMessage);
}

function ensureAddress() {
  const address = String(form.address || '').trim();
  if (!address) {
    throw new Error('请填写区块链地址');
  }
  return address;
}

function ensureAppConfig() {
  const appId = String(form.appId || '').trim();
  const redirectUri = String(form.redirectUri || '').trim();
  if (!appId || !redirectUri) {
    throw new Error('请填写 AppId 和 redirectUri');
  }
  return { appId, redirectUri };
}

function restoreConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const account = getCurrentAccount();
    if (account) {
      form.address = account;
    }
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConfigForm>;
    form.address = String(parsed.address || getCurrentAccount() || '');
    form.appId = String(parsed.appId || '');
    form.redirectUri = String(parsed.redirectUri || '');
    form.state = String(parsed.state || '');
    form.requestTtlMs = Number(parsed.requestTtlMs || 300000);
  } catch {
    notifyError('读取本地配置失败，已使用默认值');
  }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  notifySuccess('配置已保存到本地');
}

async function loadTotpStatus() {
  try {
    totpStatus.value = await getJson<TotpStatus>(
      '/api/v1/public/auth/totp/status',
      '查询 totp auth 状态失败'
    );
  } catch (error) {
    notifyError(String(error));
  }
}

async function renderTotpQrCode(uri: string) {
  const value = String(uri || '').trim();
  if (!value) {
    totpQrDataUrl.value = '';
    return;
  }
  try {
    totpQrDataUrl.value = await QRCode.toDataURL(value, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });
  } catch {
    totpQrDataUrl.value = '';
    notifyError('生成二维码失败，可改为复制 otpauthUri 手动导入');
  }
}

async function loadTotpProvision() {
  try {
    const token = await getAuthToken();
    if (!token) {
      notifyError('缺少登录态，请先钱包登录');
      return;
    }
    const response = await fetch(apiUrl('/api/v1/public/auth/totp/totp/provision'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    totpProvision.value = await parseEnvelope<TotpProvision>(
      response,
      '获取认证器配置失败'
    );
    await renderTotpQrCode(totpProvision.value.otpauthUri);
    notifySuccess('认证器配置已加载，请绑定到你的认证器应用');
  } catch (error) {
    totpQrDataUrl.value = '';
    notifyError(String(error));
  }
}

async function createAuthorizeRequest() {
  try {
    const address = ensureAddress();
    const { appId, redirectUri } = ensureAppConfig();
    const payload = {
      address,
      appId,
      redirectUri,
      state: form.state || undefined,
      requestTtlMs: form.requestTtlMs,
    };
    const result = await postJson<AuthorizeRequestResult>(
      '/api/v1/public/auth/totp/authorize/request',
      payload,
      '创建授权请求失败'
    );
    requestResult.value = result;
    requestIdInput.value = result.requestId;
    approveResult.value = null;
    exchangeResult.value = null;
    profileResult.value = null;
    activeTab.value = 'flow';
    notifySuccess('授权请求已创建');
  } catch (error) {
    notifyError(String(error));
  }
}

async function queryAuthorizeRequest() {
  try {
    const requestId = String(requestIdInput.value || '').trim();
    if (!requestId) {
      notifyError('请先输入 requestId');
      return;
    }
    const result = await getJson<AuthorizeRequestResult>(
      `/api/v1/public/auth/totp/authorize/request/${encodeURIComponent(requestId)}`,
      '查询授权请求失败'
    );
    requestResult.value = result;
    notifySuccess('授权请求状态已刷新');
  } catch (error) {
    notifyError(String(error));
  }
}

async function approveAuthorizeRequest() {
  try {
    const requestId = String(requestIdInput.value || '').trim();
    const code = String(totpCode.value || '').trim();
    if (!requestId || !code) {
      notifyError('请填写 requestId 和 TOTP code');
      return;
    }
    const result = await postJson<AuthorizeApproveResult>(
      '/api/v1/public/auth/totp/authorize/approve',
      { requestId, code },
      'TOTP 授权失败'
    );
    approveResult.value = result;
    authCodeInput.value = result.authorizationCode;
    exchangeResult.value = null;
    profileResult.value = null;
    notifySuccess('授权已通过，请继续兑换 code');
  } catch (error) {
    notifyError(String(error));
  }
}

async function exchangeAuthorizeCode() {
  try {
    const code = String(authCodeInput.value || '').trim();
    const { appId, redirectUri } = ensureAppConfig();
    if (!code) {
      notifyError('请填写 authorization code');
      return;
    }
    const result = await postJson<AuthorizeExchangeResult>(
      '/api/v1/public/auth/totp/authorize/exchange',
      { code, appId, redirectUri },
      '兑换授权码失败'
    );
    exchangeResult.value = result;
    profileResult.value = null;
    activeTab.value = 'result';
    notifySuccess('授权码已兑换，拿到 JWT + UCAN');
  } catch (error) {
    notifyError(String(error));
  }
}

async function verifyProfileWithJwt() {
  try {
    const token = exchangeResult.value?.token;
    if (!token) {
      notifyError('没有可用 JWT token');
      return;
    }
    const response = await fetch(apiUrl('/api/v1/public/profile/me'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    profileResult.value = await parseEnvelope<ProfileResult>(response, 'JWT 验证失败');
    notifySuccess('JWT 验证成功');
  } catch (error) {
    notifyError(String(error));
  }
}

async function verifyProfileWithUcan() {
  try {
    const token = exchangeResult.value?.ucan;
    if (!token) {
      notifyError('没有可用 UCAN token');
      return;
    }
    const response = await fetch(apiUrl('/api/v1/public/profile/me'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    profileResult.value = await parseEnvelope<ProfileResult>(response, 'UCAN 验证失败');
    notifySuccess('UCAN 验证成功');
  } catch (error) {
    notifyError(String(error));
  }
}

function openLink(url: string) {
  if (!url) {
    notifyInfo('当前没有可打开的链接');
    return;
  }
  window.open(url, '_blank');
}

function openVerifyUrl() {
  openLink(requestResult.value?.verifyUrl || '');
}

function openRedirectTo() {
  openLink(approveResult.value?.redirectTo || '');
}

async function copyText(value: string, label: string) {
  if (!value) {
    notifyInfo(`没有可复制的 ${label}`);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    notifySuccess(`${label} 已复制`);
  } catch {
    notifyError(`复制 ${label} 失败`);
  }
}

const prettyResult = computed(() => {
  const payload = {
    request: requestResult.value,
    approve: approveResult.value,
    exchange: exchangeResult.value,
    profile: profileResult.value,
  };
  return JSON.stringify(payload, null, 2);
});

onMounted(async () => {
  restoreConfig();
  await loadTotpStatus();
});
</script>

<style scoped lang="less">
.my-config {
  margin: 20px;

  .page-head {
    margin-top: 16px;
    padding: 16px 18px;
    border-radius: 10px;
    background: #fff;
    border: 1px solid #e8edf4;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
  }

  .page-title {
    font-size: 18px;
    line-height: 1.3;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.88);
  }

  .head-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .status-card {
    margin-top: 14px;
    padding: 16px;
    background: #fff;
    border: 1px solid #e8edf4;
    border-radius: 10px;
  }

  .status-title {
    font-size: 15px;
    font-weight: 500;
    margin-bottom: 12px;
    color: rgba(0, 0, 0, 0.86);
  }

  .status-list {
    display: grid;
    gap: 10px;
  }

  .status-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 14px;
    line-height: 1.5;
    color: rgba(0, 0, 0, 0.75);
  }

  .status-label {
    color: rgba(0, 0, 0, 0.58);
    white-space: nowrap;
  }

  .status-value {
    color: rgba(0, 0, 0, 0.82);
    word-break: break-all;
  }

  .path-text {
    font-family: var(--app-font-mono);
    font-size: 13px;
  }

  .status-row {
    display: flex;
    gap: 8px;
    line-height: 24px;
    font-size: 14px;
    color: rgba(0, 0, 0, 0.75);
  }

  .status-error {
    margin-top: 8px;
    color: #d93026;
    font-size: 14px;
    line-height: 1.5;
  }

  .totp-card {
    margin-top: 14px;
    padding: 16px;
    border: 1px solid #e8edf4;
    border-radius: 10px;
    background: #fff;
  }

  .totp-head {
    margin-bottom: 12px;
  }

  .totp-title {
    font-size: 15px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.86);
  }

  .totp-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 16px;
    align-items: start;
  }

  .totp-meta {
    display: grid;
    gap: 10px;
  }

  .meta-item {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 14px;
    line-height: 1.5;
  }

  .qr-box {
    justify-self: end;
  }

  .qr-panel {
    margin-top: 8px;
    width: 232px;
    height: 232px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .qr-panel img {
    width: 220px;
    height: 220px;
    display: block;
  }

  .qr-placeholder {
    font-size: 13px;
    color: rgba(0, 0, 0, 0.45);
    text-align: center;
    padding: 0 12px;
  }

  .config-tabs {
    margin-top: 16px;
    background: #fff;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid #e8edf4;
  }

  .panel {
    padding: 8px 2px 12px;
  }

  .config-form .grid-two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 12px;
  }

  .config-form .full {
    grid-column: 1 / -1;
  }

  .config-form :deep(.el-form-item) {
    margin-bottom: 14px;
  }

  .flow-step {
    padding: 12px;
    border: 1px solid #edf1f7;
    border-radius: 8px;
    background: #fafcff;
    margin-bottom: 12px;
  }

  .step-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 14px;
    line-height: 1.45;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.82);
  }

  .step-dot {
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: #1677ff;
    color: #fff;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .actions {
    margin-top: 8px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .line {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
  }

  .field-line {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr) auto auto;
    gap: 8px;
    align-items: center;
  }

  .label {
    font-size: 14px;
    line-height: 1.45;
    color: rgba(0, 0, 0, 0.75);
  }

  .result-json {
    margin-top: 12px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: #fafafa;
    max-height: 360px;
    overflow: auto;
    padding: 10px;
  }

  pre {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
  }
}

@media (max-width: 1200px) {
  .my-config {
    .totp-body {
      grid-template-columns: 1fr;
    }

    .qr-box {
      justify-self: start;
    }
  }
}

@media (max-width: 980px) {
  .my-config {
    .page-head {
      flex-direction: column;
      align-items: stretch;
    }

    .head-actions {
      margin-top: 2px;
    }

    .config-form .grid-two {
      grid-template-columns: 1fr;
    }

    .line,
    .field-line {
      grid-template-columns: 1fr;
    }

    .status-item,
    .meta-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
  }
}
</style>
