<template>
    <div class="header">
        <div class="left">
            <img @click="go('/')" class="w-24 h-6 pr-4 border-r" src="../../assets/img/logo.svg"/>
        </div>
        <div class="center">
            <el-input
                v-if="showMarketSearch"
                v-model="marketKeyword"
                size="large"
                class="market-search"
                placeholder="搜索应用名称/作者地址"
                @keyup.enter="submitMarketSearch"
            >
                <template #suffix>
                    <el-icon class="search-icon" @click="submitMarketSearch">
                        <Search />
                    </el-icon>
                </template>
            </el-input>
        </div>
        <div class="account">
            <button
                v-if="showDevEntry"
                type="button"
                class="dev-entry-btn"
                @click="goDeveloperEntry"
            >
                {{ devEntryText }}
            </button>
            <el-tooltip content="帮助文档" placement="bottom" :show-after="250">
                <button
                    type="button"
                    class="help-link-btn"
                    aria-label="打开帮助文档"
                    @click="openHelpDoc"
                >
                    <el-icon><QuestionFilled /></el-icon>
                </button>
            </el-tooltip>
            <el-popover
                v-model:visible="notificationVisible"
                placement="bottom-end"
                :width="360"
                trigger="click"
                popper-class="notification-popover"
                @show="handleNotificationOpen"
            >
                <template #reference>
                    <button
                        type="button"
                        class="notification-btn"
                        aria-label="打开通知中心"
                    >
                        <el-badge :hidden="unreadCount <= 0" :value="unreadBadgeText" :max="99">
                            <el-icon><BellFilled /></el-icon>
                        </el-badge>
                    </button>
                </template>
                <div class="notification-panel">
                    <div class="notification-panel-head">
                        <span class="notification-title">通知</span>
                        <div class="notification-head-actions">
                            <span class="notification-summary">{{ unreadCount > 0 ? `${unreadCount} 条未读` : '全部已读' }}</span>
                            <button
                                v-if="unreadCount > 0"
                                type="button"
                                class="notification-read-all-btn"
                                @click.stop="handleMarkAllRead"
                            >
                                全部已读
                            </button>
                        </div>
                    </div>
                    <div v-if="notificationLoading" class="notification-empty">加载中...</div>
                    <div v-else-if="notifications.length === 0" class="notification-empty">暂无通知</div>
                    <button
                        v-for="item in notifications"
                        :key="item.notificationUid"
                        type="button"
                        class="notification-item"
                        :class="{ unread: !item.isRead }"
                        @click="handleNotificationItemClick(item)"
                    >
                        <span class="notification-marker" :class="{ unread: !item.isRead }"></span>
                        <div class="notification-body">
                            <div class="notification-item-head">
                                <span class="notification-item-title">{{ item.title || '-' }}</span>
                                <span class="notification-item-time">{{ formatNotificationTime(item.createdAt) }}</span>
                            </div>
                            <div class="notification-item-text">{{ item.body || notificationTypeLabel(item.type) }}</div>
                        </div>
                    </button>
                </div>
            </el-popover>
            <el-dropdown
                v-if="shortAddress"
                trigger="click"
                placement="bottom-end"
                @command="handleAccountCommand"
            >
                <span class="account-trigger">
                    <el-tooltip :content="fullAddress" placement="bottom" :show-after="200">
                        <span class="account-text">{{ shortAddress }}</span>
                    </el-tooltip>
                    <button
                        type="button"
                        class="copy-address-btn"
                        :aria-label="copyIconLabel"
                        @click.stop.prevent="copyCurrentAddress"
                    >
                        <el-icon v-if="isAddressCopied"><Check /></el-icon>
                        <el-icon v-else><DocumentCopy /></el-icon>
                    </button>
                    <span class="account-arrow" aria-hidden="true">
                        <el-icon><CaretBottom /></el-icon>
                    </span>
                </span>
                <template #dropdown>
                    <el-dropdown-menu>
                        <el-dropdown-item command="logout">退出登录</el-dropdown-item>
                    </el-dropdown-menu>
                </template>
            </el-dropdown>
            <span v-else>--</span>
        </div>
    </div>
</template>
<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { BellFilled, CaretBottom, Check, DocumentCopy, QuestionFilled, Search } from '@element-plus/icons-vue'
import { getCurrentAccount, getStoredAuthToken, logoutWithUcan } from '@/plugins/auth'
import $notification, { type NotificationListItem, type NotificationStreamPayload } from '@/plugins/notification'
import { notifyError } from '@/utils/message'

