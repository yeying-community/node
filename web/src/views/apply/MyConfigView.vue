<template>
  <div class="my-config">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>我的配置</el-breadcrumb-item>
    </el-breadcrumb>

    <div class="status-card">
      <div class="status-title">Mobile Auth 状态</div>
      <div class="status-row">
        <span>enabled:</span>
        <span>{{ mobileStatus ? String(mobileStatus.enabled) : '-' }}</span>
      </div>
      <div class="status-row">
        <span>ready:</span>
        <span>{{ mobileStatus ? String(mobileStatus.ready) : '-' }}</span>
      </div>
      <div class="status-row">
        <span>issuer:</span>
        <span>{{ mobileStatus?.issuerName || '-' }}</span>
      </div>
      <div class="status-row">
        <span>verifyPath:</span>
        <span>{{ mobileStatus?.verifyPath || '-' }}</span>
      </div>
      <div v-if="mobileStatus?.error" class="status-error">error: {{ mobileStatus.error }}</div>
      <div class="status-actions">
        <el-button size="small" @click="loadMobileStatus">刷新状态</el-button>
        <el-button type="primary" size="small" @click="loadTotpProvision">加载认证器配置</el-button>
      </div>
      <div v-if="totpProvision" class="totp-card">
        <div class="totp-title">认证器配置（TOTP）</div>
        <div class="status-row">
          <span>issuer:</span>
          <span>{{ totpProvision.issuer }}</span>
        </div>
        <div class="status-row">
          <span>account:</span>
          <span>{{ totpProvision.accountName }}</span>
        </div>
        <div class="status-row">
          <span>period/digits:</span>
          <span>{{ totpProvision.period }}s / {{ totpProvision.digits }}</span>
        </div>
        <div class="qr-box">
          <div class="label">二维码</div>
          <div class="qr-panel">
            <img v-if="totpQrDataUrl" :src="totpQrDataUrl" alt="TOTP QR Code" />
            <div v-else class="qr-placeholder">二维码生成中或不可用</div>
          </div>
        </div>
        <div class="line">
          <span class="label">secret</span>
          <el-input :model-value="totpProvision.secret" readonly />
          <el-button @click="copyText(totpProvision.secret, 'TOTP secret')">复制</el-button>
        </div>
        <div class="line">
          <span class="label">otpauthUri</span>
          <el-input :model-value="totpProvision.otpauthUri" readonly />
          <el-button @click="copyText(totpProvision.otpauthUri, 'otpauthUri')">复制</el-button>
          <el-button @click="openLink(totpProvision.otpauthUri)">打开</el-button>
        </div>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="config-tabs">
      <el-tab-pane label="授权配置" name="config">
        <div class="panel">
          <el-form label-width="140px">
            <el-form-item label="区块链地址">
              <el-input v-model="form.address" placeholder="0x..." />
            </el-form-item>
            <el-form-item label="clientId">
              <el-input v-model="form.clientId" placeholder="chat-web" />
            </el-form-item>
            <el-form-item label="redirectUri">
              <el-input v-model="form.redirectUri" placeholder="https://app.example.com/callback" />
            </el-form-item>
            <el-form-item label="state">
              <el-input v-model="form.state" placeholder="可选，建议随机字符串" />
            </el-form-item>
            <el-form-item label="audience">
              <el-input v-model="form.audience" placeholder="did:web:localhost:8100" />
            </el-form-item>
            <el-form-item label="capability.with">
              <el-input v-model="form.capWith" placeholder="app:all:localhost-*" />
            </el-form-item>
            <el-form-item label="capability.can">
              <el-input v-model="form.capCan" placeholder="invoke" />
            </el-form-item>
            <el-form-item label="appName">
              <el-input v-model="form.appName" placeholder="chat-mobile" />
            </el-form-item>
            <el-form-item label="requestTtlMs">
              <el-input-number v-model="form.requestTtlMs" :min="60000" :step="30000" />
            </el-form-item>
          </el-form>
          <div class="actions">
            <el-button type="primary" @click="saveConfig">保存配置</el-button>
            <el-button @click="restoreConfig">重载配置</el-button>
            <el-button type="success" @click="createAuthorizeRequest">创建授权请求</el-button>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="授权流程" name="flow">
        <div class="panel">
          <div class="line">
            <span class="label">requestId</span>
            <el-input v-model="requestIdInput" placeholder="创建后自动填充，也可手动输入" />
            <el-button @click="queryAuthorizeRequest">查询</el-button>
          </div>

          <div class="line">
            <span class="label">TOTP Code</span>
            <el-input v-model="totpCode" placeholder="6位认证器验证码" />
            <el-button type="success" @click="approveAuthorizeRequest">批准授权</el-button>
          </div>

          <div class="line">
            <span class="label">Auth Code</span>
            <el-input v-model="authCodeInput" placeholder="approve 后自动填充" />
            <el-button type="warning" @click="exchangeAuthorizeCode">兑换 Token</el-button>
          </div>

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
      </el-tab-pane>

      <el-tab-pane label="结果验证" name="result">
        <div class="panel">
          <div class="line">
            <span class="label">JWT Token</span>
            <el-input :model-value="exchangeResult?.token || ''" readonly />
            <el-button @click="copyText(exchangeResult?.token || '', 'JWT')">复制</el-button>
            <el-button @click="verifyProfileWithJwt">验证</el-button>
          </div>
          <div class="line">
            <span class="label">UCAN Token</span>
            <el-input :model-value="exchangeResult?.ucan || ''" readonly />
            <el-button @click="copyText(exchangeResult?.ucan || '', 'UCAN')">复制</el-button>
            <el-button @click="verifyProfileWithUcan">验证</el-button>
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

