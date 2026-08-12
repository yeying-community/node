import IndexView from '@/views/IndexView.vue'
import { ensureWalletSession } from '@/plugins/auth'
import { notifyError } from '@/utils/message'

export const routes = [
    {
        path: '/',
        name: 'index',
        component: IndexView,
        children: [
            {
                path: '/',
                name: 'home',
                component: () => import('../views/HomeView.vue')
            }
        ]
    },
    {
        path: '/totp-auth',
        name: 'totpAuth',
        meta: { public: true },
        component: () => import('../views/TotpAuthView.vue')
    },
    {
        path: '/passport/authorize',
        name: 'passportAuth',
        meta: { public: true },
        component: () => import('../views/PassportAuthView.vue')
    },
    {
        path: '/market',
        name: 'market',
        component: () => import('../views/apply/MarketView.vue'),
        children: [
            {
                path: '',
                name: 'appCenter',
                component: () => import('../views/apply/AppCenterView.vue')
            },
            {
                path: 'detail',
                name: 'marketDetail',
                component: () => import('../views/apply/ApplyDetail.vue')
            },
            {
                path: 'dev',
                component: () => import('../views/apply/Main.vue'),
                children: [
                    {
                        path: '',
                        redirect: '/market/dev/my-apps'
                    },
                    {
                        path: 'my-apps',
                        name: 'apply',
                        component: () => import('../views/apply/ApplyView.vue')
                    },
                    {
                        path: 'apply-edit',
                        name: 'applyEdit',
                        component: () => import('../views/apply/ApplyEdit.vue')
                    },
                    {
                        path: 'apply-detail',
                        name: 'applyDetail',
                        component: () => import('../views/apply/ApplyDetail.vue')
                    },
                    {
                        path: 'approval',
                        name: 'approval',
                        component: () => import('../views/apply/ApprovalView.vue')
                    },
                    {
                        path: 'my-config',
                        name: 'myConfig',
                        component: () => import('../views/apply/MyConfigView.vue')
                    },
                    {
                        path: 'my-config/passkey-history',
                        name: 'passkeyTestHistory',
                        component: () => import('../views/apply/PasskeyTestHistoryView.vue')
                    },
                    {
                        path: 'my-config/totp-history',
                        name: 'totpTestHistory',
                        component: () => import('../views/apply/TotpTestHistoryView.vue')
                    },
                    {
                        path: 'notifications',
                        name: 'notifications',
                        component: () => import('../views/apply/NotificationCenterView.vue')
                    }
                ]
            }
        ]
    }
]
export const setupRouter = (router) => {
    router.beforeEach(async (to, from, next) => {
        const isHome = to.path === '/' || to.name === 'home' || to.name === 'index'
        try {
            if (!to.meta.public && !isHome) {
                const ok = await ensureWalletSession({ redirect: false })
                if (!ok) {
                    next({ path: '/' })
                    return
                }
            }
            next()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            notifyError(`恢复钱包登录状态失败：${message}`)
            next(false)
        }
    })
}
