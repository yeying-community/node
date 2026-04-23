<template>
    <div class="app-center">
        <div class="item-group">
            <template v-for="(app, index) in applicationList" :key="index + app.name">
                <MarketBlock :detail="app" :refreshCardList="search" pageFrom="market" />
            </template>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import $application, { type ApplicationMetadata } from '@/plugins/application'
import MarketBlock from '@/views/components/MarketBlock.vue'
import { notifyError } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'

const route = useRoute()
const applicationList = ref<ApplicationMetadata[]>([])
const keyword = computed(() => String(route.query.keyword || '').trim())

const search = async () => {
    try {
        const account = getCurrentAccount()
        if (!account) {
            notifyError('❌未查询到当前账户，请登录')
            return
        }
        const result = await $application.search(
            {
                keyword: keyword.value,
                status: 'BUSINESS_STATUS_ONLINE'
            },
            1,
            100
        )
        applicationList.value = Array.isArray(result) ? result : []
    } catch (error) {
        notifyError(`❌获取应用列表失败 ${error}`)
    }
}

watch(
    () => route.query.keyword,
    () => {
        void search()
    },
    { immediate: true }
)
</script>

<style scoped lang="less">
.app-center {
    margin: 20px;
}

.item-group {
    margin-top: 20px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
}
</style>
