<template>
    <div class="list-wrap">
        <el-table :data="items" style="width: 100%" :row-class-name="resolveRowClassName" @row-click="handleRowClick">
            <el-table-column :label="$t('app_list_name')" :min-width="nameColumnMinWidth">
                <template #default="scope">
                    <div class="name-cell">
                        <el-avatar shape="square" :size="34" :src="resolveAvatarSrc(scope.row.avatar)">
                            <img class="avatar-fallback" :src="defaultAppAvatar" alt="默认应用图标" />
                        </el-avatar>
                        <div class="name-main">
                            <el-tooltip
                                class="box-item"
                                effect="dark"
                                :content="scope.row.description || '-'"
                                placement="top-start"
                            >
                                <div class="title">{{ scope.row.name || '-' }}</div>
                            </el-tooltip>
                        </div>
                    </div>
                </template>
            </el-table-column>

            <el-table-column prop="code" :label="$t('app_list_category')" width="75">
                <template #default="scope">
                    {{ resolveApplicationCategoryLabel(scope.row.code) }}
                </template>
            </el-table-column>

            <el-table-column v-if="pageFrom === 'myCreate'" prop="version" :label="$t('app_list_version')" width="55">
                <template #default="scope">
                    {{ formatVersion(scope.row.version) }}
                </template>
            </el-table-column>

            <el-table-column prop="owner" :label="$t('app_list_author')" width="180">
                <template #default="scope">
                    <el-tooltip class="box-item" effect="dark" :content="scope.row.owner || '-'" placement="top-start">
                        <span class="address-cell">{{ shortAddress(scope.row.owner) }}</span>
                    </el-tooltip>
                </template>
            </el-table-column>

            <el-table-column v-if="pageFrom === 'myCreate'" :label="$t('app_list_status')" width="100">
                <template #default="scope">
                    <span class="state-dot">
                        <el-badge is-dot :type="businessState(scope.row).type" />
                        <span>{{ businessState(scope.row).text }}</span>
                    </span>
                </template>
            </el-table-column>

            <el-table-column v-if="pageFrom === 'myApply'" :label="$t('app_list_apply_status')" width="130">
                <template #default="scope">
                    <ApplyStatus :status="resolveApplyStatus(scope.row)" />
                </template>
            </el-table-column>

            <el-table-column :label="$t('app_list_created_at')" width="170">
                <template #default="scope">
                    {{ formatDate(scope.row.createdAt) }}
                </template>
            </el-table-column>

            <el-table-column :label="$t('app_list_updated_at')" width="170">
                <template #default="scope">
                    {{ formatDate(scope.row.updatedAt) }}
                </template>
            </el-table-column>

            <el-table-column fixed="right" :label="$t('app_list_actions')" min-width="260">
                <template #default="scope">
                    <div class="actions">
                        <el-button
                            v-if="pageFrom !== 'myCreate'"
                            link
                            type="primary"
                            size="small"
                            @click="toDetail(scope.row)"
                        >
                            {{ $t('app_list_detail') }}
                        </el-button>

                        <template v-if="pageFrom === 'myCreate'">
                            <el-button link type="primary" size="small" @click="toEdit(scope.row)">
                                {{ $t('app_list_edit') }}
                            </el-button>

                            <el-button
                                v-if="isOnline(scope.row)"
                                link
                                type="primary"
                                size="small"
                                @click="handleOfflineConfirm(scope.row)"
                            >
                                {{ $t('app_list_unpublish') }}
                            </el-button>
                            <el-button v-else link type="primary" size="small" @click="handleOnline(scope.row)">
                                {{ $t('app_list_publish') }}
                            </el-button>
                            <el-popconfirm
                                v-if="!isOnline(scope.row)"
                                :title="$t('app_list_delete_confirm')"
                                :confirm-button-text="$t('btn_ok')"
                                :cancel-button-text="$t('btn_cancel')"
                                @confirm="toDelete(scope.row)"
                            >
                                <template #reference>
                                    <el-button link type="danger" size="small">{{ $t('app_list_delete') }}</el-button>
                                </template>
                            </el-popconfirm>
                        </template>

                        <template v-if="pageFrom === 'myApply'">
                            <el-popconfirm
                                v-if="resolveApplyStatus(scope.row) === 'applying'"
                                :title="$t('app_list_cancel_confirm')"
                                :confirm-button-text="$t('btn_ok')"
                                :cancel-button-text="$t('btn_cancel')"
                                @confirm="cancelApply(scope.row)"
                            >
                                <template #reference>
                                    <el-button link type="danger" size="small">{{ $t('app_list_cancel_apply') }}</el-button>
                                </template>
                            </el-popconfirm>

                            <el-button
                                v-if="resolveApplyStatus(scope.row) === 'success'"
                                link
                                type="primary"
                                size="small"
                                @click="toConfigCapability(scope.row)"
                            >
                                {{ $t('app_list_config_capability') }}
                            </el-button>

                            <el-button
                                v-if="resolveApplyStatus(scope.row) === 'reject'"
                                link
                                type="primary"
                                size="small"
                                @click="reApply(scope.row)"
                            >
                                {{ $t('app_list_reapply') }}
                            </el-button>
                        </template>

                        <el-button link type="primary" size="small" @click="exportIdentity(scope.row)">
                            {{ $t('app_list_export_identity') }}
                        </el-button>
                    </div>
                </template>
            </el-table-column>
        </el-table>
    </div>

    <ApplyUseModal
        :title="$t('app_list_reapply')"
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
import { computed, getCurrentInstance, ref } from 'vue'
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
import defaultAppAvatar from '@/assets/img/default.jpg'

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
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const dialogVisible = ref(false)
const modalVisible = ref(false)
const selectedRow = ref<ApplicationMetadata | null>(null)

