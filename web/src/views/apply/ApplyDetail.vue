<template>
    <div class="detail">
        <el-alert
            v-if="fromNotification"
            class="notification-entry-alert"
            type="info"
            :closable="false"
            :title="$t('notification_entry_tip')"
        />
        <div class="header">
            <div class="left-header">
                <BreadcrumbHeader :pageName="detailInfo.name" />
                <ApplyStatus :status="applyStatus" v-if="pageFrom === 'myApply'" />
            </div>
            <!-- 应用中心-应用市场的详情 -->
            <div v-if="pageFrom === 'market'">
                <div v-if="isOnline">
                    <el-popconfirm
                        :confirm-button-text="$t('btn_ok')"
                        :cancel-button-text="$t('btn_cancel')"
                        :icon="WarningFilled"
                        icon-color="#FB9A0E"
                        :title="$t('app_detail_delete_confirm')"
                        width="220px"
                        @confirm="toDelete"
                    >
                        <template #reference>
                            <el-button type="danger" plain>{{ $t('app_detail_unpublish') }}</el-button>
                        </template>
                    </el-popconfirm>
                </div>
            </div>

            <!-- 应用中心-我的创建的详情 -->
            <div v-if="pageFrom === 'myCreate'">
                <div>
                    <el-popconfirm
                        v-if="!isOnline"
                        :confirm-button-text="$t('btn_ok')"
                        :cancel-button-text="$t('btn_cancel')"
                        :icon="WarningFilled"
                        icon-color="#FB9A0E"
                        :title="$t('app_detail_delete_confirm')"
                        width="220px"
                        @confirm="toDelete"
                    >
                        <template #reference>
                            <el-button type="danger" plain>{{ $t('app_detail_delete') }}</el-button>
                        </template>
                    </el-popconfirm>
                    <el-button plain @click="toEdit">{{ $t('app_detail_edit') }}</el-button>
                    <el-button plain @click="exportIdentity">{{ $t('app_detail_export_identity') }}</el-button>
                    <el-button v-if="isOnline" plain @click="handleOfflineConfirm">{{ $t('app_detail_unpublish') }}</el-button>
                    <el-button v-if="!isOnline" plain @click="handleOnline">{{ $t('app_detail_publish') }}</el-button>
                </div>
            </div>
            <!-- 应用中心-我的申请的详情 -->
            <div v-if="pageFrom === 'myApply'">
                <div v-if="applyStatus === 'success'">
                    <el-button plain @click="toConfigCapability">{{ $t('app_detail_config_capability') }}</el-button>
                </div>
                <div v-if="applyStatus === 'applying'">
                    <el-button plain @click="cancelApply">{{ $t('app_detail_cancel_apply') }}</el-button>
                </div>
                <div v-if="applyStatus === 'reject'">
                    <el-button plain @click="dialogVisible = true">{{ $t('app_detail_reapply') }}</el-button>
                </div>
            </div>
        </div>
        <div class="part">
            <div class="title">{{ $t('app_detail_basic') }}</div>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">{{ $t('app_detail_name') }}: {{ detailInfo.name }}</el-col>
                <el-col :span="8" :xs="24">{{ $t('app_detail_owner') }}: {{ detailInfo.owner }}</el-col>
                <el-col :span="8" :xs="24">{{ $t('app_detail_status') }}: {{ businessStatusText }}</el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24" :xs="24" class="app-id-cell">
                    {{ $t('app_detail_id') }}:
                    <span class="app-id-text">{{ appIdText }}</span>
                    <el-tooltip v-if="appIdText !== '-'" :content="$t('app_detail_copy_id')" placement="top">
                        <el-icon class="app-id-copy-icon" @click="copyAppId">
                            <CopyDocument />
                        </el-icon>
                    </el-tooltip>
                </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24">{{ $t('app_detail_description') }}: {{ detailInfo.description }}</el-col>
            </el-row>
        </div>
        <div class="part">
            <div class="title">{{ $t('app_detail_info') }}</div>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">{{ $t('app_detail_category') }}: {{ applicationCodeText }}</el-col>
                <el-col :span="8" :xs="24"
                    >{{ $t('app_detail_dependencies') }}:
                    {{ dependencyText }}
                </el-col>
                <el-col :span="8" :xs="24">{{ $t('app_detail_location') }}: {{ detailInfo.location }} </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="8" :xs="24"
                    >{{ $t('app_detail_source') }}:
                    <template v-if="detailInfo.codePackagePath && isCodePackageUrl">
                        <a
                            class="link-url"
                            :href="detailInfo.codePackagePath"
                            target="_blank"
                            rel="noopener noreferrer"
                            style="color: rgba(22, 119, 255, 1)"
                        >
                            <el-link type="primary" :icon="Link">{{ detailInfo.codePackagePath }}</el-link>
                        </a>
                    </template>
                    <template v-else>
                        {{ detailInfo.codePackagePath || '-' }}
                    </template>
                </el-col>
                <el-col :span="16" :xs="24">{{ $t('app_detail_redirect_uri') }}: {{ redirectUriText }}</el-col>
            </el-row>
        </div>

        <AuditSummaryPanel v-if="pageFrom === 'myApply' && auditDetail" :audit="auditDetail" />
    </div>

    <ResultChooseModal
        v-model="innerVisible"
        :title="$t('app_detail_publish_success_title')"
        :mainDesc="$t('app_detail_publish_success_main')"
        :subDesc="$t('app_detail_publish_success_sub')"
        :rightBtnText="$t('app_detail_back_to_list')"
        :rightBtnClick="toList"
        :closeClick="closeInnerModal"
    >
        <template #icon>
            <el-icon :size="70"><SuccessFilled color="#30A46C" /></el-icon>
        </template>
    </ResultChooseModal>

    <ConfigCapabilityModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detailInfo" />

    <ApplyUseModal
        :title="$t('app_detail_reapply')"
        :dialogVisible="dialogVisible"
        :detail="detailInfo"
        :afterSubmit="afterSubmit"
        :closeClick="afterSubmit"
    />
