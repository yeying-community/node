<template>
    <div class="apply">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item>应用中心</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="top-group">
            <div class="search">
                <el-input
                    v-model="searchVal"
                    size="large"
                    placeholder="支持输入应用名称/应用所有者名称搜索"
                    @keyup.enter="search"
                >
                    <template #suffix>
                        <el-icon class="el-input__icon search-icon" @click="search">
                            <Search />
                        </el-icon>
                    </template>
                </el-input>
                <el-button type="primary" size="large" @click="changeRouter('/market/apply-edit')">创建应用</el-button>
            </div>
        </div>
        <div>
            <el-tabs v-model="activeService" class="demo-tabs" @tab-click="handleTabClick">
                <template v-for="item in tabs" :key="item.name">
                    <el-tab-pane :label="item.title" :name="item.name">
                        <div class="item-group">
                            <template v-for="(app, index) in applicationList" :key="index + app.name">
                                <MarketBlock :detail="app" :refreshCardList="search" :pageFrom="activeService" />
                            </template>
                        </div>
                    </el-tab-pane>
                </template>
            </el-tabs>
        </div>
        <div class="pagination-wrap">
            <el-pagination
                layout="prev, pager, next"
                :total="pagination.total"
                :page-size="pagination.pageSize"
                :current-page="pagination.page"
                @current-change="handleCurrentChange"
                @size-change="handleSizeChange"
            />
        </div>
    </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import $application, { ApplicationMetadata } from '@/plugins/application'
import MarketBlock from '@/views/components/MarketBlock.vue'
import { useRouter, useRoute, RouteLocationAsPathGeneric, RouteLocationAsRelativeGeneric } from 'vue-router'
import { userInfo } from '@/plugins/account'
import $audit, { AuditAuditDetail, AuditAuditMetadata, convertAuditMetadata } from '@/plugins/audit'
import { notifyError } from '@/utils/message'
import { AuditDetailBox } from '@/stores/audit'
import { getCurrentAccount } from '@/plugins/auth'

const searchVal = ref<string>('')
const activeService = ref<string>('market')
const applicationList = ref<ApplicationMetadata[]>([])
const router = useRouter()

interface Tab {
  name: string;
  title: string;
}

const tabs: Tab[] = [
  {
    name: 'market',
    title: '应用市场',
  },
  {
    name: 'myCreate',
    title: '我创建的',
  },
  {
    name: 'myApply',
    title: '我申请的',
  },
];

const pagination = ref({
    pageSize: 10,
    page: 1,
    total: 0
})

const handleTabClick = (tab: Tab) => {
    activeService.value = tab.props.name
    pagination.value.page = 1
}

const search = async () => {
    try {
        let condition = { keyword: searchVal.value, status: "APPLICATION_STATUS_ONLINE" }
        const account = getCurrentAccount()
        if (account === undefined || account === null) {
            notifyError("❌未查询到当前账户，请登录")
            return
        }
        console.log(`activeService.value=${activeService.value}`)
        applicationList.value = []
        if (activeService.value === 'myCreate') {
            const res = await $application.myCreateList(account)
            if (Array.isArray(res)) {
                applicationList.value = res
            } else {
                console.warn('Expected array, but got:', res)
                applicationList.value = []
            }
            pagination.value.total = 0
            return;
        } else if (activeService.value === 'myApply') {
            let res = await $application.myApplyList(account)
            // 过滤出审批通过的
            const applicant = `${account}::${account}`
            let auditMyApply: AuditAuditDetail[] = await $audit.search({applicant: applicant})
            if (auditMyApply === undefined) {
                return;
            }
            auditMyApply = auditMyApply.filter((item) => item.meta?.reason === '申请使用')
            if (auditMyApply === undefined) {
                return;
            }
            let resApp: AuditDetailBox[] = convertAuditMetadata(auditMyApply)
            let names: string[] = resApp.filter((s) => s.state === '审批通过' && s.serviceType === 'application').map(a => a.name)
            res = res.filter((b) => names.includes(b.name))
            if (Array.isArray(res)) {
                applicationList.value = res
            } else {
                console.warn('Expected array, but got:', res)
                applicationList.value = []
            }
            pagination.value.total = 0
            return;
        }
        const res = await $application.search(condition, pagination.value.page, pagination.value.pageSize)
        if (Array.isArray(res)) {
            applicationList.value = res
        } else {
            console.warn('Expected array, but got:', res)
            applicationList.value = []
        }
        pagination.value.total = 0
    } catch (error) {
        console.error('❌获取应用列表失败', error)
        notifyError(`❌获取应用列表失败 ${error}`)
    }
}

const handleCurrentChange = (currentPage: number) => {
    pagination.value.page = currentPage
}

const handleSizeChange = (pageSize: number) => {
    pagination.value = {
        ...pagination.value,
        pageSize,
        page: 1 // 切换每页数量时重置页码
    }
}

const changeRouter = (url: string|RouteLocationAsRelativeGeneric|RouteLocationAsPathGeneric) => {
    router.push(url)
}

// 监听分页参数或搜索关键词变化，触发数据请求
watch(
    [() => pagination.value.page, () => pagination.value.pageSize, () => searchVal.value, () => activeService.value],
    () => {
        search()
    },
    { immediate: true }
)

onMounted(() => {
    search()
})
</script>
<style scoped lang="less">
:deep(.el-tabs__nav-scroll) {
    background: white;
    padding-left: 12px;
}
.apply {
    margin: 20px;

    .top-group {
        background: white;
        margin-top: 20px;
        padding: 12px;
        .search {
            width: 50%;
            display: flex;
            gap: 20px;
        }
        @media (max-width: 768px) {
            .search {
                width: 100%;
            }
        }
    }
    .item-group {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 20px;
    }

    .pagination-wrap {
        width: 100%;
        display: flex;
        justify-content: flex-end;
        margin-top: 24px;

        .el-pagination * {
            background-color: transparent;
        }
    }
}
</style>