type MobileStatus = {
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

type MobileTotpProvision = {
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
  clientId: string;
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
  clientId: string;
  redirectUri: string;
  state: string;
  audience: string;
  capWith: string;
  capCan: string;
  appName: string;
  requestTtlMs: number;
};

const STORAGE_KEY = 'node:web:my-config:mobile-authorize';

const activeTab = ref('config');
const mobileStatus = ref<MobileStatus | null>(null);
const totpProvision = ref<MobileTotpProvision | null>(null);
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
  clientId: 'chat-web',
  redirectUri: 'http://127.0.0.1:8001/examples/frontend/chat-callback.html',
  state: '',
  audience: 'did:web:localhost:8100',
  capWith: 'app:all:localhost-*',
  capCan: 'invoke',
  appName: 'chat-mobile',
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

function ensureClientConfig() {
  const clientId = String(form.clientId || '').trim();
  const redirectUri = String(form.redirectUri || '').trim();
  if (!clientId || !redirectUri) {
    throw new Error('请填写 clientId 和 redirectUri');
  }
  return { clientId, redirectUri };
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
    form.clientId = String(parsed.clientId || 'chat-web');
    form.redirectUri = String(
      parsed.redirectUri || 'http://127.0.0.1:8001/examples/frontend/chat-callback.html'
    );
    form.state = String(parsed.state || '');
    form.audience = String(parsed.audience || 'did:web:localhost:8100');
    form.capWith = String(parsed.capWith || 'app:all:localhost-*');
    form.capCan = String(parsed.capCan || 'invoke');
    form.appName = String(parsed.appName || 'chat-mobile');
    form.requestTtlMs = Number(parsed.requestTtlMs || 300000);
  } catch {
    notifyError('读取本地配置失败，已使用默认值');
  }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  notifySuccess('配置已保存到本地');
}

async function loadMobileStatus() {
  try {
    mobileStatus.value = await getJson<MobileStatus>(
      '/api/v1/public/auth/mobile/status',
      '查询 mobile auth 状态失败'
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
    const response = await fetch(apiUrl('/api/v1/public/auth/mobile/totp/provision'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    totpProvision.value = await parseEnvelope<MobileTotpProvision>(
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
    const { clientId, redirectUri } = ensureClientConfig();
    const payload = {
      address,
      clientId,
      redirectUri,
      state: form.state || undefined,
      audience: String(form.audience || '').trim() || undefined,
      capabilities: [
        {
          with: String(form.capWith || '').trim(),
          can: String(form.capCan || '').trim(),
        },
      ],
      appName: String(form.appName || '').trim() || undefined,
      requestTtlMs: form.requestTtlMs,
    };
    const result = await postJson<AuthorizeRequestResult>(
      '/api/v1/public/auth/mobile/authorize/request',
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
      `/api/v1/public/auth/mobile/authorize/request/${encodeURIComponent(requestId)}`,
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
      '/api/v1/public/auth/mobile/authorize/approve',
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
    const { clientId, redirectUri } = ensureClientConfig();
    if (!code) {
      notifyError('请填写 authorization code');
      return;
    }
    const result = await postJson<AuthorizeExchangeResult>(
      '/api/v1/public/auth/mobile/authorize/exchange',
      { code, clientId, redirectUri },
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
  await loadMobileStatus();
});
</script>

<style scoped lang="less">
.my-config {
  margin: 20px;

  .status-card {
    margin-top: 20px;
    padding: 16px;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    max-width: 900px;
  }

  .status-title {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 12px;
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
  }

  .status-actions {
    margin-top: 10px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .totp-card {
    margin-top: 14px;
    padding: 12px;
    border: 1px dashed #d1d5db;
    border-radius: 8px;
    background: #fafcff;
  }

  .totp-title {
    font-size: 15px;
    font-weight: 500;
    margin-bottom: 8px;
  }

  .qr-box {
    margin: 10px 0 14px;
  }

  .qr-panel {
    margin-top: 6px;
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
    padding: 12px;
    border-radius: 8px;
  }

  .panel {
    padding: 8px 4px 12px;
  }

  .actions {
    margin-top: 12px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .line {
    display: grid;
    grid-template-columns: 120px 1fr auto auto;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
  }

  .label {
    font-size: 14px;
    color: rgba(0, 0, 0, 0.75);
  }

  .result-json {
    margin-top: 8px;
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

@media (max-width: 980px) {
  .my-config .line {
    grid-template-columns: 1fr;
  }
}
</style>