const router = useRouter();
const route = useRoute()
const currentAccount = ref<string | null>(null)
const isAddressCopied = ref(false)
const marketKeyword = ref('')
const notificationVisible = ref(false)
const notificationLoading = ref(false)
const unreadCount = ref(0)
const notifications = ref<NotificationListItem[]>([])
const notificationListDirty = ref(false)
let notificationStream: { close: () => void } | null = null
let notificationErrorShown = false
let copiedTimer: number | null = null

const go = async (url: string) => {
    router.push(url)
}

const showDevEntry = computed(() => String(route.path || '').startsWith('/market'))
const showMarketSearch = computed(() => route.name === 'appCenter')
const devEntryText = computed(() => (showMarketSearch.value ? '开发者入口' : '返回应用中心'))

const submitMarketSearch = () => {
    if (!showMarketSearch.value) {
        return
    }
    const keyword = String(marketKeyword.value || '').trim()
    router.replace({
        path: '/market/',
        query: keyword ? { keyword } : {}
    })
}

const goDeveloperEntry = async () => {
    if (showMarketSearch.value) {
        await router.push('/market/dev/my-apps')
        return
    }
    await router.push('/market/')
}

function openHelpDoc() {
    window.open('/help.html', '_blank', 'noopener,noreferrer')
}

function hasAuthToken() {
    return !!getStoredAuthToken()
}

function notificationTypeLabel(type: string) {
    const normalized = String(type || '').trim()
    switch (normalized) {
        case 'audit.approved':
            return '审批已通过'
        case 'audit.created':
            return '有新的审批待处理'
        case 'audit.rejected':
            return '审批未通过'
        case 'totp.request_approved':
            return '授权已确认'
        case 'totp.request_expired':
            return '授权已过期'
        default:
            return '系统通知'
    }
}

function formatNotificationTime(value: string) {
    const parsed = dayjs(String(value || '').trim())
    if (!parsed.isValid()) {
        return '-'
    }
    return parsed.format('MM-DD HH:mm')
}

async function loadUnreadCount() {
    if (!hasAuthToken()) {
        unreadCount.value = 0
        return
    }
    const result = await $notification.unreadCount()
    unreadCount.value = Number(result.unreadCount || 0)
}

async function loadNotifications() {
    if (!hasAuthToken()) {
        notifications.value = []
        unreadCount.value = 0
        return
    }
    notificationLoading.value = true
    try {
        const result = await $notification.list({ page: 1, pageSize: 8 })
        notifications.value = Array.isArray(result.items) ? result.items : []
        notificationListDirty.value = false
    } finally {
        notificationLoading.value = false
    }
}

function routeByNotification(item: NotificationListItem) {
    const type = String(item.type || '').trim()
    if (type.startsWith('audit.')) {
        const payload = item.payload || {}
        const auditId = String(payload.auditId || item.subjectId || '').trim()
        const targetUid = String(payload.targetUid || '').trim()
        const targetDid = String(payload.targetDid || '').trim()
        const targetVersionRaw = payload.targetVersion
        const targetVersion =
            typeof targetVersionRaw === 'number'
                ? targetVersionRaw
                : Number(targetVersionRaw)
        return {
            path: type === 'audit.created' ? '/market/dev/approval' : '/market/dev/apply-detail',
            query:
                type === 'audit.created'
                    ? {
                          ...(auditId ? { auditId } : {}),
                      }
                    : {
                          pageFrom: 'myApply',
                          ...(auditId ? { auditId } : {}),
                          ...(targetUid ? { uid: targetUid } : {}),
                          ...(targetDid ? { did: targetDid } : {}),
                          ...(Number.isFinite(targetVersion) ? { version: String(targetVersion) } : {})
                      }
        }
    }
    if (type.startsWith('totp.')) {
        return {
            path: '/market/dev/my-config'
        }
    }
    return {
        path: '/market/'
    }
}

async function handleNotificationItemClick(item: NotificationListItem) {
    if (!item.isRead) {
        try {
            await $notification.markRead(item.notificationUid)
            item.isRead = true
            item.readAt = dayjs().toISOString()
            unreadCount.value = Math.max(0, unreadCount.value - 1)
        } catch (error) {
            notifyError(`❌更新通知状态失败 ${error}`)
        }
    }
    notificationVisible.value = false
    await router.push(routeByNotification(item))
}

