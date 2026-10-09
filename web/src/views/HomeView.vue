<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Key,
  Lock,
  Message,
  Refresh,
  User,
  Wallet,
} from '@element-plus/icons-vue'
import {
  confirmEmailLogin,
  confirmEmailRegistration,
  connectWallet,
  requestEmailLogin,
  requestEmailRegistration,
} from '@/plugins/auth'
import { translate } from '@/lang/messages'
import { notifySuccess } from '@/utils/message'

type AuthMethod = 'email' | 'wallet'
type EmailMode = 'login' | 'register'
type EmailStep = 'form' | 'code'

const router = useRouter()
const route = useRoute()

const authMethod = ref<AuthMethod>('email')
const emailMode = ref<EmailMode>('login')
const emailStep = ref<EmailStep>('form')
const emailBusy = ref(false)
const isConnecting = ref(false)
const email = ref('')
const emailCode = ref('')
const username = ref('')
const avatar = ref(avatarForSeed('yeying'))
const avatarTouched = ref(false)
const password = ref('')
const confirmPassword = ref('')
// The registration request contains ethers Wallet and CryptoKey instances.
// Keep the object unproxied so native private fields retain their receiver.
const emailRequest = shallowRef<Awaited<ReturnType<typeof requestEmailRegistration>> | null>(null)
const emailLoginRequest = shallowRef<Awaited<ReturnType<typeof requestEmailLogin>> | null>(null)
const errorMessage = ref('')
const infoMessage = ref('')
const resendIn = ref(0)
let resendTimer: number | null = null

const isRegister = computed(() => emailMode.value === 'register')
const authTitle = computed(() => translate(isRegister.value ? 'auth_form_title_register' : 'auth_form_title_login'))
const authDescription = computed(() => translate(isRegister.value ? 'auth_form_desc_register' : 'auth_form_desc_login'))
const emailActionLabel = computed(() => translate(isRegister.value ? 'auth_send_register_code' : 'auth_send_code'))
const verifyActionLabel = computed(() => translate(isRegister.value ? 'auth_verify_register' : 'auth_verify_login'))

