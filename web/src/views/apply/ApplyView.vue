<template>
    <div class="apply">
        <div class="top-group">
            <div class="search">
                <el-input
                    v-model="searchVal"
                    size="large"
                    :placeholder="$t('market_search_placeholder')"
                    @keyup.enter="search"
                >
                    <template #suffix>
                        <el-icon class="el-input__icon search-icon" @click="search">
                            <Search />
                        </el-icon>
                    </template>
                </el-input>
                <el-button v-if="activeService === 'myCreate'" type="primary" size="large" @click="changeRouter('/market/dev/apply-edit')">
                    {{ $t('market_create_app') }}
                </el-button>
            </div>
        </div>
        <div>
            <el-tabs v-model="activeService" class="demo-tabs" @tab-click="handleTabClick">
                <template v-for="item in tabs" :key="item.name">
                    <el-tab-pane :label="item.title" :name="item.name">
                        <ApplicationListTable
                            :items="applicationList"
                            :page-from="item.name"
                            :refresh-list="search"
                        />
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
import { getCurrentInstance, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import $application, { ApplicationMetadata } from '@/plugins/application'
import ApplicationListTable from '@/views/components/ApplicationListTable.vue'
import { useRouter, RouteLocationAsPathGeneric, RouteLocationAsRelativeGeneric } from 'vue-router'
import { notifyError } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'

const searchVal = ref<string>('')
const activeService = ref<string>('myCreate')
const applicationList = ref<ApplicationMetadata[]>([])
const router = useRouter()
const { proxy } = getCurrentInstance()!
const { $t } = proxy

interface Tab {
  name: string;
  title: string;
}

const tabs: Tab[] = [
  {
    name: 'myCreate',
    title: $t('market_my_created'),
  },
  {
    name: 'myApply',
    title: $t('market_my_applied'),
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
        const account = getCurrentAccount()
        if (account === undefined || account === null) {
            notifyError(String($t('market_missing_account')))
            return
        }
        applicationList.value = []
        if (activeService.value === 'myCreate') {
            const res = await $application.myCreateList(account)
            const list = Array.isArray(res) ? res : []
            if (searchVal.value) {
                const keyword = searchVal.value.toLowerCase()
                applicationList.value = list.filter((item) => {
                    return (
                        String(item.name || '').toLowerCase().includes(keyword) ||
                        String(item.owner || '').toLowerCase().includes(keyword) ||
                        String(item.ownerName || '').toLowerCase().includes(keyword)
                    )
                })
            } else {
                applicationList.value = list
            }
            pagination.value.total = 0
            return
        }
        if (activeService.value === 'myApply') {
            let res = await $application.myApplyList(account)
            if (searchVal.value) {
                res = res.filter((item) => {
                    const keyword = searchVal.value.toLowerCase()
                    return (
                        String(item.name || '').toLowerCase().includes(keyword) ||
                        String(item.owner || '').toLowerCase().includes(keyword) ||
                        String(item.ownerName || '').toLowerCase().includes(keyword)
                    )
                })
            }
            applicationList.value = Array.isArray(res) ? res : []
            pagination.value.total = 0
            return
        }
    } catch (error) {
        notifyError(`${$t('market_load_apps_failed')}：${error}`)
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
    [
        () => pagination.value.page,
        () => pagination.value.pageSize,
        () => searchVal.value,
        () => activeService.value
    ],
    () => {
        search()
    },
    { immediate: true }
)

const initialTab = String(router.currentRoute.value.query.tab || '').trim()
if (initialTab === 'myApply' || initialTab === 'myCreate') {
    activeService.value = initialTab
}
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
        margin-top: 0;
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