async function handleNotificationOpen() {
    await loadUnreadCount()
    if (notificationListDirty.value || notifications.value.length === 0) {
        try {
            await loadNotifications()
        } catch (error) {
            notifyError(`❌获取通知失败 ${error}`)
        }
    }
}

async function handleMarkAllRead() {
    if (unreadCount.value <= 0) {
        return
    }
    try {
        await $notification.markAllRead()
        unreadCount.value = 0
        notifications.value = notifications.value.map((item) => ({
            ...item,
            isRead: true,
            readAt: item.readAt || dayjs().toISOString()
        }))
    } catch (error) {
        notifyError(`❌批量已读失败 ${error}`)
    }
}

function applyNotificationEvent(event: string, data: NotificationStreamPayload) {
    if (event === 'unread-count' && 'unreadCount' in data) {
        unreadCount.value = Number(data.unreadCount || 0)
        return
    }
    if ((event === 'notification.created' || event === 'notification.read') && 'unreadCount' in data) {
        unreadCount.value = Number(data.unreadCount || 0)
    }
    if (event === 'notification.created' || event === 'notification.read') {
        notificationListDirty.value = true
        if (notificationVisible.value) {
            void loadNotifications()
        }
    }
}

function ensureNotificationStream() {
    if (notificationStream || !hasAuthToken()) {
        return
    }
    notificationStream = $notification.openStream({
        onEvent: (event, data) => {
            applyNotificationEvent(event, data)
        },
        onError: (error) => {
            if (notificationErrorShown) {
                return
            }
            notificationErrorShown = true
            console.error('通知流连接失败', error)
        }
    })
}

function closeNotificationStream() {
    if (notificationStream) {
        notificationStream.close()
        notificationStream = null
    }
}

async function copyCurrentAddress() {
    const address = String(currentAccount.value || '').trim()
    if (!address || isAddressCopied.value) {
        return
    }
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(address)
        } else {
            const textarea = document.createElement('textarea')
            textarea.value = address
            textarea.setAttribute('readonly', 'readonly')
            textarea.style.position = 'fixed'
            textarea.style.left = '-9999px'
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand('copy')
            document.body.removeChild(textarea)
        }
        isAddressCopied.value = true
        if (copiedTimer !== null) {
            window.clearTimeout(copiedTimer)
        }
        copiedTimer = window.setTimeout(() => {
            isAddressCopied.value = false
            copiedTimer = null
        }, 1200)
    } catch (error) {
        console.error('复制地址失败', error)
    }
}

const handleAccountCommand = async (command: string | number | object) => {
    const action = String(command)
    if (action !== 'logout') {
        return
    }
    logoutWithUcan({ redirect: false })
    currentAccount.value = null
    closeNotificationStream()
    notifications.value = []
    unreadCount.value = 0
    await router.push('/')
}

