<template>
  <div class="layout_bg">
    <Header/>
    <router-view />
  </div>
</template>
<script lang="ts" setup>
import Header from '@/views/components/Header.vue'
import { waitForWallet } from '../../plugins/auth'
import { getWalletDataStore } from '@/stores/auth'
import { notifyError } from '@/utils/message';
import { getCurrentInstance, onBeforeUnmount } from 'vue';

const { proxy } = getCurrentInstance()!
const { $t } = proxy

let loadHandler: (() => void | Promise<void>) | null = null

const loadFunc = async () => {
  try {
    await waitForWallet();
    getWalletDataStore().setWalletReady(true);
  } catch (error) {
    const innerHTML = `
      <p>${$t('market_wallet_missing_title')}</p>
      <p class="error">${$t('market_wallet_missing_tips')}</p>
      <ul>
        <li>•${$t('market_wallet_missing_step_install')}</li>
        <li>•${$t('market_wallet_missing_step_enable')}</li>
        <li>•${$t('market_wallet_missing_step_file')}</li>
        <li>•${$t('market_wallet_missing_step_retry')}</li>
      </ul>
    `;
    getWalletDataStore().setWalletReady(false);
    notifyError(innerHTML);
  }
};

(async () => {
  if (document.readyState === 'complete') {
    await loadFunc();
  } else {
    loadHandler = () => {
      void loadFunc()
    }
    window.addEventListener('load', loadHandler);
  }
})()

onBeforeUnmount(() => {
  if (loadHandler) {
    window.removeEventListener('load', loadHandler);
    loadHandler = null;
  }
})
</script>
<style scoped>
.layout_bg{
  background:url('../../assets/img/user_bg.jpg') white 0px 0px / 100% 100% no-repeat;
  background-size:100% 100%; 
}
</style>
