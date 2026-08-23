<template>
  <div class="passkey-history">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>{{ label('登录配置', 'Login Config') }}</el-breadcrumb-item>
      <el-breadcrumb-item>{{ label('通行证测试历史', 'Passkey Test History') }}</el-breadcrumb-item>
    </el-breadcrumb>

    <div class="history-head">
      <div>
        <div class="history-title">{{ label('通行证测试历史', 'Passkey Test History') }}</div>
        <div class="history-subtitle">{{ label('查看最近的通行证登录测试记录和步骤详情。', 'Review recent passkey login test records and step details.') }}</div>
      </div>
      <div class="history-actions">
        <el-button @click="goBack">{{ label('返回通行证', 'Back') }}</el-button>
        <el-button :disabled="!records.length" type="danger" plain @click="clearHistory">{{ label('清空记录', 'Clear') }}</el-button>
      </div>
    </div>

    <div class="history-layout">
      <div class="record-list">
        <div v-if="!records.length" class="empty-records">{{ label('暂无测试记录', 'No test records yet') }}</div>
        <button
          v-for="record in records"
          :key="record.id"
          type="button"
          class="record-item"
          :class="{ active: selectedRecord?.id === record.id }"
          @click="selectedId = record.id"
        >
          <div class="record-main">
            <span class="record-action">{{ actionLabel(record.action) }}</span>
            <el-tag :type="record.status === 'success' ? 'success' : 'danger'" effect="light" size="small">
              {{ record.status === 'success' ? label('成功', 'Success') : label('失败', 'Failed') }}
            </el-tag>
          </div>
          <div class="record-meta">{{ record.createdAt }}</div>
          <div class="record-meta mono">{{ record.requestId || '-' }}</div>
        </button>
      </div>

      <div class="record-detail">
        <div v-if="!selectedRecord" class="empty-records">{{ label('选择一条记录查看详情', 'Select a record to inspect details') }}</div>
        <template v-else>
          <div class="detail-head">
            <div>
              <div class="detail-title">{{ actionLabel(selectedRecord.action) }}</div>
              <div class="record-meta">{{ selectedRecord.createdAt }}</div>
            </div>
            <el-tag :type="selectedRecord.status === 'success' ? 'success' : 'danger'" effect="light">
              {{ selectedRecord.status === 'success' ? label('成功', 'Success') : label('失败', 'Failed') }}
            </el-tag>
          </div>
          <div class="detail-grid">
            <div><span>{{ label('应用', 'App') }}</span><strong>{{ selectedRecord.appId || '-' }}</strong></div>
            <div><span>{{ label('请求', 'Request') }}</span><strong>{{ selectedRecord.requestId || '-' }}</strong></div>
            <div><span>{{ label('钱包身份 DID', 'Wallet Identity DID') }}</span><strong>{{ selectedRecord.did || '-' }}</strong></div>
            <div><span>{{ label('已验证钱包', 'Verified Wallet') }}</span><strong>{{ selectedRecord.walletAddress || '-' }}</strong></div>
          </div>
          <pre class="detail-json">{{ JSON.stringify(selectedRecord.detail, null, 2) }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getLocaleRef } from '@/lang/locale';

const HISTORY_KEY = 'identity:passkey:test-history';

type PasskeyTestHistoryRecord = {
  id: string;
  action: string;
  status: 'success' | 'failed';
  createdAt: string;
  appId?: string;
  requestId?: string;
  did?: string;
  walletAddress?: string;
  detail: Record<string, unknown>;
};

const router = useRouter();
const locale = getLocaleRef();
const records = ref<PasskeyTestHistoryRecord[]>([]);
const selectedId = ref('');

function label(zh: string, en: string) {
  return locale.value === 'zh-CN' ? zh : en;
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY) || '[]';
    const parsed = JSON.parse(raw);
    records.value = Array.isArray(parsed) ? parsed : [];
    selectedId.value = records.value[0]?.id || '';
  } catch {
    records.value = [];
    selectedId.value = '';
  }
}

const selectedRecord = computed(() => records.value.find((item) => item.id === selectedId.value) || null);

function actionLabel(action: string) {
  const map: Record<string, string> = {
    create_request: label('创建登录请求', 'Create request'),
    approve_passkey: label('调用通行证', 'Approve with passkey'),
    exchange_code: label('换取登录结果', 'Exchange code'),
    verify_jwt: label('检查登录令牌', 'Verify JWT'),
    verify_ucan: label('检查访问令牌', 'Verify UCAN'),
  };
  return map[action] || action;
}

function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  loadHistory();
}

function goBack() {
  router.push('/market/dev/my-config/').catch(() => undefined);
}

onMounted(loadHistory);
</script>

<style scoped lang="less">
.passkey-history {
  margin: 20px;
}

.history-head {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid #e8edf4;
  border-radius: 10px;
  background: #fff;
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.history-title {
  font-size: 18px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.86);
}

.history-subtitle,
.record-meta {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.5);
}

.history-actions {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.history-layout {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 14px;
}

.record-list,
.record-detail {
  min-height: 460px;
  padding: 14px;
  border: 1px solid #e8edf4;
  border-radius: 10px;
  background: #fff;
}

.record-list {
  display: grid;
  align-content: start;
  gap: 10px;
}

.record-item {
  width: 100%;
  text-align: left;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fafcff;
  padding: 12px;
  cursor: pointer;
}

.record-item.active {
  border-color: #1677ff;
  background: #f0f7ff;
}

.record-main,
.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.record-action,
.detail-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.84);
}

.mono {
  font-family: var(--app-font-mono);
  word-break: break-all;
}

.empty-records {
  color: rgba(0, 0, 0, 0.45);
  font-size: 14px;
}

.detail-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-grid div {
  padding: 10px;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fafcff;
  display: grid;
  gap: 6px;
}

.detail-grid span {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.5);
}

.detail-grid strong {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.82);
  word-break: break-all;
}

.detail-json {
  margin-top: 14px;
  max-height: 520px;
  overflow: auto;
  border: 1px solid #edf1f7;
  border-radius: 8px;
  background: #fafafa;
  padding: 12px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 980px) {
  .history-head,
  .history-actions {
    flex-direction: column;
  }

  .history-layout,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
