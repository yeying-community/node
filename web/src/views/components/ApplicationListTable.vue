<template>
    <div class="list-wrap">
        <el-table :data="items" style="width: 100%">
            <el-table-column label="名称" min-width="300">
                <template #default="scope">
                    <div class="name-cell">
                        <el-avatar shape="square" size="34" :src="scope.row.avatar" />
                        <div class="name-main">
                            <div class="title">{{ scope.row.name || '-' }}</div>
                            <el-tooltip
                                class="box-item"
                                effect="dark"
                                :content="scope.row.description || '-'"
                                placement="top-start"
                            >
                                <el-text class="desc" truncated>{{ scope.row.description || '-' }}</el-text>
                            </el-tooltip>
                        </div>
                    </div>
                </template>
            </el-table-column>

            <el-table-column prop="code" label="分类" width="150">
                <template #default="scope">
                    {{ resolveApplicationCategoryLabel(scope.row.code) }}
                </template>
            </el-table-column>

            <el-table-column prop="owner" label="作者" width="180">
                <template #default="scope">
                    <el-tooltip class="box-item" effect="dark" :content="scope.row.owner || '-'" placement="top-start">
                        <span class="address-cell">{{ shortAddress(scope.row.owner) }}</span>
                    </el-tooltip>
                </template>
            </el-table-column>

            <el-table-column v-if="pageFrom === 'myCreate'" label="状态" width="150">
                <template #default="scope">
                    <span class="state-dot">
                        <el-badge is-dot :type="businessState(scope.row).type" />
                        <span>{{ businessState(scope.row).text }}</span>
                    </span>
                </template>
            </el-table-column>

            <el-table-column v-if="pageFrom === 'myApply'" label="申请状态" width="130">
                <template #default="scope">
                    <ApplyStatus :status="resolveApplyStatus(scope.row)" />
                </template>
            </el-table-column>

            <el-table-column label="时间" width="170">
                <template #default="scope">
                    {{ formatDate(scope.row.createdAt) }}
                </template>
            </el-table-column>

            <el-table-column fixed="right" label="操作" min-width="260">
                <template #default="scope">
                    <div class="actions">
                        <el-button link type="primary" size="small" @click="toDetail(scope.row)">详情</el-button>

                        <template v-if="pageFrom === 'myCreate'">
                            <el-button
                                v-if="isOnline(scope.row)"
                                link
                                type="primary"
                                size="small"
                                @click="handleOfflineConfirm(scope.row)"
                            >
                                下架应用
                            </el-button>
                            <el-button v-else link type="primary" size="small" @click="handleOnline(scope.row)">
                                上架应用
                            </el-button>
                            <el-button
                                v-if="!isOnline(scope.row)"
                                link
                                type="primary"
                                size="small"
                                @click="toEdit(scope.row)"
                            >
                                编辑
                            </el-button>
                            <el-popconfirm
                                v-if="!isOnline(scope.row)"
                                title="您确定要删除该应用吗？"
                                confirm-button-text="确定"
                                cancel-button-text="取消"
                                @confirm="toDelete(scope.row)"
                            >
                                <template #reference>
                                    <el-button link type="danger" size="small">删除</el-button>
                                </template>
                            </el-popconfirm>
                        </template>

                        <template v-if="pageFrom === 'myApply'">
                            <el-popconfirm
                                v-if="resolveApplyStatus(scope.row) === 'applying'"
                                title="您确定要取消当前应用的申请吗？"
                                confirm-button-text="确定"
                                cancel-button-text="取消"
                                @confirm="cancelApply(scope.row)"
                            >
                                <template #reference>
                                    <el-button link type="danger" size="small">取消申请</el-button>
                                </template>
                            </el-popconfirm>

                            <el-button
                                v-if="resolveApplyStatus(scope.row) === 'success'"
                                link
                                type="primary"
                                size="small"
                                @click="toConfigCapability(scope.row)"
                            >
                                配置能力
                            </el-button>

                            <el-button
                                v-if="resolveApplyStatus(scope.row) === 'reject'"
                                link
                                type="primary"
                                size="small"
                                @click="reApply(scope.row)"
                            >
                                重新申请
                            </el-button>
                        </template>

                        <el-button link type="primary" size="small" @click="exportIdentity(scope.row)">
                            导出身份
                        </el-button>
                    </div>
                </template>
            </el-table-column>
        </el-table>
    </div>

    <ApplyUseModal
        title="重新申请"
        :dialogVisible="dialogVisible"
        :detail="selectedRow"
        :afterSubmit="afterSubmit"
        :closeClick="afterSubmit"
    />
    <ConfigCapabilityModal
        :modalVisible="modalVisible"
        :cancelModal="cancelModal"
        :detail="selectedRow"
    />
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import ApplyStatus from './ApplyStatus.vue'
import ApplyUseModal from './ApplyUseModal.vue'
import ConfigCapabilityModal from './ConfigCapabilityModal.vue'
import $application, {
    type ApplicationMetadata,
    businessStatusMap,
    resolveApplicationCategoryLabel,
    resolveBusinessStatus
} from '@/plugins/application'
import $audit, { isAuditForResource } from '@/plugins/audit'
import { exportIdentityInfo } from '@/plugins/account'
import { getCurrentAccount } from '@/plugins/auth'
import { normalizeAddress } from '@/utils/actionSignature'
import { notifyError } from '@/utils/message'

