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

const staleChunkReloadPrefix = 'stale-chunk-reload:'
router.onError((error) => {
    const message = error instanceof Error ? error.message : String(error)
    const isStaleChunk =
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed') ||
        message.includes('error loading dynamically imported module')
    if (!isStaleChunk) {
        return
    }

    const moduleUrl = message.match(/https?:\/\/\S+\.js/)?.[0] || window.location.pathname
    const reloadKey = `${staleChunkReloadPrefix}${moduleUrl}`
    if (sessionStorage.getItem(reloadKey)) {
        return
    }
    sessionStorage.setItem(reloadKey, '1')
    window.location.reload()
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
