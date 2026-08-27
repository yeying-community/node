<template>
  <div class="my-config">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>{{ mt('breadcrumb') }}</el-breadcrumb-item>
    </el-breadcrumb>

    <div class="identity-main-card wallet-identity-card">
      <div class="identity-card-head">
        <div>
          <div class="identity-title-row">
            <span>{{ mt('walletIdentityCardTitle') }}</span>
            <span class="identity-status" :class="{ verified: Boolean(authProfile?.address) }">
              {{ authProfile?.address ? mt('verified') : mt('notVerified') }}
            </span>
          </div>
          <div class="section-hint">{{ mt('walletIdentityHint') }}</div>
        </div>
      </div>

      <div class="security-summary-grid wallet-summary-grid">
        <div class="summary-identity">
          <span class="summary-label">{{ mt('walletAddress') }}</span>
          <span class="path-text">{{ authProfile?.address || '-' }}</span>
        </div>
        <div class="summary-identity">
          <span class="summary-label">{{ mt('authMethod') }}</span>
          <span>{{ authMethodLabel }}</span>
        </div>
        <div class="summary-identity">
          <span class="summary-label">{{ mt('authSource') }}</span>
          <span>{{ authSourceLabel }}</span>
        </div>
        <div class="summary-identity">
          <span class="summary-label">{{ mt('issuer') }}</span>
          <span class="path-text">{{ authProfile?.issuer || '-' }}</span>
        </div>
      </div>
    </div>

    <div class="security-card-grid">
      <div class="identity-main-card security-card">
        <div class="identity-card-head">
          <div>
            <div class="identity-title-row">
              <span>{{ mt('passkeyCardTitle') }}</span>
            </div>
            <div class="section-hint">{{ mt('passkeyManageHint') }}</div>
          </div>
          <div class="identity-head-actions">
            <el-button type="primary" @click="registerPasskey">{{ mt('manageInWallet') }}</el-button>
          </div>
        </div>

        <div v-if="passkeyStatus?.error" class="status-error compact-error">{{ mt('errorPrefix') }}{{ passkeyStatus.error }}</div>

        <div class="security-summary-grid">
          <div class="summary-metric">
            <span class="summary-label">{{ mt('serviceStatus') }}</span>
            <strong :class="passkeyServiceStatus.className">{{ passkeyServiceStatus.label }}</strong>
          </div>
          <div class="summary-metric">
            <span class="summary-label">{{ mt('serviceConfig') }}</span>
            <strong>{{ passkeyConfigSummary }}</strong>
          </div>
          <div class="summary-identity">
            <span class="summary-label">{{ mt('rpId') }}</span>
            <span>{{ passkeyStatus?.rpId || '-' }}</span>
          </div>
          <div class="summary-identity">
            <span class="summary-label">{{ mt('origin') }}</span>
            <span class="path-text">{{ passkeyStatus?.origin || '-' }}</span>
          </div>
        </div>
      </div>

      <div class="identity-main-card security-card">
        <div class="identity-card-head">
          <div>
            <div class="identity-title-row">
              <span>{{ mt('authenticatorCardTitle') }}</span>
            </div>
            <div class="section-hint">{{ mt('authenticatorManageHint') }}</div>
          </div>
          <div class="identity-head-actions">
            <el-button type="primary" @click="manageAuthenticatorInWallet">{{ mt('manageInWallet') }}</el-button>
          </div>
        </div>

        <div v-if="totpStatus?.error" class="status-error compact-error">{{ mt('errorPrefix') }}{{ totpStatus.error }}</div>

        <div class="security-summary-grid">
          <div class="summary-metric">
            <span class="summary-label">{{ mt('serviceStatus') }}</span>
            <strong :class="totpServiceStatus.className">{{ totpServiceStatus.label }}</strong>
          </div>
          <div class="summary-metric">
            <span class="summary-label">{{ mt('serviceConfig') }}</span>
            <strong>{{ totpConfigSummary }}</strong>
          </div>
          <div class="summary-identity">
            <span class="summary-label">{{ mt('totpIssuer') }}</span>
            <span>{{ totpStatus?.issuerName || '-' }}</span>
          </div>
          <div class="summary-identity">
            <span class="summary-label">{{ mt('periodDigits') }}</span>
            <span>{{ totpPeriodDigits }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiUrl } from '@/plugins/api';
import { getLocaleRef } from '@/lang/locale';
import { getVerifiedAuthProfile } from '@/plugins/auth';
import { notifyError, notifyInfo } from '@/utils/message';
import { getMyConfigMessage, type MyConfigMessageKey } from './myConfigI18n';

