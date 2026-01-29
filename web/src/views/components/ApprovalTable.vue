<template>
    <el-table :data="store.items" style="width: 100%; display: flex">
        <el-table-column prop="name" label="应用/服务名称" width="400">
            <template #default="scope">
                <div class="name">{{ scope.row.name }}</div>
                <el-tooltip class="box-item" effect="dark" :content="scope.row.desc" placement="top-start">
                    <el-text class="w-400px mb-2" truncated>{{ scope.row.desc }}</el-text>
                </el-tooltip>
            </template>
        </el-table-column>
        <el-table-column prop="serviceType" label="申请类型" width="100" />
        <el-table-column prop="applicantor" label="申请人" width="200" show-overflow-tooltip />
        <el-table-column prop="state" label="状态" width="200" show-overflow-tooltip>
            <template #default="scope">
                <el-badge is-dot :type="statusInfo[scope.row.state]" style="margin-top: 10px; margin-right: 8px" />{{
                    scope.row.state
                }}
                <el-tooltip class="box-item" effect="dark" :content="scope.row.msg" placement="top-start">
                    <el-icon v-if="pageTabFrom === 'finishApproval'" style="margin-top: 15px"><Warning /></el-icon>
                </el-tooltip>
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

    <ApplRoveModal :applroveShow="applroveShow" :uid="record.uid" :closeClick="closeClick" />
</template>

<script lang="ts" setup>
import ApplRoveModal from './ApplRoveModal.vue'
import dayjs from 'dayjs'
import { Warning } from '@element-plus/icons-vue'
import { ref, reactive, onMounted, watch } from 'vue'
import { userInfo } from '@/plugins/account'
import $audit, { AuditAuditDetail, resolveAuditState } from '@/plugins/audit'
import { AuditDetailBox, useDataStore } from '@/stores/audit'
import { notifyError } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'

const store = useDataStore()

const applroveShow = ref(false)
const tableData = ref<AuditDetailBox[]>(store.items)
const record = ref<AuditDetailBox>({
    uid: '',
    name : '',
    desc : '',
    applicantor: '',
    state: '',
    date: '',
    serviceType: '',
})

const statusInfo = {
    待审批: 'primary',
    审批通过: 'success',
    审批驳回: ''
}

const handleClick = (row: any) => {
    record.value = row 
    applroveShow.value = true
}

const closeClick = () => {
    applroveShow.value = false
}

const props = defineProps({
    pageTabFrom: String, // finishApproval审批完成 / waitApproval待我审批
    tableData: String
})



function cvData(auditMyApply: AuditAuditDetail) {
    if (auditMyApply === undefined || auditMyApply.meta === undefined || auditMyApply.meta.appOrServiceMetadata === undefined || auditMyApply.meta.applicant === undefined) {
        return null
    }
    
    const rawData = JSON.parse(auditMyApply.meta.appOrServiceMetadata);
    const did = auditMyApply.meta.applicant.split('::')[0]

    const metadata: AuditDetailBox = {
        uid: auditMyApply.meta.uid,
        name: rawData.name,
        desc: rawData.description,
        serviceType: auditMyApply.meta.auditType,
        applicantor: did,
        state: resolveAuditState(auditMyApply.commentMeta, auditMyApply.meta?.approver),
        date: auditMyApply.meta.createdAt
    };
    return metadata
 
}

function convertApplicationMetadata(auditMyApply: AuditAuditDetail[]) {
  return auditMyApply
    .map(cvData)
    .filter((item): item is AuditDetailBox => item !== null) // ✅ 过滤 null 并类型收窄
}

const search = async () => {
    try {
        const account = getCurrentAccount()
        if (account === undefined || account === null) {
            notifyError("❌未查询到当前账户，请登录")
            return
        }
        const approver = `${account}::${account}`
        const auditMyApply: AuditAuditDetail[] = await $audit.search({approver: approver})
        if (auditMyApply === undefined) {
                return;
            }
        let res: AuditDetailBox[] = convertApplicationMetadata(auditMyApply)
        if (props.pageTabFrom === 'finishApproval') {
            res = res.filter((s) => s.state === '审批通过' || s.state === '审批驳回')
        }
        if (props.pageTabFrom === 'waitApproval') {
            res = res.filter((s) => s.state === '待审批')
        }
        if (Array.isArray(res)) {
            tableData.value = res
        } else {
            console.warn('Expected array, but got:', res)
            tableData.value = []
        }
    } catch(error) {
        console.error('❌获取审批列表失败', error)
        notifyError(`❌获取审批列表失败 ${error}`)
        
    }
}

onMounted(() => {
    search()
})

</script>
<style scoped lang="less">
:deep(.el-table__header th) {
    background-color: #fafafa !important;
    color: rgba(0, 0, 0, 0.88) !important;
}
.name {
    color: rgba(22, 119, 255, 1);
}

:deep(.el-badge__content.is-dot) {
    height: 10px;
    width: 10px;
}
</style>
