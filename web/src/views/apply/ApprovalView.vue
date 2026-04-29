<template>
    <div class="approval">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item>我的审批</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="content">
            <div class="header">
                <div :class="{ active: tabIndex == 0 }" @click="changeTab(0)" style="cursor: pointer">待我审批</div>
                <div :class="{ active: tabIndex == 1 }" @click="changeTab(1)" style="cursor: pointer">审批完成</div>
            </div>
            <el-divider />

            <div class="filter">
                <el-form :inline="true" :model="formInline" ref="formRef" class="demo-form-inline">
                    <div v-if="tabIndex === 0">
                        <el-form-item label="名称：" prop="appName">
                            <el-input v-model="formInline.appName" placeholder="请输入应用名称搜索" clearable />
                        </el-form-item>
                        <el-form-item label="类型：" prop="auditType">
                            <el-select v-model="formInline.auditType" placeholder="请选择" class="input-style" clearable>
                                <el-option
                                    v-for="item in auditTypeOptions"
                                    :key="item.value"
                                    :label="item.label"
                                    :value="item.value"
                                />
                            </el-select>
                        </el-form-item>
                        <el-form-item label="申请人：" prop="people">
                            <el-input v-model="formInline.people" placeholder="请输入申请人地址" clearable />
                        </el-form-item>
                        <el-form-item label="申请时间：" prop="time">
                            <el-date-picker
                                v-model="formInline.time"
                                type="daterange"
                                value-format="YYYY-MM-DD"
                                range-separator=" "
                                start-placeholder="开始时间"
                                end-placeholder="结束时间"
                                size="default"
                            />
                        </el-form-item>
                    </div>
                    <div v-else>
                        <el-form-item label="名称：" prop="appName">
                            <el-input v-model="formInline.appName" placeholder="请输入应用名称搜索" clearable />
                        </el-form-item>
                        <el-form-item label="类型：" prop="auditType">
                            <el-select v-model="formInline.auditType" placeholder="请选择" class="input-style" clearable>
                                <el-option
                                    v-for="item in auditTypeOptions"
                                    :key="item.value"
                                    :label="item.label"
                                    :value="item.value"
                                />
                            </el-select>
                        </el-form-item>
                        <el-form-item label="申请人：" prop="people">
                            <el-input v-model="formInline.people" placeholder="请输入申请人地址" clearable />
                        </el-form-item>
                        <el-form-item label="审批状态：" prop="status">
                            <el-select v-model="formInline.status" placeholder="请选择" class="input-style" clearable>
                                <el-option
                                    v-for="item in approvalStatusOptions"
                                    :key="item.value"
                                    :label="item.label"
                                    :value="item.value"
                                />
                            </el-select>
                        </el-form-item>
                        <el-form-item label="申请时间：" prop="time">
                            <el-date-picker
                                v-model="formInline.time"
                                type="daterange"
                                value-format="YYYY-MM-DD"
                                range-separator=" "
                                start-placeholder="开始时间"
                                end-placeholder="结束时间"
                                size="default"
                            />
                        </el-form-item>
                    </div>

                    <el-form-item>
                        <el-button @click="onReset(formRef)">重置</el-button>
                        <el-button type="primary" @click="onSubmit()">查询</el-button>
                    </el-form-item>
                </el-form>
            </div>

            <div style="width: 100%">
                <ApprovalTable
                    :pageTabFrom="tabIndex ? 'finishApproval' : 'waitApproval'"
                    :highlightAuditId="highlightAuditId"
                    :items="tableData"
                    @refresh="search"
                    @open-approve="openApproveModal"
                />
            </div>
        </div>
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

    <ApplRoveModal
        :applroveShow="approveDialogVisible"
        :uid="currentApproveAuditId"
        :closeClick="closeApproveModal"
        :afterSubmit="handleApproveSubmitted"
    />
</template>

<script lang="ts" setup>
import { ref, reactive, onBeforeUnmount, onMounted, watch } from 'vue'
import dayjs from 'dayjs'
import ApprovalTable from '@/views/components/ApprovalTable.vue'
import $audit, { AuditDetailBox, convertAuditMetadata } from '@/plugins/audit'
import { notifyError } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'
import { useRoute, useRouter } from 'vue-router'
import ApplRoveModal from '@/views/components/ApplRoveModal.vue'

const route = useRoute()
const router = useRouter()
const formRef = ref(null)
const tabIndex = ref(0)
const approveDialogVisible = ref(false)
const currentApproveAuditId = ref('')
const autoOpenedAuditId = ref('')
const highlightAuditId = ref('')
let highlightTimer: number | null = null
const formInline = reactive({
    appName: '',
    auditType: 'application',
    people: '',
    status: '',
    time: [] as string[]
})
const auditTypeOptions = [
    { label: '应用', value: 'application' },
    { label: '合约（预留）', value: 'contract' }
]
const approvalStatusOptions = [
    { label: '审批通过', value: '审批通过' },
    { label: '审批驳回', value: '审批驳回' }
]

const pagination = ref({
    pageSize: 10,
    page: 1,
    total: 0
})

const handleCurrentChange = (currentPage: number) => {
    pagination.value.page = currentPage
    void search()
}

