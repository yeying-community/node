<template>
    <div class="app-center">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item>应用中心</el-breadcrumb-item>
        </el-breadcrumb>

        <div class="toolbar">
            <el-input
                v-model="keyword"
                size="large"
                placeholder="搜索应用名称/作者地址"
                @keyup.enter="search"
            >
                <template #suffix>
                    <el-icon class="el-input__icon search-icon" @click="search">
                        <Search />
                    </el-icon>
                </template>
            </el-input>
            <el-button type="primary" size="large" @click="changeRouter('/market/apply-edit')">
                创建应用
            </el-button>
        </div>

        <div class="item-group">
            <template v-for="(app, index) in applicationList" :key="index + app.name">
                <MarketBlock :detail="app" :refreshCardList="search" pageFrom="market" />
            </template>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useRouter, RouteLocationAsPathGeneric, RouteLocationAsRelativeGeneric } from 'vue-router'
import $application, { type ApplicationMetadata } from '@/plugins/application'
import MarketBlock from '@/views/components/MarketBlock.vue'
import { notifyError } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'

const router = useRouter()
const keyword = ref('')
const applicationList = ref<ApplicationMetadata[]>([])

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

const changeRouter = (url: string | RouteLocationAsRelativeGeneric | RouteLocationAsPathGeneric) => {
    router.push(url)
}

onMounted(() => {
    void search()
})
</script>

<style scoped lang="less">
.app-center {
    margin: 20px;
}

.toolbar {
    margin-top: 20px;
    padding: 12px;
    background: white;
    display: flex;
    gap: 16px;
}

.item-group {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
}

@media (max-width: 768px) {
    .toolbar {
        flex-direction: column;
    }
}
</style>