</template>

<script lang="ts" setup>
import { computed, getCurrentInstance, onMounted, ref } from 'vue'
import BreadcrumbHeader from '@/views/components/BreadcrumbHeader.vue'
import ApplyStatus from '@/views/components/ApplyStatus.vue'
import { WarningFilled, SuccessFilled, Link, CopyDocument } from '@element-plus/icons-vue'
import ResultChooseModal from '@/views/components/ResultChooseModal.vue'
import { ElMessageBox } from 'element-plus'
import { h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import $application, {
    ApplicationMetadata,
    businessStatusMap,
    filterLegacyDependencies,
    resolveApplicationCategoryLabel,
    resolveBusinessStatus,
    serviceCodeMap
} from '@/plugins/application'
import ConfigCapabilityModal from '@/views/components/ConfigCapabilityModal.vue'
import ApplyUseModal from '@/views/components/ApplyUseModal.vue'
import AuditSummaryPanel from '@/views/components/AuditSummaryPanel.vue'
import { exportIdentityInfo } from '@/plugins/account'
import { getCurrentAccount } from '@/plugins/auth'
import { notifyError, notifySuccess } from '@/utils/message'
import $audit, {
    AuditAuditDetail,
    isAuditForResource,
    parseAuditTargetMetadata,
    resolveUsageAuditStatus
} from '@/plugins/audit'
const route = useRoute()
const router = useRouter()
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const detailInfo = ref<ApplicationMetadata>({
    name: '',
    description: '',
    location: '',
    code: '',
    serviceCodes: [],
    redirectUris: [],
    avatar: '',
    owner: '',
    ownerName: '',
    codePackagePath: ''
})
const pageFrom = String(route.query.pageFrom || '')
const fromNotification = computed(() => String(route.query.fromNotification || '').trim() === '1')
const innerVisible = ref(false)
const modalVisible = ref(false)
const dialogVisible = ref(false)
const currentAuditId = ref(String(route.query.auditId || ''))
const auditDetail = ref<AuditAuditDetail | null>(null)

/**
 * 应用是否上架
 * 我创建的-详情页需要展示这个字段，且右上角按钮也会跟着这个状态联动
 */
const isOnline = ref(true) // 是否已经上架

/**
 * 申请应用的状态
 * 我申请的-详情页需要展示这个字段，且右上角按钮也会跟着这个状态联动
 */
const applyStatus = ref('applying')

const applyUid = String(route.query.uid || '').trim()

const businessStatusText = computed(() => {
    const status = resolveBusinessStatus(detailInfo.value)
    return businessStatusMap[status]?.text || '-'
})

const appIdText = computed(() => {
    const uid = String(detailInfo.value?.uid || applyUid || '').trim()
    return uid || '-'
})

const applicationCodeText = computed(() => {
    return resolveApplicationCategoryLabel(detailInfo.value.code)
})

const dependencyText = computed(() => {
    const raw = detailInfo.value.serviceCodes
    const codes = filterLegacyDependencies(
        Array.isArray(raw)
            ? raw.map((item) => String(item).trim()).filter(Boolean)
            : typeof raw === 'string'
              ? raw.split(',').map((item) => item.trim()).filter(Boolean)
              : []
    )
    const names = codes
        .map((code) => {
            if (code.startsWith('SERVICE_CODE_')) {
                return serviceCodeMap[code] || code
            }
            return code
        })
        .filter(Boolean)
    if (names.length === 0) {
        return '-'
    }
    const preview = names.slice(0, 2).join('、')
    return names.length > 2 ? `${preview}...` : preview
})

function toRedirectUriArray(value: unknown): string[] {
    const normalize = (item: unknown) => String(item || '').trim()
    if (Array.isArray(value)) {
        return Array.from(
            new Set(value.map((item) => normalize(item)).filter((item) => item.length > 0))
        )
    }
    const raw = String(value || '').trim()
    if (!raw) {
        return []
    }
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) {
                return Array.from(
                    new Set(parsed.map((item) => normalize(item)).filter((item) => item.length > 0))
                )
            }
        } catch {
            // fallback to split mode
        }
    }
    return Array.from(
        new Set(
            raw
                .split(/[\n,]/)
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
        )
    )
}