const shortAddress = computed(() => {
    if (!currentAccount.value) {
        return ''
    }
    const address = currentAccount.value
    if (address.length <= 10) {
        return address
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`
})

const fullAddress = computed(() => String(currentAccount.value || '').trim())
const copyIconLabel = computed(() => (isAddressCopied.value ? '地址已复制' : '复制完整地址'))
const unreadBadgeText = computed(() => {
    if (unreadCount.value <= 0) {
        return ''
    }
    return unreadCount.value > 99 ? '99+' : String(unreadCount.value)
})

const handleAccountChanged = (event: Event) => {
    const detail = (event as CustomEvent).detail
    currentAccount.value = detail?.account ?? getCurrentAccount()
    notificationErrorShown = false
    closeNotificationStream()
    if (currentAccount.value) {
        notificationListDirty.value = true
        void loadUnreadCount()
        ensureNotificationStream()
        return
    }
    notifications.value = []
    unreadCount.value = 0
    notificationListDirty.value = false
}

onMounted(() => {
    currentAccount.value = getCurrentAccount()
    window.addEventListener('wallet:accountChanged', handleAccountChanged)
    if (currentAccount.value && hasAuthToken()) {
        notificationListDirty.value = true
        void loadUnreadCount()
        ensureNotificationStream()
    }
})

watch(
    [() => route.name, () => route.query.keyword],
    ([nextName, nextKeyword]) => {
        if (nextName !== 'appCenter') {
            return
        }
        if (!showMarketSearch.value) {
            return
        }
        marketKeyword.value = String(nextKeyword || '')
    },
    { immediate: true }
)

onBeforeUnmount(() => {
    window.removeEventListener('wallet:accountChanged', handleAccountChanged)
    closeNotificationStream()
    if (copiedTimer !== null) {
        window.clearTimeout(copiedTimer)
        copiedTimer = null
    }
})

</script>
<style scoped lang="less">
.header{
    padding: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #e5e7eb;
    .left{
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .center{
        flex: 1;
        display: flex;
        justify-content: center;
        .market-search{
            width: 560px;
            max-width: 100%;
        }
    }
    .account{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: rgba(0,0,0,0.85);
        .dev-entry-btn{
            height: 28px;
            border: 1px solid rgba(0,0,0,0.12);
            border-radius: 8px;
            padding: 0 10px;
            background: white;
            color: rgba(0,0,0,0.72);
            cursor: pointer;
            transition: all 0.2s ease;
            &:hover{
                border-color: rgba(0,0,0,0.2);
                color: rgba(0,0,0,0.88);
            }
        }
        .help-link-btn{
            width: 24px;
            height: 24px;
            border: none;
            border-radius: 999px;
            background: transparent;
            color: rgba(0,0,0,0.38);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: color 0.2s ease, background-color 0.2s ease;
            &:hover{
                color: rgba(0,0,0,0.62);
                background: rgba(0,0,0,0.05);
            }
        }
        .help-link-btn:focus-visible{
            outline: 2px solid rgba(0,0,0,0.14);
            outline-offset: 1px;
        }
        .notification-btn{
            min-width: 30px;
            height: 30px;
            border: none;
            border-radius: 999px;
            background: transparent;
            color: rgba(0,0,0,0.5);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: color 0.2s ease, background-color 0.2s ease;
            &:hover{
                color: rgba(0,0,0,0.76);
                background: rgba(0,0,0,0.05);
            }
        }
        .account-trigger{
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            user-select: none;
            padding: 4px 8px;
            border-radius: 10px;
            transition: background-color 0.2s ease;
            &:hover{
                background: rgba(0,0,0,0.04);
            }
        }
        .account-text{
            line-height: 1;
        }
        .copy-address-btn{
            width: 20px;
            height: 20px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: rgba(0,0,0,0.45);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: color 0.2s ease, background-color 0.2s ease;
            &:hover{
                color: rgba(0,0,0,0.8);
                background: rgba(0,0,0,0.08);
            }
        }
        .copy-address-btn:focus-visible{
            outline: 2px solid rgba(0,0,0,0.15);
            outline-offset: 1px;
        }
        .account-arrow{
            display: inline-flex;
            align-items: center;
            font-size: 12px;
            color: rgba(0,0,0,0.45);
        }
    }
}

:deep(.notification-popover){
    padding: 0 !important;
    border-radius: 14px !important;
    overflow: hidden;
}

.notification-panel{
    background: #fff;
}

.notification-panel-head{
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.notification-head-actions{
    display: inline-flex;
    align-items: center;
    gap: 10px;
}

.notification-title{
    font-size: 14px;
    font-family: var(--app-font-display);
    font-weight: 600;
    color: rgba(15, 23, 42, 0.92);
}

.notification-summary{
    font-size: 12px;
    color: rgba(15, 23, 42, 0.45);
}

.notification-read-all-btn{
    border: none;
    background: transparent;
    padding: 0;
    font-size: 12px;
    color: rgba(22, 119, 255, 1);
    cursor: pointer;
}

.notification-empty{
    padding: 28px 16px;
    text-align: center;
    font-size: 13px;
    color: rgba(15, 23, 42, 0.42);
}

.notification-item{
    width: 100%;
    border: none;
    border-top: 1px solid rgba(15, 23, 42, 0.06);
    background: transparent;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 16px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.2s ease;
    &:hover{
        background: rgba(15, 23, 42, 0.03);
    }
}

.notification-marker{
    width: 7px;
    height: 7px;
    border-radius: 999px;
    margin-top: 7px;
    flex: 0 0 7px;
    background: transparent;
    &.unread{
        background: #f97316;
    }
}

.notification-body{
    min-width: 0;
    flex: 1;
}

.notification-item-head{
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
}

.notification-item-title{
    min-width: 0;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(15, 23, 42, 0.9);
    font-weight: 500;
}

.notification-item-time{
    flex: 0 0 auto;
    font-size: 12px;
    color: rgba(15, 23, 42, 0.4);
}

.notification-item-text{
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(15, 23, 42, 0.55);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

@media (max-width: 992px) {
    .header{
        .center{
            display: none;
        }
    }
}
</style>
