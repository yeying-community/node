<template>
  <div class="layout_bg">
    <Header/>
    <Main />
  </div>
</template>
<script lang="ts" setup>
import Header from '@/views/components/Header.vue'
import Main from './Main.vue'
import { waitForWallet } from '../../plugins/auth'
import { getWalletDataStore } from '@/stores/auth'
import { notifyError } from '@/utils/message';

const loadFunc = async () => {
  try {
    await waitForWallet();
    getWalletDataStore().setWalletReady(true);
    console.log(`WalletReady: ${getWalletDataStore().walletReady}`);
  } catch (error) {
    console.error('钱包检测失败:', error);
    const innerHTML = `
      <p>❌ 未检测到钱包</p>
      <p class="error">请确保：</p>
      <ul>
        <li>•已安装 YeYing Wallet 扩展</li>
        <li>•已启用扩展</li>
        <li>•已在扩展设置中允许访问文件 URL（如果使用 file:// 协议）</li>
        <li>•刷新页面后重试</li>
      </ul>
    `;
    getWalletDataStore().setWalletReady(false);
    notifyError(innerHTML);
  }
};

// ✅ 使用 IIFE 包裹异步逻辑，避免顶层 await
(async () => {
  console.log(`WalletReady 初始状态: ${getWalletDataStore().walletReady}`);
  
  if (document.readyState === 'complete') {
    console.log('页面已加载，立即检测钱包');
    await loadFunc();
  } else {
    console.log('等待页面加载完成...');
    window.addEventListener('load', loadFunc);
  }
})();
</script>
<style scoped>
.layout_bg{
  background:url('../../assets/img/user_bg.jpg') white 0px 0px / 100% 100% no-repeat;
  background-size:100% 100%; 
}
</style>