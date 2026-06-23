<template>
  <div class="my-config">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>{{ mt('breadcrumb') }}</el-breadcrumb-item>
    </el-breadcrumb>

    <div class="page-head">
      <div>
        <div class="page-title">{{ mt('pageTitle') }}</div>
        <div class="page-subtitle">{{ mt('pageSubtitle') }}</div>
      </div>
      <div class="head-actions">
        <el-button @click="refreshStatuses">{{ mt('refreshStatus') }}</el-button>
      </div>
    </div>

    <el-tabs v-model="authTab" class="page-tabs">
      <el-tab-pane :label="mt('passkeyTab')" name="passkey">
        <div class="method-section">
          <div class="section-heading">{{ mt('configSection') }}</div>
          <div class="summary-grid single-grid">
            <div class="status-card">
              <div class="status-title">{{ mt('passkeyStatusTitle') }}</div>
              <div class="status-hint">{{ mt('passkeyStatusHint') }}</div>
              <div class="status-list">
                <div class="status-item">
                  <span class="status-label">{{ mt('serviceSwitch') }}</span>
                  <el-tag :type="passkeyStatus?.enabled ? 'success' : 'info'" effect="light">
                    {{ passkeyStatus ? (passkeyStatus.enabled ? mt('enabled') : mt('disabled')) : '-' }}
                  </el-tag>
                </div>
                <div class="status-item">
                  <span class="status-label">{{ mt('serviceReady') }}</span>
                  <el-tag :type="passkeyStatus?.ready ? 'success' : 'warning'" effect="light">
                    {{ passkeyStatus ? (passkeyStatus.ready ? mt('ready') : mt('notReady')) : '-' }}
                  </el-tag>
                </div>
              </div>
              <div v-if="passkeyStatus?.error" class="status-error">{{ mt('errorPrefix') }}{{ passkeyStatus.error }}</div>
            </div>
          </div>

          <div class="primary-grid">
            <div class="totp-card passkey-card">
              <div class="totp-head">
                <div>
                  <div class="totp-title">{{ mt('passkeyConfigTitle') }}</div>
                  <div class="section-hint">{{ mt('passkeyManageHint') }}</div>
                </div>
              </div>
              <div class="passkey-actions">
                <div class="field-line">
                  <span class="label">{{ mt('deviceName') }}</span>
                  <el-input v-model="passkeyDeviceName" :placeholder="mt('devicePlaceholder')" />
                  <el-button :disabled="!passkeyStatus?.enabled || !passkeyStatus?.ready" @click="loadPasskeyCredentials">{{ mt('refreshCredentials') }}</el-button>
                  <el-button
                    :disabled="!passkeyStatus?.enabled || !passkeyStatus?.ready"
                    type="primary"
                    @click="registerPasskey"
                  >
                    {{ mt('registerPasskey') }}
                  </el-button>
                </div>
              </div>
              <div class="passkey-list">
                <div v-if="!passkeyCredentials.length" class="empty-text">{{ mt('noPasskeyCredentials') }}</div>
                <div v-for="credential in passkeyCredentials" :key="credential.credentialId" class="flow-step">
                  <div class="credential-head">
                    <div class="credential-name">{{ credential.deviceName || mt('defaultCredential') }}</div>
                    <el-tag :type="credential.revokedAt ? 'info' : 'success'" effect="light">
                      {{ credential.revokedAt ? mt('revoked') : mt('valid') }}
                    </el-tag>
                  </div>
                  <div class="status-list compact-list">
                    <div class="status-item">
                      <span class="status-label">{{ mt('credentialId') }}</span>
                      <span class="status-value path-text">{{ credential.credentialId }}</span>
                    </div>
                    <div class="status-item">
                      <span class="status-label">{{ mt('transports') }}</span>
                      <span class="status-value">{{ credential.transports?.join(', ') || '-' }}</span>
                    </div>
                    <div class="status-item">
                      <span class="status-label">{{ mt('createdAt') }}</span>
                      <span class="status-value">{{ credential.createdAt || '-' }}</span>
                    </div>
                    <div v-if="credential.revokedAt" class="status-item">
                      <span class="status-label">{{ mt('revokedAt') }}</span>
                      <span class="status-value">{{ credential.revokedAt }}</span>
                    </div>
                  </div>
                  <div class="actions">
                    <el-button
                      :disabled="Boolean(credential.revokedAt)"
                      type="danger"
                      plain
                      @click="revokePasskeyCredentialAction(credential.credentialId)"
                    >
                      {{ mt('revoke') }}
                    </el-button>
                    <el-button @click="copyText(credential.credentialId, mt('credentialId'))">{{ mt('copyId') }}</el-button>
                  </div>
                </div>
              </div>
            </div>

            <div class="totp-card">
              <div class="totp-head">
                <div class="totp-title">{{ mt('appConfigTitle') }}</div>
                <div class="section-hint">{{ mt('appConfigHint') }}</div>
              </div>
              <div class="panel">
                <el-form label-position="top" class="config-form">
                  <div class="grid-two">
                    <el-form-item :label="mt('address')">
                      <el-input v-model="form.address" :placeholder="mt('walletAddressPlaceholder')" />
                    </el-form-item>
                    <el-form-item :label="mt('appId')">
                      <el-input v-model="form.appId" :placeholder="mt('appIdPlaceholder')" />
                    </el-form-item>
                    <el-form-item class="full" :label="mt('redirectUri')">
                      <el-input
                        v-model="form.redirectUri"
                        :placeholder="mt('redirectUriPlaceholder')"
                      />
                    </el-form-item>
                    <el-form-item :label="mt('state')">
                      <el-input v-model="form.state" :placeholder="mt('optional')" />
                    </el-form-item>
                    <el-form-item :label="mt('requestTtlMs')">
                      <el-input-number v-model="form.requestTtlMs" :min="60000" :step="30000" />
                    </el-form-item>
                  </div>
                </el-form>
                <div class="actions">
                  <el-button type="primary" @click="saveConfig">{{ mt('saveConfig') }}</el-button>
                  <el-button @click="restoreConfig">{{ mt('reloadConfig') }}</el-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="method-section">
          <div class="section-heading">{{ mt('testSection') }}</div>
          <div class="debug-hint">{{ mt('passkeyTestHint') }}</div>
          <div class="panel-card">
            <div class="flow-step">
              <div class="step-title"><span class="step-dot">P1</span>{{ mt('stepPasskeyCreateRequest') }}</div>
              <div class="line">
                <span class="label">{{ mt('requestId') }}</span>
                <el-input v-model="passkeyRequestIdInput" :placeholder="mt('requestIdPlaceholder')" />
                <el-button :disabled="!passkeyStatus?.enabled || !passkeyStatus?.ready" @click="createPasskeyAuthorizeRequestAction">{{ mt('create') }}</el-button>
                <el-button :disabled="!passkeyStatus?.enabled || !passkeyStatus?.ready" @click="queryPasskeyAuthorizeRequest">{{ mt('query') }}</el-button>
              </div>
            </div>

            <div class="flow-step">
              <div class="step-title"><span class="step-dot">P2</span>{{ mt('stepPasskeyApprove') }}</div>
              <div class="line">
                <span class="label">{{ mt('passkeyChallenge') }}</span>
                <el-input :model-value="passkeyAuthChallenge?.passkeyRequest?.requestId || ''" readonly :placeholder="mt('passkeyChallengePlaceholder')" />
                <el-button
                  :disabled="!passkeyStatus?.enabled || !passkeyStatus?.ready"
                  type="success"
                  @click="approveAuthorizeRequestWithPasskey"
                >
                  {{ mt('triggerSignature') }}
                </el-button>
              </div>
            </div>

            <div class="flow-step">
              <div class="step-title"><span class="step-dot">P3</span>{{ mt('stepPasskeyExchange') }}</div>
              <div class="line">
                <span class="label">{{ mt('authCode') }}</span>
                <el-input v-model="passkeyAuthCodeInput" :placeholder="mt('authCodePlaceholder')" />
                <el-button
                  :disabled="!passkeyStatus?.enabled || !passkeyStatus?.ready"
                  type="warning"
                  @click="exchangePasskeyAuthorizeCode"
                >
                  {{ mt('exchangeToken') }}
                </el-button>
              </div>
            </div>

            <div class="flow-step">
              <div class="step-title"><span class="step-dot">P4</span>{{ mt('stepPasskeyLinks') }}</div>
              <div class="line">
                <span class="label">{{ mt('redirectTo') }}</span>
                <el-input :model-value="passkeyApproveResult?.redirectTo || ''" readonly />
                <el-button @click="openLink(passkeyApproveResult?.redirectTo || '')">{{ mt('open') }}</el-button>
                <el-button @click="copyText(passkeyApproveResult?.redirectTo || '', mt('redirectTo'))">{{ mt('copy') }}</el-button>
              </div>
            </div>
          </div>

          <div class="panel-card">
            <div class="totp-head">
              <div class="totp-title">{{ mt('testResultTitle') }}</div>
            </div>
            <div class="flow-step">
              <div class="line">
                <span class="label">{{ mt('jwtToken') }}</span>
                <el-input :model-value="passkeyExchangeResult?.token || ''" readonly />
                <el-button @click="copyText(passkeyExchangeResult?.token || '', mt('jwtToken'))">{{ mt('copy') }}</el-button>
                <el-button @click="verifyPasskeyProfileWithJwt">{{ mt('verify') }}</el-button>
              </div>
            </div>
            <div class="flow-step">
              <div class="line">
                <span class="label">{{ mt('ucanToken') }}</span>
                <el-input :model-value="passkeyExchangeResult?.ucan || ''" readonly />
                <el-button @click="copyText(passkeyExchangeResult?.ucan || '', mt('ucanToken'))">{{ mt('copy') }}</el-button>
                <el-button @click="verifyPasskeyProfileWithUcan">{{ mt('verify') }}</el-button>
              </div>
            </div>
            <div class="result-json">
              <pre>{{ prettyPasskeyResult }}</pre>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="mt('totpTab')" name="totp">
        <div class="method-section">
          <div class="section-heading">{{ mt('configSection') }}</div>
          <div class="summary-grid single-grid">
            <div class="status-card">
              <div class="status-title">{{ mt('totpStatusTitle') }}</div>
              <div class="status-hint">{{ mt('totpStatusHint') }}</div>
              <div class="status-list">
                <div class="status-item">
                  <span class="status-label">{{ mt('serviceSwitch') }}</span>
                  <el-tag :type="totpStatus?.enabled ? 'success' : 'info'" effect="light">
                    {{ totpStatus ? (totpStatus.enabled ? mt('enabled') : mt('disabled')) : '-' }}
                  </el-tag>
                </div>
                <div class="status-item">
                  <span class="status-label">{{ mt('serviceReady') }}</span>
                  <el-tag :type="totpStatus?.ready ? 'success' : 'warning'" effect="light">
                    {{ totpStatus ? (totpStatus.ready ? mt('ready') : mt('notReady')) : '-' }}
                  </el-tag>
                </div>
              </div>
              <div v-if="totpStatus?.error" class="status-error">{{ mt('errorPrefix') }}{{ totpStatus.error }}</div>
            </div>
          </div>

          <div class="primary-grid">
            <div class="totp-card">
              <div class="totp-head">
                <div>
                  <div class="totp-title">{{ mt('totpProvisionTitle') }}</div>
                  <div class="section-hint">{{ mt('totpManageHint') }}</div>
                </div>
                <el-button size="small" @click="loadTotpProvision">{{ mt('loadTotpProvision') }}</el-button>
              </div>
              <div v-if="totpProvision" class="totp-body">
                <div class="totp-meta">
                  <div class="meta-item">
                    <span class="status-label">{{ mt('issuer') }}</span>
                    <span class="status-value">{{ totpProvision.issuer }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="status-label">{{ mt('accountName') }}</span>
                    <span class="status-value">{{ totpProvision.accountName }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="status-label">{{ mt('periodDigits') }}</span>
                    <span class="status-value">{{ totpProvision.period }}s / {{ totpProvision.digits }}</span>
                  </div>
                  <div class="field-line">
                    <span class="label">{{ mt('secret') }}</span>
                    <el-input :model-value="totpProvision.secret" readonly />
                    <el-button @click="copyText(totpProvision.secret, mt('totpSecretLabel'))">{{ mt('copy') }}</el-button>
                  </div>
                  <div class="field-line">
                    <span class="label">{{ mt('authenticatorLink') }}</span>
                    <el-input :model-value="totpProvision.otpauthUri" readonly />
                    <el-button @click="copyText(totpProvision.otpauthUri, mt('authenticatorUriLabel'))">{{ mt('copy') }}</el-button>
                    <el-button @click="openLink(totpProvision.otpauthUri)">{{ mt('open') }}</el-button>
                  </div>
                </div>
                <div class="qr-box">
                  <div class="label">{{ mt('qrCode') }}</div>
                  <div class="qr-panel">
                    <img v-if="totpQrDataUrl" :src="totpQrDataUrl" :alt="mt('qrAlt')" />
                    <div v-else class="qr-placeholder">{{ mt('qrPlaceholder') }}</div>
                  </div>
                </div>
              </div>
              <div v-else class="empty-text">{{ mt('totpEmptyHint') }}</div>
            </div>

            <div class="totp-card">
              <div class="totp-head">
                <div class="totp-title">{{ mt('appConfigTitle') }}</div>
                <div class="section-hint">{{ mt('appConfigHint') }}</div>
              </div>
              <div class="panel">
                <el-form label-position="top" class="config-form">
                  <div class="grid-two">
                    <el-form-item :label="mt('address')">
                      <el-input v-model="form.address" :placeholder="mt('walletAddressPlaceholder')" />
                    </el-form-item>
                    <el-form-item :label="mt('appId')">
                      <el-input v-model="form.appId" :placeholder="mt('appIdPlaceholder')" />
                    </el-form-item>
                    <el-form-item class="full" :label="mt('redirectUri')">
                      <el-input
                        v-model="form.redirectUri"
                        :placeholder="mt('redirectUriPlaceholder')"
                      />
                    </el-form-item>
                    <el-form-item :label="mt('state')">
                      <el-input v-model="form.state" :placeholder="mt('optional')" />
                    </el-form-item>
                    <el-form-item :label="mt('requestTtlMs')">
                      <el-input-number v-model="form.requestTtlMs" :min="60000" :step="30000" />
                    </el-form-item>
                  </div>
                </el-form>
                <div class="actions">
                  <el-button type="primary" @click="saveConfig">{{ mt('saveConfig') }}</el-button>
                  <el-button @click="restoreConfig">{{ mt('reloadConfig') }}</el-button>
                  <el-button type="success" @click="createAuthorizeRequest">{{ mt('createAuthorizeRequest') }}</el-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="method-section">
          <div class="section-heading">{{ mt('testSection') }}</div>
          <div class="debug-hint">{{ mt('totpTestHint') }}</div>
          <div class="panel-card">
          <div class="flow-step">
            <div class="step-title"><span class="step-dot">1</span>{{ mt('stepQueryRequest') }}</div>
            <div class="line">
              <span class="label">{{ mt('requestId') }}</span>
              <el-input v-model="requestIdInput" :placeholder="mt('requestIdPlaceholder')" />
              <el-button @click="queryAuthorizeRequest">{{ mt('query') }}</el-button>
            </div>
          </div>

          <div class="flow-step">
            <div class="step-title"><span class="step-dot">2</span>{{ mt('stepApproveWithTotp') }}</div>
            <div class="line">
              <span class="label">{{ mt('totpCode') }}</span>
              <el-input v-model="totpCode" :placeholder="mt('totpCodePlaceholder')" />
              <el-button type="success" @click="approveAuthorizeRequest">{{ mt('approveAuthorize') }}</el-button>
            </div>
          </div>

          <div class="flow-step">
            <div class="step-title"><span class="step-dot">3</span>{{ mt('stepExchangeCode') }}</div>
            <div class="line">
              <span class="label">{{ mt('authCode') }}</span>
              <el-input v-model="authCodeInput" :placeholder="mt('authCodePlaceholder')" />
              <el-button type="warning" @click="exchangeAuthorizeCode">{{ mt('exchangeToken') }}</el-button>
            </div>
          </div>

          <div class="flow-step">
            <div class="step-title"><span class="step-dot">4</span>{{ mt('stepConfirmLinks') }}</div>
            <div class="line">
              <span class="label">{{ mt('verifyUrl') }}</span>
              <el-input :model-value="requestResult?.verifyUrl || ''" readonly />
              <el-button @click="openVerifyUrl">{{ mt('open') }}</el-button>
              <el-button @click="copyText(requestResult?.verifyUrl || '', mt('verifyUrl'))">{{ mt('copy') }}</el-button>
            </div>
            <div class="line">
              <span class="label">{{ mt('redirectTo') }}</span>
              <el-input :model-value="approveResult?.redirectTo || ''" readonly />
              <el-button @click="openRedirectTo">{{ mt('open') }}</el-button>
              <el-button @click="copyText(approveResult?.redirectTo || '', mt('redirectTo'))">{{ mt('copy') }}</el-button>
            </div>
          </div>
          </div>

          <div class="panel-card">
            <div class="totp-head">
              <div class="totp-title">{{ mt('testResultTitle') }}</div>
            </div>
          <div class="flow-step">
            <div class="line">
              <span class="label">{{ mt('jwtToken') }}</span>
              <el-input :model-value="exchangeResult?.token || ''" readonly />
              <el-button @click="copyText(exchangeResult?.token || '', mt('jwtToken'))">{{ mt('copy') }}</el-button>
              <el-button @click="verifyProfileWithJwt">{{ mt('verify') }}</el-button>
            </div>
          </div>
          <div class="flow-step">
            <div class="line">
              <span class="label">{{ mt('ucanToken') }}</span>
              <el-input :model-value="exchangeResult?.ucan || ''" readonly />
              <el-button @click="copyText(exchangeResult?.ucan || '', mt('ucanToken'))">{{ mt('copy') }}</el-button>
              <el-button @click="verifyProfileWithUcan">{{ mt('verify') }}</el-button>
            </div>
          </div>
          <div class="result-json">
            <pre>{{ prettyTotpResult }}</pre>
          </div>
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
import { getLocaleRef } from '@/lang/locale';
import { notifyError, notifyInfo, notifySuccess } from '@/utils/message';
import { getMyConfigMessage, type MyConfigMessageKey } from './myConfigI18n';

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

type PasskeyStatus = {
  enabled: boolean;
  ready: boolean;
  rpId: string;
  rpName: string;
  origin: string;
  timeoutMs: number;
  challengeTtlMs: number;
  error?: string;
};

type PasskeyCredentialRecord = {
  credentialId: string;
  subject: string;
  deviceName?: string;
  transports?: string[];
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

type PasskeyRegisterRequestResult = {
  requestId: string;
  challenge: string;
  rp: {
    id: string;
    name: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout: number;
  attestation: 'none';
  excludeCredentials: Array<{
    id: string;
    type: 'public-key';
    transports?: string[];
  }>;
  authenticatorSelection?: {
    residentKey?: 'discouraged' | 'preferred' | 'required';
    userVerification?: 'discouraged' | 'preferred' | 'required';
    authenticatorAttachment?: 'platform' | 'cross-platform';
  };
};

type PasskeyAuthorizeChallengeRequest = {
  requestId: string;
  challenge: string;
  timeout: number;
  rpId: string;
  allowCredentials: Array<{
    id: string;
    type: 'public-key';
    transports?: string[];
  }>;
  userVerification?: 'discouraged' | 'preferred' | 'required';
};

type PasskeyAuthorizeChallengeResponse = {
  authorizeRequest: AuthorizeRequestResult;
  passkeyRequest: PasskeyAuthorizeChallengeRequest;
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
const locale = getLocaleRef();

function mt(key: MyConfigMessageKey): string {
  return getMyConfigMessage(locale.value, key);
}

const authTab = ref('passkey');
const totpStatus = ref<TotpStatus | null>(null);
const totpProvision = ref<TotpProvision | null>(null);
const totpQrDataUrl = ref('');
const passkeyStatus = ref<PasskeyStatus | null>(null);
const passkeyCredentials = ref<PasskeyCredentialRecord[]>([]);
const passkeyDeviceName = ref('');
const passkeyRequestResult = ref<AuthorizeRequestResult | null>(null);
const passkeyApproveResult = ref<AuthorizeApproveResult | null>(null);
const passkeyExchangeResult = ref<AuthorizeExchangeResult | null>(null);
const passkeyProfileResult = ref<ProfileResult | null>(null);
const passkeyAuthChallenge = ref<PasskeyAuthorizeChallengeResponse | null>(null);
const passkeyRequestIdInput = ref('');
const passkeyAuthCodeInput = ref('');
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
  requestTtlMs: 120000,
});

async function parseEnvelope<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let parsed: Envelope<T> | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Envelope<T>;
    } catch {
      throw new Error(`${fallbackMessage}：${text}`);
    }
  }
  if (!response.ok) {
    throw new Error(parsed?.message || `${fallbackMessage}：${response.status}`);
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

async function getBearerToken(): Promise<string> {
  const token = await getAuthToken();
  if (!token) {
    throw new Error(mt('missingLogin'));
  }
  return token;
}

async function getAuthJson<T>(path: string, fallbackMessage: string): Promise<T> {
  const token = await getBearerToken();
  const response = await fetch(apiUrl(path), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
  });
  return await parseEnvelope<T>(response, fallbackMessage);
}

async function postAuthJson<T>(path: string, body: unknown, fallbackMessage: string): Promise<T> {
  const token = await getBearerToken();
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  return await parseEnvelope<T>(response, fallbackMessage);
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Uint8Array();
  }
  const base64 = normalized.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4 || 4)) % 4);
  const raw = window.atob(base64 + padding);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function arrayBufferToBase64Url(input: ArrayBufferLike): string {
  const bytes = new Uint8Array(input);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function ensurePasskeySupported() {
  if (
    typeof window === 'undefined' ||
    typeof window.PublicKeyCredential === 'undefined' ||
    !navigator.credentials
  ) {
    throw new Error(mt('passkeyUnsupported'));
  }
}

function ensurePasskeyReady() {
  if (!passkeyStatus.value?.enabled) {
    throw new Error(mt('passkeyDisabled'));
  }
  if (!passkeyStatus.value?.ready) {
    throw new Error(mt('passkeyNotReady'));
  }
}

function ensureAddress() {
  const address = String(form.address || '').trim();
  if (!address) {
    throw new Error(mt('missingAddress'));
  }
  return address;
}

function ensureAppConfig() {
  const appId = String(form.appId || '').trim();
  const redirectUri = String(form.redirectUri || '').trim();
  if (!appId || !redirectUri) {
    throw new Error(mt('missingAppConfig'));
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
    form.requestTtlMs = Number(parsed.requestTtlMs || 120000);
  } catch {
    notifyError(mt('restoreConfigFailed'));
  }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  notifySuccess(mt('configSaved'));
}

async function loadTotpStatus() {
  try {
    totpStatus.value = await getJson<TotpStatus>(
      '/api/v1/public/auth/totp/status',
      mt('loadTotpStatusFailed')
    );
  } catch (error) {
    notifyError(String(error));
  }
}

async function loadPasskeyStatus() {
  try {
    passkeyStatus.value = await getJson<PasskeyStatus>(
      '/api/v1/public/auth/passkey/status',
      mt('loadPasskeyStatusFailed')
    );
  } catch (error) {
    notifyError(String(error));
  }
}

async function refreshStatuses() {
  await Promise.all([loadTotpStatus(), loadPasskeyStatus()]);
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
    notifyError(mt('generateQrFailed'));
  }
}