function avatarForSeed(seed: string) {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed || 'yeying')}`
}

function syncAvatar() {
  if (avatarTouched.value) {
    return
  }
  avatar.value = avatarForSeed(username.value.trim() || email.value.trim() || 'yeying')
}

function markAvatarTouched() {
  avatarTouched.value = true
}

function regenerateAvatar() {
  avatarTouched.value = true
  const seed = `${username.value.trim() || email.value.trim() || 'yeying'}-${Date.now()}`
  avatar.value = avatarForSeed(seed)
}

function clearMessages() {
  errorMessage.value = ''
  infoMessage.value = ''
}

function errorText(error: unknown) {
  return String(error instanceof Error ? error.message : error || translate('auth_generic_error'))
}

function isEmailNotFound(error: unknown) {
  return errorText(error).toUpperCase().includes('IDENTITY_EMAIL_ACCOUNT_NOT_FOUND')
}

function startResendTimer() {
  if (resendTimer !== null) {
    window.clearInterval(resendTimer)
  }
  resendIn.value = 60
  resendTimer = window.setInterval(() => {
    resendIn.value = Math.max(0, resendIn.value - 1)
    if (resendIn.value === 0 && resendTimer !== null) {
      window.clearInterval(resendTimer)
      resendTimer = null
    }
  }, 1000)
}

function stopResendTimer() {
  if (resendTimer !== null) {
    window.clearInterval(resendTimer)
    resendTimer = null
  }
  resendIn.value = 0
}

function switchAuthMethod(method: AuthMethod) {
  if (emailBusy.value || isConnecting.value) {
    return
  }
  authMethod.value = method
  clearMessages()
}

function switchEmailMode(mode: EmailMode) {
  if (emailBusy.value) {
    return
  }
  emailMode.value = mode
  emailStep.value = 'form'
  emailCode.value = ''
  emailRequest.value = null
  emailLoginRequest.value = null
  stopResendTimer()
  clearMessages()
  if (mode === 'register') {
    syncAvatar()
  }
}

function backToEmailForm() {
  if (emailBusy.value) {
    return
  }
  emailStep.value = 'form'
  emailCode.value = ''
  stopResendTimer()
  clearMessages()
}

async function sendEmailCode() {
  clearMessages()
  const value = email.value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    errorMessage.value = translate('auth_invalid_email')
    return
  }

  if (isRegister.value) {
    const name = username.value.trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(name)) {
      errorMessage.value = translate('auth_username_invalid')
      return
    }
    if (password.value.length < 8) {
      errorMessage.value = translate('auth_password_short')
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMessage.value = translate('auth_password_mismatch')
      return
    }
    syncAvatar()
  }

  emailBusy.value = true
  try {
    if (isRegister.value) {
      emailRequest.value = await requestEmailRegistration({
        email: value,
        username: username.value.trim(),
        avatar: avatar.value.trim(),
        password: password.value,
      })
    } else {
      emailLoginRequest.value = await requestEmailLogin(value)
    }
    emailStep.value = 'code'
    emailCode.value = ''
    startResendTimer()
    infoMessage.value = translate('auth_code_sent')
  } catch (error) {
    if (!isRegister.value && isEmailNotFound(error)) {
      emailMode.value = 'register'
      emailStep.value = 'form'
      emailLoginRequest.value = null
      infoMessage.value = translate('auth_email_not_registered')
      syncAvatar()
      return
    }
    errorMessage.value = errorText(error)
  } finally {
    emailBusy.value = false
  }
}

async function confirmEmailCode() {
  clearMessages()
  const code = emailCode.value.trim()
  if (!/^\d{6}$/.test(code)) {
    errorMessage.value = translate('auth_code_required')
    return
  }

  emailBusy.value = true
  try {
    const loggedIn = isRegister.value
      ? Boolean(emailRequest.value && await confirmEmailRegistration(emailRequest.value, code))
      : Boolean(emailLoginRequest.value && await confirmEmailLogin(emailLoginRequest.value.verificationId, code))
    if (!loggedIn) {
      throw new Error(translate('auth_generic_error'))
    }
    stopResendTimer()
    notifySuccess(translate(isRegister.value ? 'auth_register_success' : 'auth_login_success'))
    await router.replace({ path: '/market' })
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    emailBusy.value = false
  }
}

async function connectToWallet() {
  if (isConnecting.value) {
    return
  }
  clearMessages()
  isConnecting.value = true
  try {
    await connectWallet(router, route)
  } finally {
    isConnecting.value = false
  }
}

onBeforeUnmount(() => {
  stopResendTimer()
})
</script>

<template>
  <main class="auth-page">
    <div class="auth-layout">
      <section class="auth-intro" aria-labelledby="auth-intro-title">
        <div class="intro-mark">
          <span class="intro-mark-dot" aria-hidden="true"></span>
          <span>{{ $t('auth_intro_label') }}</span>
        </div>
        <h1 id="auth-intro-title">{{ $t('auth_title') }}</h1>
        <p class="intro-copy">{{ $t('auth_subtitle') }}</p>

        <div class="intro-divider" aria-hidden="true"></div>
        <ul class="intro-features">
          <li>
            <el-icon><CircleCheck /></el-icon>
            <span>{{ $t('auth_feature_workspace') }}</span>
          </li>
          <li>
            <el-icon><CircleCheck /></el-icon>
            <span>{{ $t('auth_feature_identity') }}</span>
          </li>
          <li>
            <el-icon><CircleCheck /></el-icon>
            <span>{{ $t('auth_feature_custody') }}</span>
          </li>
        </ul>

        <div class="intro-security">
          <el-icon><Lock /></el-icon>
          <div>
            <strong>{{ $t('auth_security_title') }}</strong>
            <p>{{ $t('auth_security_desc') }}</p>
          </div>
        </div>
      </section>

      <section class="auth-panel" aria-labelledby="auth-panel-title">
        <div class="panel-heading">
          <span class="panel-kicker">{{ $t('auth_form_kicker') }}</span>
          <h2 id="auth-panel-title">{{ emailStep === 'code' ? $t('auth_code_title') : authTitle }}</h2>
          <p>{{ emailStep === 'code' ? $t('auth_code_desc', { email }) : authDescription }}</p>
        </div>

        <div class="method-switch" role="tablist" :aria-label="$t('auth_method_label')">
          <button
            type="button"
            role="tab"
            class="method-tab"
            :class="{ active: authMethod === 'email' }"
            :aria-selected="authMethod === 'email'"
            @click="switchAuthMethod('email')"
          >
            <el-icon><Message /></el-icon>
            <span>{{ $t('auth_method_email') }}</span>
          </button>
          <button
            type="button"
            role="tab"
            class="method-tab"
            :class="{ active: authMethod === 'wallet' }"
            :aria-selected="authMethod === 'wallet'"
            @click="switchAuthMethod('wallet')"
          >
            <el-icon><Wallet /></el-icon>
            <span>{{ $t('auth_method_wallet') }}</span>
          </button>
        </div>

        <form
          v-if="authMethod === 'email'"
          class="email-workspace"
          @submit.prevent="emailStep === 'code' ? confirmEmailCode() : sendEmailCode()"
        >
          <div v-if="emailStep === 'form'" class="email-mode-switch" role="tablist" :aria-label="$t('auth_email_mode_label')">
            <button
              type="button"
              role="tab"
              :class="{ active: emailMode === 'login' }"
              :aria-selected="emailMode === 'login'"
              @click="switchEmailMode('login')"
            >
              {{ $t('auth_email_login') }}
            </button>
            <button
              type="button"
              role="tab"
              :class="{ active: emailMode === 'register' }"
              :aria-selected="emailMode === 'register'"
              @click="switchEmailMode('register')"
            >
              {{ $t('auth_email_register') }}
            </button>
          </div>

          <template v-if="emailStep === 'form'">
            <div v-if="emailMode === 'register'" class="registration-fields">
              <label class="field-label" for="auth-username">{{ $t('auth_username_label') }}</label>
              <el-input
                id="auth-username"
                v-model="username"
                autocomplete="username"
                :placeholder="$t('auth_username_placeholder')"
                @input="syncAvatar"
              >
                <template #prefix><el-icon><User /></el-icon></template>
              </el-input>

              <label class="field-label" for="auth-avatar">{{ $t('auth_avatar_label') }}</label>
              <div class="avatar-field">
                <img class="avatar-preview" :src="avatar" alt="" />
                <el-input
                  id="auth-avatar"
                  v-model="avatar"
                  autocomplete="off"
                  :placeholder="$t('auth_avatar_placeholder')"
                  @input="markAvatarTouched"
                />
                <el-tooltip :content="$t('auth_regenerate_avatar')" placement="top">
                  <button type="button" class="icon-button" :aria-label="$t('auth_regenerate_avatar')" @click="regenerateAvatar">
                    <el-icon><Refresh /></el-icon>
                  </button>
                </el-tooltip>
              </div>

              <label class="field-label" for="auth-password">{{ $t('auth_password_label') }}</label>
              <el-input
                id="auth-password"
                v-model="password"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="$t('auth_password_placeholder')"
              >
                <template #prefix><el-icon><Key /></el-icon></template>
              </el-input>
              <p class="field-hint">{{ $t('auth_password_hint') }}</p>

              <label class="field-label" for="auth-confirm-password">{{ $t('auth_confirm_password_label') }}</label>
              <el-input
                id="auth-confirm-password"
                v-model="confirmPassword"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="$t('auth_confirm_password_placeholder')"
                @keyup.enter="sendEmailCode"
              />
            </div>

            <label class="field-label" for="auth-email">{{ $t('auth_email_label') }}</label>
            <el-input
              id="auth-email"
              v-model="email"
              type="email"
              autocomplete="email"
              :placeholder="$t('auth_email_placeholder')"
              @input="syncAvatar"
              @keyup.enter="sendEmailCode"
            >
              <template #prefix><el-icon><Message /></el-icon></template>
            </el-input>

            <button type="button" class="primary-action" :disabled="emailBusy" @click="sendEmailCode">
              <span>{{ emailBusy ? $t('auth_processing') : emailActionLabel }}</span>
              <el-icon v-if="!emailBusy"><ArrowRight /></el-icon>
            </button>
          </template>

          <template v-else>
            <button type="button" class="back-action" :disabled="emailBusy" @click="backToEmailForm">
              <el-icon><ArrowLeft /></el-icon>
              <span>{{ $t('auth_change_email') }}</span>
            </button>
            <label class="field-label" for="auth-code">{{ $t('auth_code_label') }}</label>
            <el-input
              id="auth-code"
              v-model="emailCode"
              class="code-input"
              inputmode="numeric"
              maxlength="6"
              autocomplete="one-time-code"
              :placeholder="$t('auth_code_placeholder')"
              @keyup.enter="confirmEmailCode"
            />
            <button type="button" class="primary-action" :disabled="emailBusy" @click="confirmEmailCode">
              <span>{{ emailBusy ? $t('auth_processing') : verifyActionLabel }}</span>
              <el-icon v-if="!emailBusy"><ArrowRight /></el-icon>
            </button>
            <button type="button" class="resend-action" :disabled="emailBusy || resendIn > 0" @click="sendEmailCode">
              {{ resendIn > 0 ? $t('auth_resend_in', { seconds: resendIn }) : $t('auth_resend_code') }}
            </button>
          </template>

          <div v-if="infoMessage" class="auth-alert info" role="status">{{ infoMessage }}</div>
          <div v-if="errorMessage" class="auth-alert error" role="alert">{{ errorMessage }}</div>

          <p class="form-footnote">
            <el-icon><Lock /></el-icon>
            <span>{{ $t('auth_email_security_note') }}</span>
          </p>
        </form>

        <div v-else class="wallet-workspace">
          <div class="wallet-symbol" aria-hidden="true"><el-icon><Wallet /></el-icon></div>
          <h3>{{ $t('auth_wallet_title') }}</h3>
          <p class="wallet-description">{{ $t('auth_wallet_desc') }}</p>
          <ul class="wallet-checks">
            <li><el-icon><CircleCheck /></el-icon><span>{{ $t('auth_wallet_feature_sign') }}</span></li>
            <li><el-icon><CircleCheck /></el-icon><span>{{ $t('auth_wallet_feature_provision') }}</span></li>
            <li><el-icon><CircleCheck /></el-icon><span>{{ $t('auth_wallet_feature_extension') }}</span></li>
          </ul>
          <button type="button" class="primary-action wallet-action" :disabled="isConnecting" @click="connectToWallet">
            <span>{{ isConnecting ? $t('auth_processing') : $t('auth_connect_wallet') }}</span>
            <el-icon v-if="!isConnecting"><ArrowRight /></el-icon>
          </button>
          <p class="wallet-fallback">{{ $t('auth_wallet_fallback') }}</p>
          <div v-if="errorMessage" class="auth-alert error" role="alert">{{ errorMessage }}</div>
        </div>

        <div class="panel-bottom-line">
          <el-icon><Lock /></el-icon>
          <span>{{ $t('auth_panel_security') }}</span>
        </div>
      </section>
    </div>

    <footer class="auth-footer">
      <span>{{ $t('auth_footer') }}</span>
      <span class="footer-status"><span aria-hidden="true"></span>{{ $t('auth_status_ready') }}</span>
    </footer>
  </main>
</template>

<style scoped>
.auth-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
  padding: 112px clamp(20px, 5vw, 72px) 28px;
  color: #142640;
  letter-spacing: 0;
}

.auth-page * {
  box-sizing: border-box;
  letter-spacing: 0;
}

.auth-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.96fr) minmax(420px, 0.82fr);
  width: min(1180px, 100%);
  min-height: 620px;
  margin: auto;
  box-shadow: 0 24px 70px rgba(22, 45, 62, 0.12);
}

.auth-intro {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: clamp(42px, 6vw, 80px);
  border: 1px solid #172d4b;
  border-right: 0;
  border-radius: 6px 0 0 6px;
  background: #10233f;
  color: #f5f8f6;
}

.auth-intro::after {
  position: absolute;
  right: 48px;
  bottom: 45px;
  width: 108px;
  height: 108px;
  border: 1px solid rgba(91, 222, 191, 0.36);
  content: '';
}

.intro-mark {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #73d7b7;
  font-size: 12px;
  line-height: 1;
}

.intro-mark-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #73d7b7;
}

.auth-intro h1 {
  max-width: 470px;
  margin: 54px 0 22px;
  color: #ffffff;
  font-size: clamp(36px, 4vw, 60px);
  font-weight: 500;
  line-height: 1.12;
}

.intro-copy {
  max-width: 420px;
  margin: 0;
  color: #bdcbd6;
  font-size: 16px;
  line-height: 1.75;
}

.intro-divider {
  width: 100%;
  height: 1px;
  margin: auto 0 30px;
  background: #2c4661;
}

.intro-features,
.wallet-checks {
  display: grid;
  gap: 15px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.intro-features li,
.wallet-checks li {
  display: flex;
  align-items: center;
  gap: 11px;
  color: #d6e1e6;
  font-size: 14px;
}

.intro-features .el-icon,
.wallet-checks .el-icon {
  color: #73d7b7;
  font-size: 17px;
}

.intro-security {
  display: flex;
  gap: 13px;
  max-width: 400px;
  margin-top: 46px;
  padding: 17px 0 0;
  border-top: 1px solid #2c4661;
}

.intro-security > .el-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: #73d7b7;
  font-size: 19px;
}

.intro-security strong {
  display: block;
  color: #f5f8f6;
  font-size: 14px;
  font-weight: 500;
}

.intro-security p {
  margin: 4px 0 0;
  color: #93a9b7;
  font-size: 12px;
  line-height: 1.6;
}

.auth-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: clamp(34px, 5vw, 62px) clamp(28px, 5vw, 66px) 30px;
  border: 1px solid #e0e8e5;
  border-radius: 0 6px 6px 0;
  background: #ffffff;
}

.panel-heading {
  margin-bottom: 28px;
}

.panel-kicker {
  display: block;
  margin-bottom: 13px;
  color: #0b8e8b;
  font-size: 12px;
}

.panel-heading h2 {
  margin: 0;
  color: #142640;
  font-size: clamp(27px, 3vw, 36px);
  font-weight: 500;
  line-height: 1.2;
}

.panel-heading p {
  max-width: 360px;
  margin: 12px 0 0;
  color: #697887;
  font-size: 14px;
  line-height: 1.6;
}

.method-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  margin-bottom: 26px;
  border: 1px solid #e3eae7;
  border-radius: 4px;
  background: #f4f7f6;
}

.method-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 12px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #71808e;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.method-tab:hover {
  color: #142640;
}

.method-tab.active {
  background: #ffffff;
  color: #142640;
  box-shadow: 0 1px 5px rgba(22, 45, 62, 0.09);
}

.method-tab:focus-visible,
.email-mode-switch button:focus-visible,
.primary-action:focus-visible,
.back-action:focus-visible,
.resend-action:focus-visible,
.icon-button:focus-visible {
  outline: 2px solid #0b8e8b;
  outline-offset: 2px;
}

.email-mode-switch {
  display: flex;
  gap: 21px;
  margin: 0 0 25px;
  border-bottom: 1px solid #e7ecea;
}

.email-mode-switch button {
  position: relative;
  padding: 0 0 12px;
  border: 0;
  background: transparent;
  color: #8a96a0;
  font-size: 14px;
  cursor: pointer;
}

.email-mode-switch button.active {
  color: #142640;
  font-weight: 500;
}

.email-mode-switch button.active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  background: #0b8e8b;
  content: '';
}

.registration-fields {
  display: grid;
  grid-template-columns: 1fr;
}

.field-label {
  display: block;
  margin: 0 0 7px;
  color: #46596d;
  font-size: 13px;
}

.registration-fields .field-label:not(:first-child),
.email-workspace > .field-label {
  margin-top: 17px;
}

.auth-panel :deep(.el-input) {
  width: 100%;
}

.auth-panel :deep(.el-input__wrapper) {
  min-height: 44px;
  padding: 1px 13px;
  border: 1px solid #dfe7e4;
  border-radius: 3px;
  background: #fbfcfb;
  box-shadow: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.auth-panel :deep(.el-input__wrapper:hover),
.auth-panel :deep(.el-input__wrapper.is-focus) {
  border-color: #7cc5b2;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(11, 142, 139, 0.1);
}

.auth-panel :deep(.el-input__inner) {
  color: #142640;
}

.auth-panel :deep(.el-input__prefix-inner) {
  color: #82919b;
}

.avatar-field {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 8px;
}

.avatar-preview {
  width: 36px;
  height: 36px;
  border: 1px solid #dfe7e4;
  border-radius: 50%;
  background: #eef4f2;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid #dfe7e4;
  border-radius: 3px;
  background: #ffffff;
  color: #536b77;
  cursor: pointer;
}

.icon-button:hover {
  border-color: #7cc5b2;
  color: #0b8e8b;
}

.field-hint,
.wallet-fallback {
  margin: 7px 0 0;
  color: #8a96a0;
  font-size: 12px;
  line-height: 1.55;
}

.primary-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 46px;
  padding: 0 16px 0 18px;
  margin-top: 24px;
  border: 1px solid #0b8e8b;
  border-radius: 3px;
  background: #0b8e8b;
  color: #ffffff;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.primary-action:hover:not(:disabled) {
  border-color: #087671;
  background: #087671;
  transform: translateY(-1px);
}

.primary-action:disabled,
.back-action:disabled,
.resend-action:disabled,
.method-tab:disabled {
  cursor: wait;
  opacity: 0.58;
}

.back-action,
.resend-action {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #637786;
  font-size: 13px;
  cursor: pointer;
}

.back-action {
  margin: 0 0 27px;
}

.back-action:hover,
.resend-action:hover:not(:disabled) {
  color: #0b8e8b;
}

.code-input :deep(.el-input__inner) {
  font-size: 22px;
  letter-spacing: 0.18em;
}

.resend-action {
  justify-content: center;
  width: 100%;
  margin-top: 15px;
}

.auth-alert {
  padding: 10px 12px;
  margin-top: 16px;
  border-left: 3px solid;
  font-size: 13px;
  line-height: 1.55;
}

.auth-alert.info {
  border-color: #0b8e8b;
  background: #eef9f5;
  color: #22675d;
}

.auth-alert.error {
  border-color: #c5574c;
  background: #fff3f1;
  color: #954137;
  overflow-wrap: anywhere;
}

.form-footnote,
.panel-bottom-line {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: #89959e;
  font-size: 12px;
  line-height: 1.55;
}

.form-footnote {
  margin: auto 0 0;
  padding-top: 25px;
}

.form-footnote .el-icon,
.panel-bottom-line .el-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: #0b8e8b;
}

.wallet-workspace {
  display: flex;
  flex-direction: column;
  min-height: 330px;
}

.wallet-symbol {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  border: 1px solid #b9ddd0;
  border-radius: 50%;
  background: #eef9f5;
  color: #0b8e8b;
  font-size: 25px;
}

.wallet-workspace h3 {
  margin: 25px 0 8px;
  color: #142640;
  font-size: 21px;
  font-weight: 500;
}

.wallet-description {
  max-width: 360px;
  margin: 0;
  color: #697887;
  font-size: 14px;
  line-height: 1.65;
}

.wallet-checks {
  gap: 12px;
  margin-top: 25px;
}

.wallet-checks li {
  color: #536779;
  font-size: 13px;
}

.wallet-action {
  margin-top: auto;
}

.wallet-fallback {
  text-align: center;
}

.panel-bottom-line {
  padding-top: 25px;
  margin-top: 27px;
  border-top: 1px solid #edf1ef;
}

.auth-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: min(1180px, 100%);
  margin: 22px auto 0;
  color: #8a96a0;
  font-size: 12px;
}

.footer-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.footer-status span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2bb582;
}

@media (max-width: 900px) {
  .auth-page {
    padding-top: 92px;
  }

  .auth-layout {
    grid-template-columns: minmax(0, 1fr) minmax(360px, 0.92fr);
  }

  .auth-intro {
    padding: 38px;
  }

  .auth-intro h1 {
    margin-top: 40px;
    font-size: 42px;
  }

  .auth-panel {
    padding-right: 36px;
    padding-left: 36px;
  }
}

@media (max-width: 720px) {
  .auth-page {
    padding: 84px 16px 20px;
  }

  .auth-layout {
    display: flex;
    flex-direction: column;
    min-height: 0;
    box-shadow: none;
  }

  .auth-panel {
    order: 1;
    padding: 29px 22px 23px;
    border-radius: 5px;
    box-shadow: 0 16px 36px rgba(22, 45, 62, 0.1);
  }

  .auth-intro {
    order: 2;
    min-height: 0;
    padding: 32px 22px;
    margin-top: 14px;
    border: 1px solid #172d4b;
    border-radius: 5px;
  }

  .auth-intro h1 {
    max-width: 420px;
    margin: 30px 0 15px;
    font-size: 34px;
  }

  .intro-copy {
    font-size: 14px;
  }

  .intro-divider {
    margin-top: 38px;
  }

  .intro-security {
    margin-top: 31px;
  }

  .auth-intro::after {
    right: 24px;
    bottom: 27px;
    width: 72px;
    height: 72px;
  }

  .auth-footer {
    align-items: flex-start;
    flex-direction: column;
    margin-top: 16px;
  }
}

@media (max-width: 380px) {
  .auth-panel {
    padding-right: 17px;
    padding-left: 17px;
  }

  .method-tab {
    padding-right: 6px;
    padding-left: 6px;
  }

  .auth-panel h2 {
    font-size: 25px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .method-tab,
  .auth-panel :deep(.el-input__wrapper),
  .primary-action {
    transition: none;
  }
}
</style>
