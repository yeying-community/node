import '@/assets/style.css'
import 'element-plus/dist/index.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { routes, setupRouter } from '@/router'
import { createRouter, createWebHistory, Router } from 'vue-router'
import { initializeProviders } from '@/plugins/account'
import { setupWalletListeners } from '@/plugins/auth'
import ElementPlus from 'element-plus'
import { notifyError } from './utils/message'
import { ensureDefaultLocale } from './lang/locale'
import { translate } from './lang/messages'

ensureDefaultLocale()

const app = createApp(App)

app.use(createPinia())
app.use(ElementPlus)

app.config.globalProperties.$t = translate

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
      notifyError(`钱包监听初始化失败：${error instanceof Error ? error.message : String(error)}`)
    })
    app.mount('#app')
  })
  .catch((error) => {
    app.mount('#app')
    notifyError(`钱包环境初始化失败：${error instanceof Error ? error.message : String(error)}`)
  })