const redirectUriText = computed(() => {
    const values = toRedirectUriArray(detailInfo.value.redirectUris)
    if (values.length === 0) {
        return '-'
    }
    const preview = values.slice(0, 2).join('、')
    return values.length > 2 ? `${preview}...` : preview
})

const isCodePackageUrl = computed(() => {
    const source = String(detailInfo.value.codePackagePath || '').trim()
    return /^https?:\/\//i.test(source)
})

const updateOnlineState = () => {
    const status = detailInfo.value?.status
    isOnline.value = Boolean(detailInfo.value?.isOnline) || status === 'BUSINESS_STATUS_ONLINE'
}

const sortAuditsByCreatedAtDesc = (left: AuditAuditDetail, right: AuditAuditDetail) => {
    const leftTime = left.meta?.createdAt ? Date.parse(left.meta.createdAt) : 0
    const rightTime = right.meta?.createdAt ? Date.parse(right.meta.createdAt) : 0
    return rightTime - leftTime
}

const fillDetailFromAudit = async (audit: AuditAuditDetail) => {
    const parsed = parseAuditTargetMetadata(audit.meta?.appOrServiceMetadata)
    if (!parsed) {
        throw new Error(String($t('app_detail_missing_audit_target')))
    }
    let remote: ApplicationMetadata | null | undefined = null
    try {
        if (parsed.uid) {
            remote = await $application.queryByUid(parsed.uid)
        } else if (parsed.did && parsed.version !== undefined) {
            remote = await $application.detail(parsed.did, parsed.version)
        }
    } catch {
        remote = null
    }
    detailInfo.value = {
        ...(parsed.raw as ApplicationMetadata),
        ...(remote || {}),
        uid: remote?.uid || parsed.uid || (parsed.raw.uid ? String(parsed.raw.uid) : ''),
        did: remote?.did || parsed.did || (parsed.raw.did ? String(parsed.raw.did) : ''),
        version:
            remote?.version ??
            parsed.version ??
            (parsed.raw.version !== undefined ? Number(parsed.raw.version) : undefined),
        owner: remote?.owner || parsed.owner || (parsed.raw.owner ? String(parsed.raw.owner) : ''),
        ownerName:
            remote?.ownerName ||
            parsed.ownerName ||
            (parsed.raw.ownerName ? String(parsed.raw.ownerName) : '')
    }
    currentAuditId.value = audit.meta?.uid || currentAuditId.value
    auditDetail.value = audit
    applyStatus.value = resolveUsageAuditStatus(audit)
    updateOnlineState()
}

const writeClipboardText = async (value: string) => {
    const normalized = String(value || '').trim()
    if (!normalized) {
        return false
    }
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(normalized)
        return true
    }
    const textarea = document.createElement('textarea')
    textarea.value = normalized
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
}

