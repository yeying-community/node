<template>
  <header class="inset-x-0 top-0 z-10 flex justify-center header">
    <nav
      class="flex items-center justify-between py-4 w-full px-5 lg:px-2 xl:w-5/6"
      aria-label="节点导航"
    >
      <div class="flex items-center cursor-pointer" @click="changeRouter('/')">
        <img class="w-28 h-8 mr-2" src="../../assets/img/logo.svg" />
      </div>
      <div class="flex items-center justify-end gap-3">
        <Language style="transform: translateY(10%)" />
        <button
          type="button"
          class="font-body rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:px-5 sm:text-base"
          :disabled="emailBusy"
          @click="openEmailDialog"
        >
          邮箱登录 / 注册
        </button>
        <button
          type="button"
          class="font-body rounded-full bg-blue-600 px-4 py-2 text-sm text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:px-6 sm:text-base"
          :disabled="isConnecting"
          @click="connectToWallet"
        >
          {{ isConnecting ? '连接中...' : $t('home_connect_wallet') }}
        </button>
      </div>
    </nav>
  </header>
  <el-dialog v-model="emailDialogOpen" title="邮箱登录 / 注册" width="min(92vw, 420px)" @closed="resetEmailDialog">
    <el-radio-group v-model="emailMode" class="mb-4">
      <el-radio-button label="login">登录</el-radio-button>
      <el-radio-button label="register">注册</el-radio-button>
    </el-radio-group>
    <el-input v-model="email" type="email" placeholder="邮箱" :disabled="emailStep === 'code' || emailBusy" @keyup.enter="sendEmailCode" />
    <template v-if="emailMode === 'register' && emailStep === 'email'">
      <el-input v-model="username" class="mt-3" placeholder="用户名（3-32 位字母、数字、下划线或短横线）" :disabled="emailBusy" />
      <el-input v-model="avatar" class="mt-3" placeholder="头像 URL" :disabled="emailBusy" />
      <el-input v-model="password" class="mt-3" type="password" show-password placeholder="钱包密码（至少 8 位）" :disabled="emailBusy" />
      <el-input v-model="confirmPassword" class="mt-3" type="password" show-password placeholder="确认钱包密码" :disabled="emailBusy" @keyup.enter="sendEmailCode" />
    </template>
    <div v-if="emailStep === 'code'" class="mt-3 flex gap-2">
      <el-input v-model="emailCode" inputmode="numeric" maxlength="6" placeholder="邮箱验证码" @keyup.enter="confirmEmailCode" />
      <el-button type="primary" :loading="emailBusy" @click="confirmEmailCode">确认</el-button>
    </div>
    <template #footer>
      <el-button @click="emailDialogOpen = false">取消</el-button>
      <el-button v-if="emailStep === 'email'" type="primary" :loading="emailBusy" @click="sendEmailCode">发送验证码</el-button>
    </template>
  </el-dialog>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Language from "@/components/common/Language.vue";
import { confirmEmailLogin, confirmEmailRegistration, connectWallet, requestEmailLogin, requestEmailRegistration } from "@/plugins/auth";
import { notifyError, notifySuccess } from "@/utils/message";

const router = useRouter();
const route = useRoute();
const isConnecting = ref(false);
const emailDialogOpen = ref(false);
const emailBusy = ref(false);
const emailMode = ref<'login' | 'register'>('login');
const emailStep = ref<'email' | 'code'>('email');
const email = ref('');
const emailCode = ref('');
const username = ref('');
const avatar = ref('');
const password = ref('');
const confirmPassword = ref('');
const emailRequest = ref<Awaited<ReturnType<typeof requestEmailRegistration>> | null>(null);
const emailLoginRequest = ref<Awaited<ReturnType<typeof requestEmailLogin>> | null>(null);

const changeRouter = async (url: string) => {
  await router.push(url);
};

const connectToWallet = async () => {
  if (isConnecting.value) return;
  isConnecting.value = true;
  try {
    await connectWallet(router, route);
  } finally {
    isConnecting.value = false;
  }
};

const openEmailDialog = () => {
  if (!avatar.value) avatar.value = `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(email.value || 'yeying')}`;
  emailDialogOpen.value = true;
};

const resetEmailDialog = () => {
  emailStep.value = 'email';
  emailCode.value = '';
  username.value = '';
  avatar.value = '';
  password.value = '';
  confirmPassword.value = '';
  emailRequest.value = null;
  emailLoginRequest.value = null;
};

const sendEmailCode = async () => {
  const value = email.value.trim();
  if (!value) {
    notifyError('请输入邮箱');
    return;
  }
  if (emailMode.value === 'register') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(username.value.trim())) {
      notifyError('用户名需要 3-32 位字母、数字、下划线或短横线');
      return;
    }
    if (password.value.length < 8) {
      notifyError('钱包密码至少需要 8 位');
      return;
    }
    if (password.value !== confirmPassword.value) {
      notifyError('两次输入的密码不一致');
      return;
    }
  }
  emailBusy.value = true;
  try {
    if (emailMode.value === 'register') {
      emailRequest.value = await requestEmailRegistration({ email: value, username: username.value.trim(), avatar: avatar.value.trim(), password: password.value });
    } else {
      emailLoginRequest.value = await requestEmailLogin(value);
    }
    emailStep.value = 'code';
    notifySuccess('验证码已发送');
  } catch (error) {
    notifyError(String(error instanceof Error ? error.message : error));
  } finally {
    emailBusy.value = false;
  }
};

const confirmEmailCode = async () => {
  if (!emailCode.value.trim()) {
    notifyError('请输入邮箱验证码');
    return;
  }
  emailBusy.value = true;
  try {
    const loggedIn = emailMode.value === 'register'
      ? Boolean(emailRequest.value && await confirmEmailRegistration(emailRequest.value, emailCode.value.trim()))
      : Boolean(emailLoginRequest.value && await confirmEmailLogin(emailLoginRequest.value.verificationId, emailCode.value.trim()));
    if (loggedIn) {
      emailDialogOpen.value = false;
      notifySuccess('登录成功');
      await router.replace({ path: '/market' });
    }
  } catch (error) {
    notifyError(String(error instanceof Error ? error.message : error));
  } finally {
    emailBusy.value = false;
  }
};
</script>

<style scoped>
.header {
  backdrop-filter: blur(10px);
  position: fixed;
}

button:disabled {
  cursor: wait;
  opacity: 0.7;
}
</style>
