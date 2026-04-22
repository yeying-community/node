<template>
    <div class="header">
        <div class="left">
            <img @click="go('/')" class="w-24 h-6 pr-4 border-r" src="../../assets/img/logo.svg"/>
        </div>
        <div class="hidden lg:flex">
        </div>
        <div class="account">
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CaretBottom, Check, DocumentCopy, QuestionFilled } from '@element-plus/icons-vue'
import { getCurrentAccount, logoutWithUcan } from '@/plugins/auth'

const router = useRouter();
const currentAccount = ref<string | null>(null)
const isAddressCopied = ref(false)
let copiedTimer: number | null = null

const go = async (url: string) => {
    router.push(url)
}

function openHelpDoc() {
    window.open('/help.html', '_blank', 'noopener,noreferrer')
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

const handleAccountChanged = (event: Event) => {
    const detail = (event as CustomEvent).detail
    currentAccount.value = detail?.account ?? getCurrentAccount()
}

onMounted(() => {
    currentAccount.value = getCurrentAccount()
    window.addEventListener('wallet:accountChanged', handleAccountChanged)
})

onBeforeUnmount(() => {
    window.removeEventListener('wallet:accountChanged', handleAccountChanged)
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
    border-bottom: 1px solid #e5e7eb;
    .left{
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .account{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: rgba(0,0,0,0.85);
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
</style>