const copyAppId = async () => {
    const appId = String(detailInfo.value?.uid || applyUid || '').trim()
    if (!appId) {
        notifyError(String($t('app_detail_missing_app_id')))
        return
    }
    try {
        const copied = await writeClipboardText(appId)
        if (!copied) {
            notifyError(String($t('app_detail_copy_id_failed')))
            return
        }
        notifySuccess(String($t('app_detail_copy_id_success')))
    } catch {
        notifyError(String($t('app_detail_copy_id_failed')))
    }
}

const resolveCurrentAuditId = async () => {
    if (currentAuditId.value) {
        return currentAuditId.value
    }
    const account = getCurrentAccount()
    if (!account) {
        return ''
    }
    const applicant = `${account}::${account}`
    const routeDid = String(route.query.did || '').trim()
    const routeVersionValue = route.query.version !== undefined ? Number(route.query.version) : undefined
    const routeVersion = Number.isFinite(routeVersionValue) ? routeVersionValue : undefined
    const audits = await $audit.search({ applicant })
    const latest = Array.isArray(audits)
        ? audits
              .filter((audit) =>
                      isAuditForResource(audit, {
                          auditType: 'application',
                          reason: 'Request Access',
                          uid: applyUid || detailInfo.value?.uid,
                          did: routeDid || detailInfo.value?.did,
                          version: routeVersion ?? detailInfo.value?.version,
                      name: detailInfo.value?.name
                  })
              )
              .sort(sortAuditsByCreatedAtDesc)[0]
        : undefined
    currentAuditId.value = String(latest?.meta?.uid || '')
    return currentAuditId.value
}

/**
 * 进入详情页的时候，需要查询详情接口
 */
const detail = async () => {
    if (pageFrom === 'myCreate') {
        auditDetail.value = null
        const detailRst = await $application.myCreateDetailByUid(applyUid)
        detailInfo.value = detailRst || {}
        updateOnlineState()
        return
    }
    if (pageFrom === 'myApply') {
        const auditId = await resolveCurrentAuditId()
        if (!auditId) {
            throw new Error(String($t('app_detail_apply_record_missing')))
        }
        const audit = await $audit.detail(auditId)
        if (!audit) {
            throw new Error(String($t('app_detail_apply_record_not_found')))
        }
        await fillDetailFromAudit(audit)
        return
    }
    auditDetail.value = null
    const detailRst = await $application.queryByUid(applyUid)
    detailInfo.value = detailRst || {}
    updateOnlineState()
}

/**
  我创建的tab-详情页-导出身份
 */
const exportIdentity = async () => {
    if (pageFrom === 'myCreate') {
        const detailRst = await $application.myCreateDetailByUid(applyUid)
        await exportIdentityInfo(detailRst.did, detailRst.ownerName)
    } else if (pageFrom === 'market') {
        const detailRst = await $application.queryByUid(applyUid)
        await exportIdentityInfo(detailRst.did, detailRst.ownerName)
    }
}

const cancelApply = async () => {
    const auditId = await resolveCurrentAuditId()
    if (!auditId) {
        notifyError(String($t('app_detail_apply_record_missing')))
        return
    }
    await $audit.cancel(auditId)
    toList()
}

/**
 * 删除接口
 */
const toDelete = async () => {
    if (pageFrom === 'myCreate') {
        if (isOnline.value) {
            notifyError(String($t('app_detail_delete_offline_first')))
            return
        }
        await $application.myCreateDelete(applyUid)
    } else if (pageFrom === 'market') {
        const app = detailInfo.value?.uid ? detailInfo.value : await $application.queryByUid(applyUid)
        if (!app) {
            notifyError(String($t('app_detail_app_missing')))
            return
        }
        await $application.offline({ uid: app.uid, did: app.did, version: app.version })
    }
    // 删除成功后跳转到列表页
    toList()
}

const toList = () => {
    if (pageFrom === 'myCreate' || pageFrom === 'myApply') {
        router.push({
            path: '/market/dev/my-apps',
            query: {
                tab: pageFrom
            }
        })
        return
    }
    router.push({
        path: '/market/'
    })
}
const closeInnerModal = () => {
    innerVisible.value = false
}
/**
 * 编辑
 */
