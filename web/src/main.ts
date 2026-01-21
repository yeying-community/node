import '@/assets/style.css'
import { t } from '@yeying-community/yeying-i18n'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { routes, setupRouter } from '@/router'
import { createRouter, createWebHistory, Router } from 'vue-router'
import { initializeProviders } from '@/plugins/account'
import { setupWalletListeners } from '@/plugins/auth'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import { notifyError, notifySuccess } from './utils/message'

const app = createApp(App)

app.use(createPinia())
app.use(ElementPlus, {
    locale: zhCn
})

app.config.globalProperties.$t = t

// 合并路由
const router: Router = createRouter({
    history: createWebHistory(),
    routes
})

setupRouter(router)
app.use(router)

initializeProviders()
  .then(() => {
    setupWalletListeners().catch((error) => {
      console.error('Failed to setup wallet listeners:', error)
    })
    app.mount('#app')
  })
  .catch((error) => {
    console.error('Failed to initialize providers:', error)
    // 可以显示错误页面或提示
    app.mount('#app') // 即使失败也挂载，避免白屏
  })
