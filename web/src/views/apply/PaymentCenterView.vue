<template>
  <div class="payment-shell">
    <Header />
    <main class="payment-page">
    <div class="page-heading">
      <div>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>{{ $t('payment_page_breadcrumb') }}</el-breadcrumb-item>
        </el-breadcrumb>
        <h1>{{ $t('payment_page_title') }}</h1>
        <p>{{ $t('payment_page_subtitle') }}</p>
      </div>
      <div class="heading-actions">
        <el-button @click="goDeveloperCenter">{{ $t('payment_back_developer') }}</el-button>
        <el-button :icon="Refresh" :loading="loadingMerchants" @click="loadMerchants">
          {{ $t('payment_reload') }}
        </el-button>
      </div>
    </div>

    <el-alert
      class="live-warning"
      type="warning"
      :title="$t('payment_live_warning')"
      :closable="false"
      show-icon
    />

    <section class="page-section merchant-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">01</span>
          <h2>{{ $t('payment_merchants_title') }}</h2>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreateMerchant">
          {{ $t('payment_create_merchant') }}
        </el-button>
      </div>

      <div v-if="loadingMerchants" class="section-empty">{{ $t('header_notification_loading') }}</div>
      <div v-else-if="merchants.length === 0" class="section-empty empty-action">
        <el-icon :size="30"><Wallet /></el-icon>
        <strong>{{ $t('payment_merchant_empty') }}</strong>
        <span>{{ $t('payment_merchant_empty_hint') }}</span>
        <el-button type="primary" plain @click="openCreateMerchant">{{ $t('payment_create_merchant') }}</el-button>
      </div>
      <el-table v-else :data="merchants" class="merchant-table" row-key="merchantId">
        <el-table-column prop="name" :label="$t('payment_merchant_name')" min-width="180" />
        <el-table-column prop="merchantId" label="Merchant ID" min-width="230">
          <template #default="scope"><code>{{ scope.row.merchantId }}</code></template>
        </el-table-column>
        <el-table-column prop="callbackUrl" :label="$t('payment_callback_url')" min-width="260" show-overflow-tooltip />
        <el-table-column :label="$t('payment_status')" width="110">
          <template #default="scope">
            <el-tag size="small" :type="scope.row.status === 'active' ? 'success' : 'info'">
              {{ scope.row.status === 'active' ? $t('payment_merchant_status_active') : $t('payment_merchant_status_disabled') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('payment_merchant_secret')" width="150">
          <template #default="scope"><code>{{ scope.row.secretMasked || '-' }}</code></template>
        </el-table-column>
        <el-table-column :label="$t('payment_status')" width="110" fixed="right">
          <template #default="scope">
            <el-button
              v-if="scope.row.status === 'active'"
              link
              type="danger"
              @click="disableMerchant(scope.row)"
            >{{ $t('payment_disable') }}</el-button>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-alert
      v-if="newSecret"
      class="secret-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="$t('payment_secret_once_title')"
    >
      <p>{{ $t('payment_secret_once_desc') }}</p>
      <div class="secret-row">
        <code>{{ newSecret }}</code>
        <el-button text type="primary" :icon="CopyDocument" @click="copySecret(newSecret)">{{ $t('payment_copy') }}</el-button>
      </div>
    </el-alert>

    <section class="page-section test-section">
      <div class="section-heading">
        <div>
          <span class="section-kicker">02</span>
          <h2>{{ $t('payment_test_title') }}</h2>
          <p>{{ $t('payment_test_subtitle') }}</p>
        </div>
      </div>

      <div class="test-layout">
        <el-form class="test-form" label-position="top" @submit.prevent="createTransaction">
          <el-form-item :label="$t('payment_select_merchant')" required>
            <el-select v-model="testForm.merchantId" :placeholder="$t('payment_choose_merchant')" class="wide-control" @change="onMerchantChange">
              <el-option
                v-for="merchant in activeMerchants"
                :key="merchant.merchantId"
                :label="`${merchant.name} · ${merchant.merchantId}`"
                :value="merchant.merchantId"
              />
            </el-select>
          </el-form-item>
          <el-form-item :label="$t('payment_secret_input')" required>
            <el-input v-model="testForm.secret" type="password" show-password :placeholder="$t('payment_secret_input_placeholder')" autocomplete="off" />
          </el-form-item>
          <div class="form-grid">
            <el-form-item :label="$t('payment_amount_minor')" required>
              <el-input v-model="testForm.amountMinor" inputmode="numeric" />
            </el-form-item>
            <el-form-item :label="$t('payment_client_type')" required>
              <el-radio-group v-model="testForm.clientType">
                <el-radio-button value="native">{{ $t('payment_native') }}</el-radio-button>
                <el-radio-button value="h5">{{ $t('payment_h5') }}</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </div>
          <el-form-item :label="$t('payment_description')" required>
            <el-input v-model="testForm.description" :placeholder="$t('payment_description_placeholder')" maxlength="127" />
          </el-form-item>
          <el-form-item v-if="testForm.clientType === 'h5'" :label="$t('payment_return_url')" required>
            <el-input v-model="testForm.returnUrl" :placeholder="$t('payment_return_url_placeholder')" />
          </el-form-item>
          <el-button type="primary" :loading="creatingTransaction" :disabled="!canCreateTransaction" native-type="submit">
            {{ creatingTransaction ? $t('payment_starting') : $t('payment_start') }}
          </el-button>
          <p class="security-note">{{ $t('payment_integration_note') }}</p>
        </el-form>

        <div class="transaction-panel">
          <div v-if="!transaction" class="transaction-empty">
            <el-icon :size="32"><Connection /></el-icon>
            <span>{{ $t('payment_merchant_empty_hint') }}</span>
          </div>
          <template v-else>
            <div class="transaction-head">
              <div>
                <span class="section-kicker">{{ $t('payment_transaction') }}</span>
                <h3>{{ transaction.externalOrderId }}</h3>
              </div>
              <el-tag :type="statusTagType(transaction.status)">{{ statusLabel(transaction.status) }}</el-tag>
            </div>
            <div class="transaction-meta">
              <div><span>{{ $t('payment_order_id') }}</span><code>{{ transaction.tradeNo }}</code></div>
              <div><span>{{ $t('payment_external_order_id') }}</span><strong>{{ transaction.externalOrderId }}</strong></div>
              <div><span>{{ $t('payment_amount_minor') }}</span><strong>{{ transaction.amountMinor }} fen</strong></div>
            </div>
            <div v-if="qrDataUrl" class="qr-block">
              <img :src="qrDataUrl" alt="WeChat payment QR code" />
              <span>{{ $t('payment_native') }}</span>
            </div>
            <el-button v-if="transaction.paymentUrl" link type="primary" @click="openPaymentUrl">
              {{ $t('payment_open_pay') }}
            </el-button>
            <div class="transaction-actions">
              <el-button :icon="Refresh" :loading="queryingTransaction" @click="queryTransaction">{{ $t('payment_check_status') }}</el-button>
              <el-button v-if="transaction.status === 'pending'" type="warning" plain :loading="cancellingTransaction" @click="cancelTransaction">{{ $t('payment_cancel_order') }}</el-button>
              <el-button v-if="canRefund" type="danger" plain @click="openRefund">{{ $t('payment_refund') }}</el-button>
            </div>
            <div v-if="refund" class="refund-summary">
              <div><span>{{ $t('payment_refund_status') }}</span><el-tag size="small" :type="refundTagType(refund.status)">{{ refundLabel(refund.status) }}</el-tag></div>
              <div><span>Refund No.</span><code>{{ refund.refundNo }}</code></div>
              <el-button link type="primary" :loading="queryingRefund" @click="queryRefund">{{ $t('payment_query_refund') }}</el-button>
            </div>
          </template>
        </div>
      </div>
    </section>

    <el-dialog v-model="createDialogVisible" class="payment-dialog" :title="$t('payment_create_merchant')" width="520px" destroy-on-close>
      <el-form label-position="top" @submit.prevent="createMerchant">
        <el-form-item :label="$t('payment_merchant_name')" required>
          <el-input v-model="merchantForm.name" :placeholder="$t('payment_merchant_name_placeholder')" maxlength="128" />
        </el-form-item>
        <el-form-item :label="$t('payment_callback_url')" required>
          <el-input v-model="merchantForm.callbackUrl" :placeholder="$t('payment_callback_url_placeholder')" />
          <div class="field-hint">{{ $t('payment_callback_url_hint') }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">{{ $t('payment_cancel') }}</el-button>
        <el-button type="primary" :loading="creatingMerchant" @click="createMerchant">{{ $t('payment_create') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="refundDialogVisible" class="payment-dialog" :title="$t('payment_refund_confirm_title')" width="520px" destroy-on-close>
      <p class="dialog-warning">{{ $t('payment_refund_confirm_desc') }}</p>
      <el-form label-position="top">
        <el-form-item :label="$t('payment_refund_amount')" required>
          <el-input v-model="refundForm.amountMinor" inputmode="numeric" />
        </el-form-item>
        <el-form-item :label="$t('payment_refund_reason')" required>
          <el-input v-model="refundForm.reason" :placeholder="$t('payment_refund_reason_placeholder')" maxlength="255" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundDialogVisible = false">{{ $t('payment_cancel') }}</el-button>
        <el-button type="danger" :loading="creatingRefund" @click="createRefund">{{ $t('payment_refund') }}</el-button>
      </template>
    </el-dialog>
    </main>
  </div>
</template>

<script lang="ts" setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { Connection, CopyDocument, Plus, Refresh, Wallet } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import Header from '@/views/components/Header.vue'
import { notifyError, notifySuccess } from '@/utils/message'
import {
  cancelPaymentTransaction,
  createPaymentMerchant,
  createPaymentRefund,
  createPaymentTransaction,
  disablePaymentMerchant,
  listPaymentMerchants,
  queryPaymentRefund,
  queryPaymentTransaction,
  type PaymentMerchant,
  type PaymentRefund,
  type PaymentTransaction,
} from '@/plugins/payment'

const { proxy } = getCurrentInstance()!
const { $t } = proxy
const router = useRouter()

const merchants = ref<PaymentMerchant[]>([])
const loadingMerchants = ref(false)
const creatingMerchant = ref(false)
const createDialogVisible = ref(false)
const newSecret = ref('')
const creatingTransaction = ref(false)
const queryingTransaction = ref(false)
const cancellingTransaction = ref(false)
const creatingRefund = ref(false)
const queryingRefund = ref(false)
const refundDialogVisible = ref(false)
const qrDataUrl = ref('')
const transaction = ref<PaymentTransaction | null>(null)
const refund = ref<PaymentRefund | null>(null)
let pollTimer: number | null = null

const merchantForm = reactive({ name: '', callbackUrl: '' })
const testForm = reactive({
  merchantId: '',
  secret: '',
  amountMinor: '1',
  description: 'Router 支付联调',
  clientType: 'native' as 'native' | 'h5',
  returnUrl: '',
})
const refundForm = reactive({ amountMinor: '', reason: '支付联调完成' })

const activeMerchants = computed(() => merchants.value.filter((item) => item.status === 'active'))
const selectedMerchant = computed(() => activeMerchants.value.find((item) => item.merchantId === testForm.merchantId) || null)
const canCreateTransaction = computed(() => Boolean(
  selectedMerchant.value &&
  testForm.secret.trim() &&
  /^\d+$/.test(testForm.amountMinor.trim()) &&
  Number(testForm.amountMinor) > 0 &&
  testForm.description.trim() &&
  (testForm.clientType !== 'h5' || testForm.returnUrl.trim()),
))
const canRefund = computed(() => Boolean(transaction.value && ['paid', 'partially_refunded'].includes(transaction.value.status)))

function clearPollTimer() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

async function loadMerchants() {
  loadingMerchants.value = true
  try {
    merchants.value = await listPaymentMerchants()
    const current = activeMerchants.value.find((item) => item.merchantId === testForm.merchantId)
    if (!current) {
      testForm.merchantId = activeMerchants.value[0]?.merchantId || ''
      testForm.secret = ''
    }
  } catch (error) {
    notifyError(`${$t('payment_load_merchants_failed')}：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    loadingMerchants.value = false
  }
}

function openCreateMerchant() {
  merchantForm.name = ''
  merchantForm.callbackUrl = ''
  createDialogVisible.value = true
}

function goDeveloperCenter() {
  void router.push('/market/dev/my-apps')
}

async function createMerchant() {
  if (!merchantForm.name.trim() || !merchantForm.callbackUrl.trim()) {
    notifyError(`${$t('payment_merchant_name')}、${$t('payment_callback_url')}不能为空`)
    return
  }
  creatingMerchant.value = true
  try {
    const created = await createPaymentMerchant({ name: merchantForm.name.trim(), callbackUrl: merchantForm.callbackUrl.trim() })
    merchants.value = [created, ...merchants.value]
    newSecret.value = String(created.secret || '')
    testForm.merchantId = created.merchantId
    testForm.secret = newSecret.value
    createDialogVisible.value = false
    notifySuccess(String($t('payment_create_merchant_success')))
  } catch (error) {
    notifyError(`${$t('payment_create_merchant_failed')}：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    creatingMerchant.value = false
  }
}

async function disableMerchant(merchant: PaymentMerchant) {
  try {
    await ElMessageBox.confirm(String($t('payment_disable_confirm_desc')), String($t('payment_disable_confirm_title')), {
      type: 'warning',
      confirmButtonText: String($t('payment_disable')),
      cancelButtonText: String($t('payment_cancel')),
    })
    await disablePaymentMerchant(merchant.merchantId)
    if (testForm.merchantId === merchant.merchantId) {
      testForm.merchantId = ''
      testForm.secret = ''
      resetTransaction()
    }
    await loadMerchants()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      notifyError(`${$t('payment_disable_merchant_failed')}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function resetTransaction() {
  clearPollTimer()
  transaction.value = null
  refund.value = null
  qrDataUrl.value = ''
}

function onMerchantChange() {
  testForm.secret = ''
  resetTransaction()
}

async function createTransaction() {
  if (!canCreateTransaction.value || !selectedMerchant.value) {
    notifyError('请完整填写支付联调信息')
    return
  }
  creatingTransaction.value = true
  resetTransaction()
  const externalOrderId = `node-payment-${Date.now()}`
  try {
    transaction.value = await createPaymentTransaction({
      merchantId: selectedMerchant.value.merchantId,
      secret: testForm.secret.trim(),
      externalOrderId,
      amountMinor: testForm.amountMinor.trim(),
      description: testForm.description.trim(),
      clientType: testForm.clientType,
      returnUrl: testForm.clientType === 'h5' ? testForm.returnUrl.trim() : undefined,
      idempotencyKey: `node-payment-test-${Date.now()}`,
    })
    if (transaction.value.paymentUrl && testForm.clientType === 'native') {
      qrDataUrl.value = await QRCode.toDataURL(transaction.value.paymentUrl, { width: 220, margin: 2 })
    }
    notifySuccess(String($t('payment_order_created')))
    if (transaction.value.status === 'pending') {
      startPolling()
    }
  } catch (error) {
    notifyError(`${$t('payment_order_create_failed')}：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    creatingTransaction.value = false
  }
}

function signedContext() {
  if (!selectedMerchant.value || !testForm.secret.trim() || !transaction.value) {
    throw new Error('缺少支付商户或订单信息')
  }
  return { merchantId: selectedMerchant.value.merchantId, secret: testForm.secret.trim(), tradeNo: transaction.value.tradeNo }
}

async function queryTransaction() {
  try {
    queryingTransaction.value = true
    transaction.value = await queryPaymentTransaction(signedContext())
    if (transaction.value.status !== 'pending') clearPollTimer()
  } catch (error) {
    notifyError(`${$t('payment_query_failed')}：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    queryingTransaction.value = false
  }
}

function startPolling() {
  clearPollTimer()
  pollTimer = window.setInterval(() => {
    void queryTransaction()
  }, 6000)
}

async function cancelTransaction() {
  try {
    cancellingTransaction.value = true
    transaction.value = await cancelPaymentTransaction(signedContext())
    clearPollTimer()
  } catch (error) {
    notifyError(`${$t('payment_cancel_failed')}：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    cancellingTransaction.value = false
  }
}

function openPaymentUrl() {
  if (transaction.value?.paymentUrl) window.open(transaction.value.paymentUrl, '_blank', 'noopener,noreferrer')
}

function openRefund() {
  refundForm.amountMinor = transaction.value?.amountMinor || ''
  refundForm.reason = '支付联调完成'
  refundDialogVisible.value = true
}

async function createRefund() {
  if (!transaction.value || !selectedMerchant.value || !testForm.secret.trim()) return
  if (!/^\d+$/.test(refundForm.amountMinor.trim()) || Number(refundForm.amountMinor) <= 0 || !refundForm.reason.trim()) {
    notifyError('请填写有效的退款金额和原因')
    return
  }
  try {
    creatingRefund.value = true
    refund.value = await createPaymentRefund({
      merchantId: selectedMerchant.value.merchantId,
      secret: testForm.secret.trim(),
      tradeNo: transaction.value.tradeNo,
      amountMinor: refundForm.amountMinor.trim(),
      reason: refundForm.reason.trim(),
      idempotencyKey: `node-refund-test-${Date.now()}`,
    })
    refundDialogVisible.value = false
    notifySuccess(String($t('payment_refund')))
  } catch (error) {
    notifyError(`${$t('payment_refund_failed_action')}：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    creatingRefund.value = false
  }
}

async function queryRefund() {
  if (!refund.value || !selectedMerchant.value || !testForm.secret.trim()) return
  try {
    queryingRefund.value = true
    refund.value = await queryPaymentRefund({ merchantId: selectedMerchant.value.merchantId, secret: testForm.secret.trim(), refundNo: refund.value.refundNo })
    if (refund.value.status === 'succeeded' || refund.value.status === 'failed') {
      await queryTransaction()
    }
  } catch (error) {
    notifyError(`${$t('payment_refund_query_failed')}：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    queryingRefund.value = false
  }
}

async function copySecret(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notifySuccess(String($t('payment_copy_success')))
  } catch (error) {
    notifyError(`${$t('payment_copy_failed')}：${error instanceof Error ? error.message : String(error)}`)
  }
}

function statusLabel(status: string) {
  const key = `payment_status_${status}`
  return String($t(key)) === key ? status : String($t(key))
}

function statusTagType(status: string): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'paid') return 'success'
  if (status === 'pending' || status === 'refund_pending') return 'warning'
  if (status === 'failed') return 'danger'
  return 'info'
}

function refundLabel(status: string) {
  if (status === 'succeeded') return String($t('payment_refund_succeeded'))
  if (status === 'failed') return String($t('payment_refund_failed'))
  return String($t('payment_refund_processing'))
}

function refundTagType(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  return 'warning'
}

onMounted(() => {
  void loadMerchants()
})

onBeforeUnmount(clearPollTimer)
</script>

<style scoped lang="less">
.payment-page {
  min-height: calc(100vh - 3.8rem);
  padding: 32px clamp(20px, 4vw, 56px) 64px;
  background: #f7f8f6;
  color: #17221f;
}

.page-heading,
.section-heading,
.transaction-head,
.secret-row,
.transaction-actions,
.refund-summary > div {
  display: flex;
  align-items: center;
}

.page-heading,
.section-heading {
  justify-content: space-between;
  gap: 24px;
}

.page-heading {
  max-width: 1220px;
  margin: 0 auto 24px;
}

.heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-heading h1 {
  margin: 20px 0 4px;
  font-size: 32px;
  line-height: 1.15;
  letter-spacing: 0;
}

.page-heading p,
.section-heading p {
  margin: 0;
  color: rgba(23, 34, 31, 0.58);
}

.live-warning,
.secret-alert,
.page-section {
  max-width: 1220px;
  margin-right: auto;
  margin-left: auto;
}

.live-warning {
  margin-bottom: 24px;
}

.page-section {
  padding: 26px 28px;
  border: 1px solid rgba(23, 34, 31, 0.1);
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 14px 38px rgba(23, 34, 31, 0.05);
}

.test-section {
  margin-top: 24px;
}

.section-heading {
  align-items: flex-start;
  margin-bottom: 24px;
}

.section-heading h2 {
  margin: 4px 0 4px;
  font-size: 24px;
  letter-spacing: 0;
}

.section-kicker {
  display: block;
  color: #0b8e8b;
  font-family: var(--app-font-mono);
  font-size: 11px;
  letter-spacing: 0;
  text-transform: uppercase;
}

.section-empty {
  min-height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(23, 34, 31, 0.5);
}

.empty-action {
  flex-direction: column;
}

.empty-action strong {
  color: #17221f;
}

.empty-action span {
  margin-bottom: 6px;
}

.merchant-table {
  width: 100%;
}

.merchant-table code,
.transaction-meta code,
.secret-row code,
.refund-summary code {
  color: #295e5a;
  font-family: var(--app-font-mono);
  font-size: 12px;
  word-break: break-all;
}

.muted {
  color: rgba(23, 34, 31, 0.4);
}

.secret-alert {
  margin-top: 24px;
}

.secret-alert p {
  margin: 0 0 10px;
}

.secret-row {
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border: 1px solid rgba(23, 34, 31, 0.12);
  background: rgba(255, 255, 255, 0.72);
}

.secret-row code {
  flex: 1;
}

.test-layout {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(340px, 1.1fr);
  gap: 32px;
}

.test-form {
  min-width: 0;
}

.wide-control {
  width: 100%;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(120px, 0.75fr) minmax(180px, 1.25fr);
  gap: 16px;
}

.security-note,
.field-hint,
.dialog-warning {
  color: rgba(23, 34, 31, 0.55);
  font-size: 12px;
  line-height: 1.6;
}

.security-note {
  margin: 14px 0 0;
}

.field-hint {
  margin-top: 5px;
}

.transaction-panel {
  min-height: 390px;
  padding: 22px;
  border-left: 1px solid rgba(23, 34, 31, 0.1);
  background: #f8fbfa;
}

.transaction-empty {
  min-height: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(23, 34, 31, 0.46);
  text-align: center;
}

.transaction-head {
  justify-content: space-between;
  gap: 16px;
}

.transaction-head h3 {
  margin: 7px 0 0;
  font-size: 18px;
  word-break: break-word;
}

.transaction-meta {
  display: grid;
  gap: 10px;
  margin: 22px 0;
}

.transaction-meta > div,
.refund-summary > div {
  justify-content: space-between;
  gap: 12px;
}

.transaction-meta span,
.refund-summary span {
  color: rgba(23, 34, 31, 0.52);
  font-size: 12px;
}

.qr-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 8px 0 16px;
  color: rgba(23, 34, 31, 0.52);
  font-size: 12px;
}

.qr-block img {
  width: 220px;
  height: 220px;
  border: 8px solid #fff;
}

.transaction-actions {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

.refund-summary {
  display: grid;
  gap: 10px;
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid rgba(23, 34, 31, 0.1);
}

.refund-summary > div:first-child {
  align-items: center;
}

.dialog-warning {
  margin: 0 0 18px;
}

:deep(.payment-dialog) {
  max-width: calc(100vw - 32px);
}

@media (max-width: 900px) {
  .test-layout {
    grid-template-columns: 1fr;
  }

  .transaction-panel {
    border-top: 1px solid rgba(23, 34, 31, 0.1);
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .payment-page {
    padding: 24px 16px 48px;
  }

  :deep(.payment-dialog) {
    width: calc(100vw - 32px) !important;
    margin-top: 8vh !important;
  }

  .page-heading,
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .heading-actions {
    width: 100%;
  }

  .page-section {
    padding: 20px 16px;
  }

  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .transaction-panel {
    padding: 16px;
  }
}
</style>
