<template>
    <div class="header">
        <div class="left">
            <img @click="go('/')" class="w-24 h-6 pr-4 border-r" src="../../assets/img/logo.svg"/>
        </div>
        <div class="hidden lg:flex">
        </div>
        <div class="account">
            <el-dropdown
                v-if="shortAddress"
                trigger="click"
                placement="bottom-end"
                @command="handleAccountCommand"
            >
                <span class="account-trigger">
                    {{ shortAddress }}
                    <span class="account-arrow">v</span>
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
import { getCurrentAccount, logoutWithUcan } from '@/plugins/auth'

const router = useRouter();
const currentAccount = ref<string | null>(null)

const go = async (url: string) => {
    router.push(url)
}

const handleAccountCommand = async (command: string | number | object) => {
    if (command !== 'logout') {
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
        font-size: 14px;
        color: rgba(0,0,0,0.85);
        .account-trigger{
            display: inline-flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        .account-arrow{
            margin-left: 6px;
            font-size: 12px;
            color: rgba(0,0,0,0.45);
        }
    }
}
</style>
