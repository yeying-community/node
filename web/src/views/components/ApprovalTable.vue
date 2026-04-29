<template>
    <el-table :data="items" style="width: 100%" :row-class-name="resolveRowClassName">
        <el-table-column prop="name" label="名称" min-width="300">
            <template #default="scope">
                <div class="name-row">
                    <div class="name">{{ scope.row.name }}</div>
                    <span v-if="isJustHandled(scope.row)" class="handled-tag">刚刚处理</span>
                </div>
                <el-tooltip class="box-item" effect="dark" :content="scope.row.desc" placement="top-start">
                    <el-text class="w-400px mb-2" truncated>{{ scope.row.desc }}</el-text>
                </el-tooltip>
            </template>
        </el-table-column>
        <el-table-column prop="typeLabel" label="类型" width="90" />
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

        <el-table-column fixed="right" label="操作" width="110">
            <template #default="scope">
                <el-button
                    v-if="pageTabFrom === 'waitApproval'"
                    link
                    type="primary"
                    size="small"
                    @click="handleClick(scope.row)"
                    >去审批</el-button
                >
                <el-button
                    v-else
                    link
                    type="primary"
                    size="small"
                    @click="handleDetail(scope.row)"
                    >详情</el-button
                >
            </template>
        </el-table-column>
    </el-table>
</template>

<script lang="ts" setup>
import dayjs from 'dayjs'
import { Warning } from '@element-plus/icons-vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AuditDetailBox } from '@/plugins/audit'

const emit = defineEmits(['refresh', 'open-approve'])
const router = useRouter()

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
    emit('open-approve', row)
}

const handleDetail = (row: AuditDetailBox) => {
    const auditId = String(row.uid || '').trim()
    if (!auditId) {
        return
    }
    const query: Record<string, string> = {
        pageFrom: 'myApply',
        auditId
    }
    if (row.targetUid) {
        query.uid = String(row.targetUid)
    }
    if (row.targetDid) {
        query.did = String(row.targetDid)
    }
    if (row.targetVersion !== undefined && row.targetVersion !== null) {
        query.version = String(row.targetVersion)
    }
    router.push({ path: '/market/dev/apply-detail', query })
}

const resolveRowClassName = ({ row }: { row: AuditDetailBox }) => {
    const highlightAuditId = String(props.highlightAuditId || '').trim()
    const rowAuditId = String(row.uid || '').trim()
    if (highlightAuditId && rowAuditId === highlightAuditId) {
        return 'approval-row-highlight'
    }
    return ''
}

const isJustHandled = (row: AuditDetailBox) => {
    const highlightAuditId = String(props.highlightAuditId || '').trim()
    const rowAuditId = String(row.uid || '').trim()
    return Boolean(highlightAuditId && rowAuditId === highlightAuditId)
}

const props = defineProps({
    pageTabFrom: String, // finishApproval审批完成 / waitApproval待我审批
    highlightAuditId: String,
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

.name-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.handled-tag {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: rgba(34, 197, 94, 0.12);
    color: rgba(21, 128, 61, 0.95);
    font-size: 12px;
    line-height: 1;
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

:deep(.approval-row-highlight > td) {
    background: rgba(34, 197, 94, 0.08) !important;
}
</style>
