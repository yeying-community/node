<template>
    <div class="header">
        <div class="left">
            <img @click="go('/')" class="w-24 h-6 pr-4 border-r" src="../../assets/img/logo.svg"/>
        </div>
        <div class="hidden lg:flex">
        </div>
        <div class="account">
            <span v-if="shortAddress">{{ shortAddress }}</span>
            <span v-else>--</span>
        </div>
    </div>
</template>
<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getCurrentAccount } from '@/plugins/auth'

const router = useRouter();
const currentAccount = ref<string | null>(null)

const go = async (url: string) => {
    router.push(url)
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
    }
}
</style>