async function loadTotpProvision() {
  try {
    const token = await getBearerToken();
    const response = await fetch(apiUrl('/api/v1/public/auth/totp/totp/provision'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    totpProvision.value = await parseEnvelope<TotpProvision>(
      response,
      mt('loadTotpProvisionFailed')
    );
    await renderTotpQrCode(totpProvision.value.otpauthUri);
    notifySuccess(mt('totpProvisionLoaded'));
  } catch (error) {
    totpQrDataUrl.value = '';
    notifyError(String(error));
  }
}

async function loadPasskeyCredentials() {
  try {
    ensurePasskeyReady();
    passkeyCredentials.value = await getAuthJson<PasskeyCredentialRecord[]>(
      '/api/v1/public/auth/passkey/credentials',
      mt('loadPasskeyCredentialsFailed')
    );
  } catch (error) {
    notifyError(String(error));
  }
}

async function registerPasskey() {
  try {
    ensurePasskeyReady();
    ensurePasskeySupported();
    const request = await postAuthJson<PasskeyRegisterRequestResult>(
      '/api/v1/public/auth/passkey/register/request',
      {
        deviceName: String(passkeyDeviceName.value || '').trim() || undefined,
      },
      mt('createPasskeyRegisterFailed')
    );

    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: base64UrlToUint8Array(request.challenge),
      rp: request.rp,
      user: {
        id: base64UrlToUint8Array(request.user.id),
        name: request.user.name,
        displayName: request.user.displayName,
      },
      pubKeyCredParams: request.pubKeyCredParams,
      timeout: request.timeout,
      attestation: request.attestation,
      excludeCredentials: (request.excludeCredentials || []).map((item) => ({
        id: base64UrlToUint8Array(item.id),
        type: item.type,
        transports: item.transports as AuthenticatorTransport[] | undefined,
      })),
      authenticatorSelection: request.authenticatorSelection,
    };

    const credential = (await navigator.credentials.create({
      publicKey,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error(mt('passkeyRegisterCancelled'));
    }

    const response = credential.response;
    if (!(response instanceof AuthenticatorAttestationResponse)) {
      throw new Error(mt('passkeyRegisterResponseInvalid'));
    }

    const transports =
      typeof response.getTransports === 'function' ? response.getTransports() : undefined;

    await postAuthJson<PasskeyCredentialRecord>(
      '/api/v1/public/auth/passkey/register/confirm',
      {
        requestId: request.requestId,
        deviceName: String(passkeyDeviceName.value || '').trim() || undefined,
        credential: {
          id: credential.id,
          rawId: arrayBufferToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            attestationObject: arrayBufferToBase64Url(response.attestationObject),
            clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
            transports,
          },
          clientExtensionResults: credential.getClientExtensionResults(),
        },
      },
      mt('confirmPasskeyRegisterFailed')
    );

    await loadPasskeyCredentials();
    notifySuccess(mt('passkeyRegisterSuccess'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function createPasskeyAuthorizeRequestAction() {
  try {
    ensurePasskeyReady();
    ensurePasskeySupported();
    const address = ensureAddress();
    const { appId, redirectUri } = ensureAppConfig();
    const result = await postJson<AuthorizeRequestResult>(
      '/api/v1/public/auth/passkey/authorize/request',
      {
        address,
        appId,
        redirectUri,
        state: form.state || undefined,
        requestTtlMs: form.requestTtlMs,
      },
      mt('createPasskeyAuthorizeRequestFailed')
    );
    passkeyRequestResult.value = result;
    passkeyRequestIdInput.value = result.requestId;
    passkeyApproveResult.value = null;
    passkeyExchangeResult.value = null;
    passkeyProfileResult.value = null;
    passkeyAuthChallenge.value = null;
    notifySuccess(mt('passkeyAuthorizeRequestCreated'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function queryPasskeyAuthorizeRequest() {
  try {
    ensurePasskeyReady();
    const requestId = String(passkeyRequestIdInput.value || '').trim();
    if (!requestId) {
      notifyError(mt('enterPasskeyRequestIdFirst'));
      return;
    }
    const result = await getJson<AuthorizeRequestResult>(
      `/api/v1/public/auth/passkey/authorize/request/${encodeURIComponent(requestId)}`,
      mt('queryPasskeyAuthorizeRequestFailed')
    );
    passkeyRequestResult.value = result;
    notifySuccess(mt('passkeyAuthorizeRequestRefreshed'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function approveAuthorizeRequestWithPasskey() {
  try {
    ensurePasskeyReady();
    ensurePasskeySupported();
    const requestId = String(passkeyRequestIdInput.value || '').trim();
    if (!requestId) {
      notifyError(mt('createOrEnterPasskeyRequestFirst'));
      return;
    }

    const challenge = await postJson<PasskeyAuthorizeChallengeResponse>(
      '/api/v1/public/auth/passkey/authorize/challenge',
      { requestId },
      mt('createPasskeyChallengeFailed')
    );
    passkeyAuthChallenge.value = challenge;

    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: base64UrlToUint8Array(challenge.passkeyRequest.challenge),
      rpId: challenge.passkeyRequest.rpId,
      timeout: challenge.passkeyRequest.timeout,
      allowCredentials: (challenge.passkeyRequest.allowCredentials || []).map((item) => ({
        id: base64UrlToUint8Array(item.id),
        type: item.type,
        transports: item.transports as AuthenticatorTransport[] | undefined,
      })),
      userVerification: challenge.passkeyRequest.userVerification,
    };

    const credential = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null;
    if (!credential) {
      throw new Error(mt('passkeyAuthorizeCancelled'));
    }

    const response = credential.response;
    if (!(response instanceof AuthenticatorAssertionResponse)) {
      throw new Error(mt('passkeyAuthorizeResponseInvalid'));
    }

    const result = await postJson<AuthorizeApproveResult>(
      '/api/v1/public/auth/passkey/authorize/approve',
      {
        requestId,
        passkeyRequestId: challenge.passkeyRequest.requestId,
        credential: {
          id: credential.id,
          rawId: arrayBufferToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
            clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
            signature: arrayBufferToBase64Url(response.signature),
            userHandle: response.userHandle
              ? arrayBufferToBase64Url(response.userHandle)
              : undefined,
          },
          clientExtensionResults: credential.getClientExtensionResults(),
        },
      },
      mt('passkeyAuthorizeFailed')
    );

    passkeyApproveResult.value = result;
    passkeyAuthCodeInput.value = result.authorizationCode;
    passkeyExchangeResult.value = null;
    passkeyProfileResult.value = null;
    notifySuccess(mt('passkeyAuthorizeApproved'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function exchangePasskeyAuthorizeCode() {
  try {
    ensurePasskeyReady();
    const code = String(passkeyAuthCodeInput.value || '').trim();
    const { appId, redirectUri } = ensureAppConfig();
    if (!code) {
      notifyError(mt('enterPasskeyAuthCode'));
      return;
    }
    const result = await postJson<AuthorizeExchangeResult>(
      '/api/v1/public/auth/passkey/authorize/exchange',
      { code, appId, redirectUri },
      mt('exchangePasskeyCodeFailed')
    );
    passkeyExchangeResult.value = result;
    passkeyProfileResult.value = null;
    notifySuccess(mt('passkeyCodeExchanged'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function revokePasskeyCredentialAction(credentialId: string) {
  try {
    ensurePasskeyReady();
    await postAuthJson(
      '/api/v1/public/auth/passkey/credentials/revoke',
      { credentialId },
      mt('revokePasskeyCredentialFailed')
    );
    await loadPasskeyCredentials();
    notifySuccess(mt('passkeyCredentialRevoked'));
  } catch (error) {
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
      mt('createAuthorizeRequestFailed')
    );
    requestResult.value = result;
    requestIdInput.value = result.requestId;
    approveResult.value = null;
    exchangeResult.value = null;
    profileResult.value = null;
    notifySuccess(mt('authorizeRequestCreated'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function queryAuthorizeRequest() {
  try {
    const requestId = String(requestIdInput.value || '').trim();
    if (!requestId) {
      notifyError(mt('enterRequestIdFirst'));
      return;
    }
    const result = await getJson<AuthorizeRequestResult>(
      `/api/v1/public/auth/totp/authorize/request/${encodeURIComponent(requestId)}`,
      mt('queryAuthorizeRequestFailed')
    );
    requestResult.value = result;
    notifySuccess(mt('authorizeRequestRefreshed'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function approveAuthorizeRequest() {
  try {
    const requestId = String(requestIdInput.value || '').trim();
    const code = String(totpCode.value || '').trim();
    if (!requestId || !code) {
      notifyError(mt('fillRequestIdAndTotpCode'));
      return;
    }
    const result = await postJson<AuthorizeApproveResult>(
      '/api/v1/public/auth/totp/authorize/approve',
      { requestId, code },
      mt('totpAuthorizeFailed')
    );
    approveResult.value = result;
    authCodeInput.value = result.authorizationCode;
    exchangeResult.value = null;
    profileResult.value = null;
    notifySuccess(mt('authorizeApproved'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function exchangeAuthorizeCode() {
  try {
    const code = String(authCodeInput.value || '').trim();
    const { appId, redirectUri } = ensureAppConfig();
    if (!code) {
      notifyError(mt('enterAuthorizationCode'));
      return;
    }
    const result = await postJson<AuthorizeExchangeResult>(
      '/api/v1/public/auth/totp/authorize/exchange',
      { code, appId, redirectUri },
      mt('exchangeAuthorizeCodeFailed')
    );
    exchangeResult.value = result;
    profileResult.value = null;
    notifySuccess(mt('authorizeCodeExchanged'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function verifyProfileWithJwt() {
  try {
    const token = exchangeResult.value?.token;
    if (!token) {
      notifyError(mt('missingJwtToken'));
      return;
    }
    const response = await fetch(apiUrl('/api/v1/public/profile/me'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    profileResult.value = await parseEnvelope<ProfileResult>(response, mt('verifyJwtFailed'));
    notifySuccess(mt('verifyJwtSuccess'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function verifyProfileWithUcan() {
  try {
    const token = exchangeResult.value?.ucan;
    if (!token) {
      notifyError(mt('missingUcanToken'));
      return;
    }
    const response = await fetch(apiUrl('/api/v1/public/profile/me'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    profileResult.value = await parseEnvelope<ProfileResult>(response, mt('verifyUcanFailed'));
    notifySuccess(mt('verifyUcanSuccess'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function verifyPasskeyProfileWithJwt() {
  try {
    const token = passkeyExchangeResult.value?.token;
    if (!token) {
      notifyError(mt('missingJwtToken'));
      return;
    }
    const response = await fetch(apiUrl('/api/v1/public/profile/me'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    passkeyProfileResult.value = await parseEnvelope<ProfileResult>(response, mt('verifyJwtFailed'));
    notifySuccess(mt('verifyJwtSuccess'));
  } catch (error) {
    notifyError(String(error));
  }
}

async function verifyPasskeyProfileWithUcan() {
  try {
    const token = passkeyExchangeResult.value?.ucan;
    if (!token) {
      notifyError(mt('missingUcanToken'));
      return;
    }
    const response = await fetch(apiUrl('/api/v1/public/profile/me'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
    });
    passkeyProfileResult.value = await parseEnvelope<ProfileResult>(response, mt('verifyUcanFailed'));
    notifySuccess(mt('verifyUcanSuccess'));
  } catch (error) {
    notifyError(String(error));
  }
}

function openLink(url: string) {
  if (!url) {
    notifyInfo(mt('nothingToOpen'));
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

async function writeClipboardText(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized);
    return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = normalized;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

async function copyText(value: string, label: string) {
  if (!value) {
    notifyInfo(`${mt('nothingToCopy')} ${label}`);
    return;
  }
  try {
    const copied = await writeClipboardText(value);
    if (!copied) {
      const suffix = mt('copyFailedSuffix');
      notifyError(`${mt('copyFailedPrefix')} ${label}${suffix ? ` ${suffix}` : ''}`);
      return;
    }
    notifySuccess(`${label} ${mt('copiedSuffix')}`);
  } catch {
    const suffix = mt('copyFailedSuffix');
    notifyError(`${mt('copyFailedPrefix')} ${label}${suffix ? ` ${suffix}` : ''}`);
  }
}

const prettyTotpResult = computed(() => {
  const payload = {
    request: requestResult.value,
    approve: approveResult.value,
    exchange: exchangeResult.value,
    profile: profileResult.value,
  };
  return JSON.stringify(payload, null, 2);
});

const prettyPasskeyResult = computed(() => {
  const payload = {
    passkeyStatus: passkeyStatus.value,
    passkeyCredentials: passkeyCredentials.value,
    passkeyRequest: passkeyRequestResult.value,
    passkeyChallenge: passkeyAuthChallenge.value,
    passkeyApprove: passkeyApproveResult.value,
    passkeyExchange: passkeyExchangeResult.value,
    passkeyProfile: passkeyProfileResult.value,
  };
  return JSON.stringify(payload, null, 2);
});

onMounted(async () => {
  restoreConfig();
  await refreshStatuses();
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

  .page-subtitle {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(0, 0, 0, 0.5);
  }

  .head-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .summary-grid {
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .status-card {
    padding: 16px;
    background: #fff;
    border: 1px solid #e8edf4;
    border-radius: 10px;
  }

  .status-title {
    font-size: 15px;
    font-weight: 500;
    margin-bottom: 6px;
    color: rgba(0, 0, 0, 0.86);
  }

  .status-hint {
    margin-bottom: 12px;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(0, 0, 0, 0.5);
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
    padding: 16px;
    border: 1px solid #e8edf4;
    border-radius: 10px;
    background: #fff;
  }

  .primary-grid {
    margin-top: 14px;
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.25fr);
    gap: 14px;
    align-items: start;
  }

  .passkey-card {
    min-height: 100%;
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

  .page-tabs {
    margin-top: 14px;
    border: 1px solid #e8edf4;
    border-radius: 10px;
    background: #fff;
    padding: 0 16px 16px;
  }

  .page-tabs :deep(.el-tabs__header) {
    margin-bottom: 0;
  }

  .page-tabs :deep(.el-tabs__nav-wrap::after) {
    background-color: #eef2f7;
  }

  .page-tabs :deep(.el-tabs__item) {
    height: 48px;
    line-height: 48px;
  }

  .method-section {
    padding-top: 14px;
  }

  .method-section + .method-section {
    margin-top: 10px;
  }

  .section-heading {
    margin-bottom: 12px;
    font-size: 15px;
    line-height: 1.4;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.84);
  }

  .section-hint {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(0, 0, 0, 0.5);
  }

  .single-grid {
    grid-template-columns: 1fr;
  }

  .config-tabs {
    background: #fff;
    padding: 4px 2px 0;
  }

  .debug-panel {
    padding-top: 12px;
  }

  .debug-hint {
    margin-top: 12px;
    margin-bottom: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(0, 0, 0, 0.5);
  }

  .passkey-actions {
    display: grid;
    gap: 12px;
  }

  .passkey-list {
    margin-top: 14px;
    display: grid;
    gap: 12px;
  }

  .credential-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  .credential-name {
    font-size: 14px;
    line-height: 1.45;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.82);
  }

  .compact-list {
    gap: 8px;
  }

  .empty-text {
    font-size: 14px;
    line-height: 1.5;
    color: rgba(0, 0, 0, 0.45);
  }

  .panel {
    padding: 8px 2px 12px;
  }

  .panel-card {
    padding: 16px;
    border: 1px solid #e8edf4;
    border-radius: 10px;
    background: #fff;
  }

  .panel-card + .panel-card {
    margin-top: 14px;
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
    .primary-grid {
      grid-template-columns: 1fr;
    }

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

    .summary-grid {
      grid-template-columns: 1fr;
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