const props = defineProps({
    items: {
        type: Array as () => ApplicationMetadata[],
        default: () => []
    },
    pageFrom: {
        type: String,
        default: 'myCreate'
    },
    refreshList: Function
})

const router = useRouter()
const dialogVisible = ref(false)
const modalVisible = ref(false)
const selectedRow = ref<ApplicationMetadata | null>(null)

const items = computed(() => props.items || [])

const shortAddress = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text) {
        return '-'
    }
    if (text.length <= 12) {
        return text
    }
    return `${text.slice(0, 6)}...${text.slice(-4)}`
}

const businessState = (row: ApplicationMetadata) => {
    const status = resolveBusinessStatus(row)
    return businessStatusMap[status] || businessStatusMap.BUSINESS_STATUS_UNKNOWN
}

const isOnline = (row: ApplicationMetadata) => resolveBusinessStatus(row) === 'BUSINESS_STATUS_ONLINE'

const formatDate = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text) {
        return '-'
    }
    const parsed = dayjs(text)
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '-'
}

const resolveApplyStatus = (row: ApplicationMetadata) => String(row.applyStatus || 'applying')

const refreshList = () => {
    props.refreshList?.()
}

const toDetail = (row: ApplicationMetadata) => {
    router.push({
        path: '/market/dev/apply-detail',
        query: {
            uid: row.uid,
            pageFrom: props.pageFrom,
            auditId: props.pageFrom === 'myApply' ? row.applyAuditId : undefined
        }
    })
}

const toEdit = (row: ApplicationMetadata) => {
    router.push({
        path: '/market/dev/apply-edit',
        query: {
            uid: row.uid
        }
    })
}

const toDelete = async (row: ApplicationMetadata) => {
    await $application.myCreateDelete(row.uid || '')
    refreshList()
}

const handleOfflineConfirm = (row: ApplicationMetadata) => {
    ElMessageBox.confirm('下架后当前应用将不在应用市场展示。', '确认下架', {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        showClose: false
    })
        .then(() => handleOffline(row))
        .catch(() => {})
}

const handleOffline = async (row: ApplicationMetadata) => {
    const result = await $application.offline({ uid: row.uid, did: row.did, version: row.version })
    if (result?.unpublished) {
        ElMessage.success('已下架')
        refreshList()
        return
    }
    ElMessage.error('下架失败')
}

const handleOnline = (row: ApplicationMetadata) => {
    ElMessageBox.confirm('上架后当前应用将不可再编辑修改。', '确认上架申请', {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        showClose: false
    })
        .then(async () => {
            const detail = await $application.myCreateDetailByUid(row.uid || '')
            if (!detail) {
                notifyError('❌应用不存在')
                return
            }
            const created = await $audit.submitPublishRequest({
                auditType: 'application',
                resource: detail as Record<string, unknown>
            })
            if (created?.meta?.uid) {
                ElMessage.success('已提交上架申请')
                refreshList()
            }
        })
        .catch(() => {})
}

const exportIdentity = async (row: ApplicationMetadata) => {
    if (props.pageFrom === 'myCreate') {
        const detail = await $application.myCreateDetailByUid(row.uid || '')
        if (!detail) {
            notifyError('❌应用不存在')
            return
        }
        await exportIdentityInfo(detail.did, detail.name)
        return
    }
    const detail = await $application.queryByUid(row.uid || '')
    if (!detail) {
        notifyError('❌应用不存在')
        return
    }
    await exportIdentityInfo(detail.did, detail.name)
}

const cancelApply = async (row: ApplicationMetadata) => {
    if (row.applyAuditId) {
        await $audit.cancel(row.applyAuditId)
        refreshList()
        return
    }
    const account = getCurrentAccount()
    if (!account) {
        notifyError('❌未查询到当前账户，请登录')
        return
    }
    const applicant = `${normalizeAddress(account)}::${normalizeAddress(account)}`
    const detail = await $audit.search({ applicant })
    const latest = Array.isArray(detail)
        ? detail
              .filter((audit) =>
                  isAuditForResource(audit, {
                      auditType: 'application',
                      reason: '申请使用',
                      uid: row.uid,
                      did: row.did,
                      version: row.version,
                      name: row.name
                  })
              )
              .sort((left, right) => {
                  const leftTime = left.meta?.createdAt ? Date.parse(left.meta.createdAt) : 0
                  const rightTime = right.meta?.createdAt ? Date.parse(right.meta.createdAt) : 0
                  return rightTime - leftTime
              })[0]
        : undefined
    if (latest?.meta?.uid) {
        await $audit.cancel(latest.meta.uid)
        refreshList()
    }
}

const reApply = (row: ApplicationMetadata) => {
    selectedRow.value = row
    dialogVisible.value = true
}

const afterSubmit = () => {
    dialogVisible.value = false
    refreshList()
}

const toConfigCapability = (row: ApplicationMetadata) => {
    selectedRow.value = row
    modalVisible.value = true
}

const cancelModal = () => {
    modalVisible.value = false
}
</script>

<style scoped lang="less">
.list-wrap {
    background: #fff;
    border-radius: 8px;
}

:deep(.el-table__header th) {
    background-color: #fafafa !important;
}

.name-cell {
    display: flex;
    align-items: center;
    gap: 10px;
}

.name-main {
    min-width: 0;
}

.title {
    font-size: 14px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.88);
    line-height: 1.4;
}

.desc {
    max-width: 320px;
    color: rgba(0, 0, 0, 0.55);
}

.address-cell {
    display: inline-block;
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.state-dot {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
}
</style>