type Envelope<T> = {
  code: number;
  message: string;
  data: T;
  timestamp: number;
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

type TotpStatus = {
  enabled: boolean;
  ready: boolean;
  issuerName: string;
  digits: number;
  period: number;
  algorithm: string;
  error?: string;
};

type AuthProfile = {
  address: string;
  issuer?: string;
  ucanSource?: 'wallet' | 'central';
  authType?: 'jwt' | 'ucan';
};

const locale = getLocaleRef();

function mt(key: MyConfigMessageKey): string {
  return getMyConfigMessage(locale.value, key);
}

const passkeyStatus = ref<PasskeyStatus | null>(null);
const totpStatus = ref<TotpStatus | null>(null);
const authProfile = ref<AuthProfile | null>(null);

const authMethodLabel = computed(() => {
  if (!authProfile.value?.authType) return '-';
  return authProfile.value.authType === 'jwt' ? 'SIWE' : 'UCAN';
});

const authSourceLabel = computed(() => {
  if (!authProfile.value?.authType) return '-';
  if (authProfile.value.authType === 'jwt') return 'wallet';
  return authProfile.value.ucanSource || '-';
});

const totpPeriodDigits = computed(() => {
  if (!totpStatus.value) return '-';
  return `${totpStatus.value.period || '-'}s / ${totpStatus.value.digits || '-'}`;
});

const passkeyServiceStatus = computed(() => {
  if (!passkeyStatus.value) {
    return { label: '-', className: 'status-muted' };
  }
  if (!passkeyStatus.value.enabled) {
    return { label: mt('statusDisabled'), className: 'status-muted' };
  }
  if (!passkeyStatus.value.ready) {
    return { label: mt('statusConfigError'), className: 'status-warning' };
  }
  return { label: mt('statusAvailable'), className: 'status-success' };
});

const totpServiceStatus = computed(() => {
  if (!totpStatus.value) {
    return { label: '-', className: 'status-muted' };
  }
  if (!totpStatus.value.ready) {
    return { label: mt('statusConfigError'), className: 'status-warning' };
  }
  return { label: mt('statusAvailable'), className: 'status-success' };
});

const passkeyConfigSummary = computed(() => {
  if (!passkeyStatus.value) return '-';
  if (!passkeyStatus.value.enabled) return mt('configNotEnabled');
  return passkeyStatus.value.ready ? mt('configComplete') : mt('configIncomplete');
});

const totpConfigSummary = computed(() => {
  if (!totpStatus.value) return '-';
  return totpStatus.value.ready ? mt('configComplete') : mt('configIncomplete');
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

async function loadPasskeyStatus() {
  try {
    const status = await getJson<{ passkey: PasskeyStatus; totp: TotpStatus }>(
      '/api/v1/public/identity/status',
      mt('loadPasskeyStatusFailed')
    );
    passkeyStatus.value = status.passkey;
    totpStatus.value = status.totp;
  } catch (error) {
    notifyError(String(error));
  }
}

async function loadAuthProfile() {
  try {
    authProfile.value = await getVerifiedAuthProfile();
  } catch (error) {
    notifyError(`${mt('loadProfileFailed')}：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function registerPasskey() {
  notifyInfo(mt('passkeyManagedInWallet'));
}

async function manageAuthenticatorInWallet() {
  notifyInfo(mt('authenticatorManagedInWallet'));
}

onMounted(async () => {
  await Promise.all([loadAuthProfile(), loadPasskeyStatus()]);
});
</script>

<style scoped lang="less">
.my-config {
  margin: 20px;

  .security-card-grid {
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    align-items: stretch;
  }

  .wallet-identity-card {
    margin-top: 14px;
  }

  .wallet-summary-grid {
    grid-template-columns: minmax(260px, 2fr) repeat(3, minmax(140px, 1fr));
  }

  .security-card {
    min-height: 100%;
  }

  .identity-main-card {
    padding: 18px;
    border: 1px solid #e8edf4;
    border-radius: 10px;
    background: #fff;
  }

  .identity-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .identity-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 16px;
    line-height: 1.4;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.88);
  }

  .identity-status {
    padding: 2px 8px;
    border-radius: 999px;
    background: #f3f4f6;
    color: rgba(0, 0, 0, 0.52);
    font-size: 12px;
    line-height: 1.5;
    font-weight: 500;
  }

  .identity-status.verified {
    background: #ecfdf3;
    color: #15803d;
  }

  .identity-head-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
  }

  .section-hint {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(0, 0, 0, 0.5);
  }

  .status-error {
    margin-top: 8px;
    color: #d93026;
    font-size: 14px;
    line-height: 1.5;
  }

  .compact-error {
    margin-top: -2px;
    margin-bottom: 12px;
  }

  .security-summary-grid {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .summary-metric,
  .summary-identity {
    min-height: 72px;
    padding: 12px;
    border: 1px solid #e9eef6;
    border-radius: 8px;
    background: #fafcff;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    min-width: 0;
  }

  .summary-metric strong {
    font-size: 24px;
    line-height: 1;
    color: #111827;
  }

  .summary-metric strong.status-success {
    color: #15803d;
  }

  .summary-metric strong.status-warning {
    color: #b45309;
  }

  .summary-metric strong.status-muted {
    color: rgba(0, 0, 0, 0.48);
  }

  .summary-label {
    font-size: 12px;
    line-height: 1.4;
    color: rgba(0, 0, 0, 0.52);
  }

  .path-text {
    font-family: var(--app-font-mono);
    font-size: 13px;
    word-break: break-all;
  }
}

@media (max-width: 1200px) {
  .my-config {
    .wallet-summary-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .security-card-grid {
      grid-template-columns: 1fr;
    }
  }
}

@media (max-width: 980px) {
  .my-config {
    .identity-card-head {
      flex-direction: column;
      align-items: flex-start;
    }

    .security-summary-grid {
      grid-template-columns: 1fr;
    }

    .wallet-summary-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