const items = computed(() => props.items || [])
const nameColumnMinWidth = computed(() => (props.pageFrom === 'myCreate' ? 150 : 300))
const resolveAvatarSrc = (value: unknown) => {
    const src = String(value || '').trim()
    return src || defaultAppAvatar
}

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

const formatVersion = (value: unknown) => {
    if (value === undefined || value === null || value === '') {
        return '-'
    }
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) {
        return `v${parsed}`
    }
    return String(value)
}

const resolveApplyStatus = (row: ApplicationMetadata) => String(row.applyStatus || 'applying')

const refreshList = () => {
    props.refreshList?.()
}

const resolveRowClassName = () => (props.pageFrom === 'myCreate' ? 'clickable-row' : '')

const handleRowClick = (row: ApplicationMetadata, _column: unknown, event: Event) => {
    if (props.pageFrom !== 'myCreate') {
        return
    }
    const target = event?.target as HTMLElement | null
    if (target?.closest('.actions')) {
        return
    }
    toDetail(row)
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
    ElMessageBox.confirm(String($t('app_list_unpublish_confirm_desc')), String($t('app_list_unpublish_confirm_title')), {
        type: 'warning',
        confirmButtonText: String($t('btn_ok')),
        cancelButtonText: String($t('btn_cancel')),
        showClose: false
    })
        .then(() => handleOffline(row))
        .catch(() => undefined)
}

const handleOffline = async (row: ApplicationMetadata) => {
    const result = await $application.offline({ uid: row.uid, did: row.did, version: row.version })
    if (result?.unpublished) {
        ElMessage.success(String($t('app_list_unpublish_success')))
        refreshList()
        return
    }
    ElMessage.error(String($t('app_list_unpublish_failed')))
}

const handleOnline = (row: ApplicationMetadata) => {
    ElMessageBox.confirm(String($t('app_detail_publish_confirm_desc')), String($t('app_detail_publish_confirm_title')), {
        type: 'warning',
        confirmButtonText: String($t('btn_ok')),
        cancelButtonText: String($t('btn_cancel')),
        showClose: false
    })
        .then(async () => {
            const detail = await $application.myCreateDetailByUid(row.uid || '')
            if (!detail) {
                notifyError(String($t('app_detail_app_missing')))
                return
            }
            const created = await $audit.submitPublishRequest({
                auditType: 'application',
                resource: detail as Record<string, unknown>
            })
            if (created?.meta?.uid) {
                ElMessage.success(String($t('app_edit_submit_success')))
                refreshList()
            }
        })
        .catch(() => undefined)
}

const exportIdentity = async (row: ApplicationMetadata) => {
    if (props.pageFrom === 'myCreate') {
        const detail = await $application.myCreateDetailByUid(row.uid || '')
        if (!detail) {
            notifyError(String($t('app_detail_app_missing')))
            return
        }
        await exportIdentityInfo(detail.did, detail.name)
        return
    }
    const detail = await $application.queryByUid(row.uid || '')
    if (!detail) {
        notifyError(String($t('app_detail_app_missing')))
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
        notifyError(String($t('market_missing_account')))
        return
    }
    const applicant = `${normalizeAddress(account)}::${normalizeAddress(account)}`
    const detail = await $audit.search({ applicant })
    const latest = Array.isArray(detail)
        ? detail
              .filter((audit) =>
                  isAuditForResource(audit, {
                      auditType: 'application',
                      reason: 'Request Access',
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

:deep(.el-table__body .clickable-row > td) {
    cursor: pointer;
}

.name-cell {
    display: flex;
    align-items: center;
    gap: 10px;
}

.avatar-fallback {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
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
