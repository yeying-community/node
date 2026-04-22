<template>
    <el-table :data="items" style="width: 100%; display: flex">
        <el-table-column prop="name" label="应用/服务名称" width="400">
            <template #default="scope">
                <div class="name">{{ scope.row.name }}</div>
                <el-tooltip class="box-item" effect="dark" :content="scope.row.desc" placement="top-start">
                    <el-text class="w-400px mb-2" truncated>{{ scope.row.desc }}</el-text>
                </el-tooltip>
            </template>
        </el-table-column>
        <el-table-column prop="serviceType" label="申请类型" width="100" />
        <el-table-column prop="applicantor" label="申请人" width="200">
            <template #default="scope">
                <el-tooltip class="box-item" effect="dark" :content="extractApplicant(scope.row.applicantor)" placement="top-start">
                    <span class="address-cell">{{ shortAddress(scope.row.applicantor) }}</span>
                </el-tooltip>
            </template>
        </el-table-column>
        <el-table-column prop="state" label="状态" width="140" show-overflow-tooltip>
            <template #default="scope">
                <div class="state-cell">
                    <div class="state-main">
                        <el-badge
                            is-dot
                            :type="statusInfo[scope.row.state]"
                            style="margin-top: 10px; margin-right: 8px"
                        />{{ scope.row.state }}
                        <el-tooltip class="box-item" effect="dark" :content="scope.row.msg || '-'" placement="top-start">
                            <el-icon v-if="pageTabFrom === 'finishApproval'" style="margin-top: 15px"><Warning /></el-icon>
                        </el-tooltip>
                    </div>
                </div>
            </template>
        </el-table-column>
        <el-table-column prop="progress" label="同意进度" width="140">
            <template #default="scope">
                <span class="state-progress">{{ scope.row.progress || '-' }}</span>
            </template>
        </el-table-column>
        <el-table-column prop="date" label="申请时间" width="200">
            <template #default="scope">
                {{ dayjs(scope.row.date).format('YYYY-MM-DD HH:mm:ss') }}
            </template>
        </el-table-column>

        <el-table-column fixed="right" label="操作" width="100px">
            <template #default="scope">
                <el-button
                    v-if="pageTabFrom === 'waitApproval'"
                    link
                    type="primary"
                    size="small"
                    @click="handleClick(scope.row)"
                    >去审批</el-button
                >
                <div v-else>-</div>
            </template>
        </el-table-column>
    </el-table>

    <ApplRoveModal
        :applroveShow="applroveShow"
        :uid="record.uid"
        :closeClick="closeClick"
        :afterSubmit="handleAfterSubmit"
    />
</template>

<script lang="ts" setup>
import ApplRoveModal from './ApplRoveModal.vue'
import dayjs from 'dayjs'
import { Warning } from '@element-plus/icons-vue'
import { ref } from 'vue'
import type { AuditDetailBox } from '@/plugins/audit'

const emit = defineEmits(['refresh'])

const applroveShow = ref(false)
const record = ref<AuditDetailBox>({
    uid: '',
    name : '',
    desc : '',
    applicantor: '',
    state: '',
    date: '',
    serviceType: '',
    progress: '',
})

const statusInfo = {
    待审批: 'primary',
    审批通过: 'success',
    审批驳回: ''
}

const extractApplicant = (value?: string) => {
    const raw = String(value || '').trim()
    if (!raw) {
        return '-'
    }
    const [first] = raw.split('::')
    return first?.trim() || raw
}

const shortAddress = (value?: string) => {
    const address = extractApplicant(value)
    if (address === '-' || address.length <= 12) {
        return address
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}

const handleClick = (row: any) => {
    record.value = row 
    applroveShow.value = true
}

const closeClick = () => {
    applroveShow.value = false
}

const handleAfterSubmit = () => {
    applroveShow.value = false
    emit('refresh')
}

const props = defineProps({
    pageTabFrom: String, // finishApproval审批完成 / waitApproval待我审批
    items: {
        type: Array as () => AuditDetailBox[],
        default: () => []
    }
})
</script>
<style scoped lang="less">
:deep(.el-table__header th) {
    background-color: #fafafa !important;
    color: rgba(0, 0, 0, 0.88) !important;
}

:deep(.el-table__header .cell) {
    font-weight: 500;
}

:deep(.el-table__body .cell) {
    font-weight: 400;
}

.name {
    color: rgba(22, 119, 255, 1);
    font-weight: 500;
}

:deep(.el-badge__content.is-dot) {
    height: 10px;
    width: 10px;
}

.state-cell {
    display: flex;
    align-items: center;
}

.state-main {
    display: inline-flex;
    align-items: center;
}

.address-cell {
    display: inline-block;
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.state-progress {
    font-size: 13px;
    line-height: 1.45;
    color: rgba(0, 0, 0, 0.45);
}
</style>