const toEdit = () => {
    router.push({
        path: '/market/dev/apply-edit',
        query: {
            uid: applyUid
        }
    })
}

const toConfigCapability = () => {
    modalVisible.value = true
}

const cancelModal = () => {
    modalVisible.value = false
}

const afterSubmit = () => {
    dialogVisible.value = false
    applyStatus.value = 'applying'
    currentAuditId.value = ''
    auditDetail.value = null
    if (pageFrom === 'myApply') {
        void detail().catch((error) => {
            notifyError(`${$t('app_detail_load_failed')}：${error instanceof Error ? error.message : String(error)}`)
        })
    }
}

/**
 * 上架应用
 */
const handleOnline = () => {
    ElMessageBox.confirm('', {
        message: h('p', null, [
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, String($t('app_detail_publish_confirm_title'))),
            h(
                'div',
                { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' },
                String($t('app_detail_publish_confirm_desc'))
            )
        ]),
        type: 'warning',
        confirmButtonText: String($t('btn_ok')),
        cancelButtonText: String($t('btn_cancel')),
        showClose: false,
        customClass: 'messageBox-wrap'
    })
        .then(async () => {
            try {
                const detailRst = await $application.myCreateDetailByUid(applyUid)
                if (!detailRst) {
                    notifyError(String($t('app_detail_app_missing')))
                    return
                }
                const created = await $audit.submitPublishRequest({
                    auditType: 'application',
                    resource: detailRst as Record<string, unknown>
                })
                if (!created?.meta?.uid) {
                    return
                }
                innerVisible.value = true
            } catch (error) {
                notifyError(`${$t('app_detail_apply_failed')}：${error}`)
            }
        })
        .catch(() => undefined)
}

/**
 * 下架应用
 */
const handleOffline = async () => {
    const target = detailInfo.value?.uid
        ? { uid: detailInfo.value.uid, did: detailInfo.value.did, version: detailInfo.value.version }
        : { uid: applyUid }
    const result = await $application.offline(target)
    if (!result?.unpublished) {
        notifyError(String($t('app_detail_unpublish_failed')))
        return
    }
    notifySuccess(String($t('app_detail_unpublish_success')))
    await detail()
}

const handleOfflineConfirm = () => {
    ElMessageBox.confirm('', {
        message: h('p', null, [
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, String($t('app_detail_unpublish_confirm_title'))),
            h(
                'div',
                { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' },
                String($t('app_detail_unpublish_confirm_desc'))
            )
        ]),
        type: 'warning',
        confirmButtonText: String($t('btn_ok')),
        cancelButtonText: String($t('btn_cancel')),
        showClose: false,
        customClass: 'messageBox-wrap'
    })
        .then(() => handleOffline())
        .catch(() => undefined)
}

onMounted(() => {
    void detail().catch((error) => {
        notifyError(`${$t('app_detail_load_failed')}：${error instanceof Error ? error.message : String(error)}`)
    })
})
</script>

<style scoped lang="less">
.detail {
    margin: 20px;
    .notification-entry-alert {
        margin-bottom: 16px;
    }
    .header {
        // text-align: right;
        display: flex;
        justify-content: space-between;
        align-items: center;
        // margin-top: 10px;
    }
    .left-header {
        display: flex;
        gap: 64px;
        align-items: center;
        .el-tag {
            margin-top: -15px;
        }
    }
    .part {
        background: #fff;
        padding: 20px;
        border-radius: 6px;
        margin-bottom: 18px;
        box-shadow:
            0px 0px 1px 0px #00000014,
            0px 1px 2px 0px #190f0f12,
            0px 2px 4px 0px #0000000d;
        .title {
            font-size: 16px;
            font-weight: 500;
            color: rgba(0, 0, 0, 0.85);
        }
        .part-row {
            font-size: 14px;
            font-weight: 400;
            color: rgba(0, 0, 0, 0.85);
            margin-top: 16px;
        }
    }
    .link-url {
        vertical-align: middle;
    }
    .link-icon {
        color: rgba(22, 119, 255, 1);
    }
    .app-id-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .app-id-text {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
            monospace;
    }
    .app-id-copy-icon {
        font-size: 15px;
        color: #1677ff;
        cursor: pointer;
        transition: color 0.2s ease;
        &:hover {
            color: #4096ff;
        }
    }
}
</style>
