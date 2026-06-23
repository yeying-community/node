<template>
    <el-table :data="items" style="width: 100%" :row-class-name="resolveRowClassName">
        <el-table-column prop="name" :label="$t('approval_table_name')" min-width="300">
            <template #default="scope">
                <div class="name-row">
                    <div class="name">{{ scope.row.name }}</div>
                    <span v-if="isJustHandled(scope.row)" class="handled-tag">{{ $t('approval_table_just_handled') }}</span>
                </div>
                <el-tooltip class="box-item" effect="dark" :content="scope.row.desc" placement="top-start">
                    <el-text class="w-400px mb-2" truncated>{{ scope.row.desc }}</el-text>
                </el-tooltip>
            </template>
        </el-table-column>
        <el-table-column prop="typeLabel" :label="$t('approval_table_type')" width="90" />
        <el-table-column prop="applicantor" :label="$t('approval_table_applicant')" width="200">
            <template #default="scope">
                <el-tooltip class="box-item" effect="dark" :content="extractApplicant(scope.row.applicantor)" placement="top-start">
                    <span class="address-cell">{{ shortAddress(scope.row.applicantor) }}</span>
                </el-tooltip>
            </template>
        </el-table-column>
        <el-table-column prop="state" :label="$t('approval_table_status')" width="140" show-overflow-tooltip>
            <template #default="scope">
                <div class="state-cell">
                    <div class="state-main">
                        <el-badge
                            is-dot
                            :type="statusInfo[scope.row.state]"
                            style="margin-top: 10px; margin-right: 8px"
                        />{{ formatStatus(scope.row.state) }}
                        <el-tooltip class="box-item" effect="dark" :content="scope.row.msg || '-'" placement="top-start">
                            <el-icon v-if="pageTabFrom === 'finishApproval'" style="margin-top: 15px"><Warning /></el-icon>
                        </el-tooltip>
                    </div>
                </div>
            </template>
        </el-table-column>
        <el-table-column prop="progress" :label="$t('approval_table_progress')" width="140">
            <template #default="scope">
                <span class="state-progress">{{ scope.row.progress || '-' }}</span>
            </template>
        </el-table-column>
        <el-table-column prop="date" :label="$t('approval_table_time')" width="200">
            <template #default="scope">
                {{ dayjs(scope.row.date).format('YYYY-MM-DD HH:mm:ss') }}
            </template>
        </el-table-column>

        <el-table-column fixed="right" :label="$t('approval_table_actions')" width="110">
            <template #default="scope">
                <el-button
                    v-if="pageTabFrom === 'waitApproval'"
                    link
                    type="primary"
                    size="small"
                    @click="handleClick(scope.row)"
                    >{{ $t('approval_table_go_approve') }}</el-button
                >
                <el-button
                    v-else
                    link
                    type="primary"
                    size="small"
                    @click="handleDetail(scope.row)"
                    >{{ $t('approval_table_detail') }}</el-button
                >
            </template>
        </el-table-column>
    </el-table>
</template>

<script lang="ts" setup>
import dayjs from 'dayjs'
import { Warning } from '@element-plus/icons-vue'
import { getCurrentInstance, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { AuditDetailBox } from '@/plugins/audit'

const emit = defineEmits(['refresh', 'open-approve'])
const router = useRouter()
const { proxy } = getCurrentInstance()!
const { $t } = proxy

const statusInfo = {
    待审批: 'primary',
    审批通过: 'success',
    审批驳回: 'danger'
}

const statusLabelMap: Record<string, string> = {
    待审批: String($t('approval_status_pending')),
    审批通过: String($t('approval_status_passed')),
    审批驳回: String($t('approval_status_rejected'))
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

const formatStatus = (value?: string) => {
    const status = String(value || '').trim()
    return statusLabelMap[status] || status || '-'
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
    pageTabFrom: String,
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