const handleSizeChange = (pageSize: number) => {
    pagination.value = {
        ...pagination.value,
        pageSize,
        page: 1 // 切换每页数量时重置页码
    }
    void search()
}
const changeTab = (index: number) => {
    tabIndex.value = index
    pagination.value.page = 1
    void search()
}
const onReset = (formEl: any) => {
    formEl.resetFields()
    pagination.value.page = 1
    void search()
}

const tableData = ref<AuditDetailBox[]>([])

const openApproveModal = (row: AuditDetailBox) => {
    const auditId = String(row.uid || '').trim()
    if (!auditId) {
        return
    }
    currentApproveAuditId.value = auditId
    approveDialogVisible.value = true
}

const closeApproveModal = async () => {
    approveDialogVisible.value = false
    currentApproveAuditId.value = ''
    if (String(route.query.auditId || '').trim()) {
        const nextQuery = { ...route.query }
        delete nextQuery.auditId
        await router.replace({ path: route.path, query: nextQuery })
    }
}

const handleApproveSubmitted = async (input?: { decision?: string }) => {
    const handledAuditId = currentApproveAuditId.value
    approveDialogVisible.value = false
    currentApproveAuditId.value = ''
    if (tabIndex.value === 0 && (input?.decision === 'passed' || input?.decision === 'reject')) {
        tabIndex.value = 1
        formInline.status = input.decision === 'passed' ? '审批通过' : '审批驳回'
        pagination.value.page = 1
    }
    await search()
    if (handledAuditId) {
        highlightAuditId.value = handledAuditId
        if (highlightTimer !== null) {
            window.clearTimeout(highlightTimer)
        }
        highlightTimer = window.setTimeout(() => {
            highlightAuditId.value = ''
            highlightTimer = null
        }, 4000)
    }
    if (String(route.query.auditId || '').trim()) {
        const nextQuery = { ...route.query }
        delete nextQuery.auditId
        await router.replace({ path: route.path, query: nextQuery })
    }
}

const tryAutoOpenApproveModal = () => {
    if (tabIndex.value !== 0) {
        return
    }
    const targetAuditId = String(route.query.auditId || '').trim()
    if (!targetAuditId || autoOpenedAuditId.value === targetAuditId) {
        return
    }
    const targetRow = tableData.value.find((item) => String(item.uid || '').trim() === targetAuditId)
    if (!targetRow) {
        return
    }
    autoOpenedAuditId.value = targetAuditId
    openApproveModal(targetRow)
}

const search = async () => {
    try {
        const account = getCurrentAccount()
        if (account === undefined || account === null) {
            notifyError("❌未查询到当前账户，请登录")
            return
        }
        const approver = `${account}::${account}`
        const [startTime, endTime] = Array.isArray(formInline.time) ? formInline.time : []
        const states =
            tabIndex.value === 0
                ? ['待审批']
                : formInline.status
                ? [formInline.status]
                : ['审批通过', '审批驳回']
        const result = await $audit.searchPage({
            condition: {
                approver,
                name: formInline.appName,
                applicant: formInline.people || undefined,
                auditType: formInline.auditType || undefined,
                states,
                startTime: startTime ? dayjs(startTime).startOf('day').toISOString() : undefined,
                endTime: endTime ? dayjs(endTime).endOf('day').toISOString() : undefined
            },
            page: pagination.value.page,
            pageSize: pagination.value.pageSize
        })
        if (!result) {
            return
        }
        tableData.value = convertAuditMetadata(result.items || [])
        pagination.value.total = Number(result.page?.total || 0)
        pagination.value.page = Number(result.page?.page || pagination.value.page)
        pagination.value.pageSize = Number(result.page?.pageSize || pagination.value.pageSize)
        tryAutoOpenApproveModal()
    } catch (error) {
        console.error('获取审批列表失败', error)
        notifyError(`❌ 获取审批列表失败 ${error}`)
    }
}


/**
 * 我的审批页面，
 *
 */
const onSubmit = () => {
    pagination.value.page = 1
    search()
}

onMounted(() => {
    search()
})

onBeforeUnmount(() => {
    if (highlightTimer !== null) {
        window.clearTimeout(highlightTimer)
        highlightTimer = null
    }
})

watch(
    () => [route.query.auditId, tabIndex.value] as const,
    ([nextAuditId]) => {
        if (!String(nextAuditId || '').trim()) {
            autoOpenedAuditId.value = ''
            return
        }
        if (tabIndex.value !== 0) {
            tabIndex.value = 0
            return
        }
        tryAutoOpenApproveModal()
    },
    { immediate: true }
)
</script>
<style scoped lang="less">
.approval {
    margin: 20px;
    .content {
        margin-top: 16px;
        padding: 24px;
        background: #fff;
        border-radius: 6px;
        .header {
            font-size: 15px;
            font-weight: 400;
            color: rgba(0, 0, 0, 0.45);
            display: flex;
            gap: 30px;
        }
        .active {
            color: rgba(0, 0, 0, 0.85);
            font-weight: 500;
        }
    }
    .demo-form-inline .el-input {
        --el-input-width: 220px;
    }

    .demo-form-inline .el-select {
        --el-select-width: 220px;
    }
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
</style>
