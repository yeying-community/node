<template>
    <div class="tab" :class="{ 'tab-market-clickable': pageFrom === 'market' }" @click="handleCardClick">
        <div class="top">
            <div class="top-left">
                <el-avatar shape="square" :size="70" :src="resolveAvatarSrc(detail.avatar)">
                    <img class="avatar-fallback" :src="defaultAppAvatar" alt="默认应用图标" />
                </el-avatar>
            </div>
            <div class="top-right" :class="{ 'has-menu': pageFrom === 'market' }">
                <div v-if="pageFrom === 'market'" class="card-menu" @click.stop>
                    <el-dropdown trigger="click" placement="bottom-end">
                        <span class="card-menu-trigger">
                            <el-icon><MoreFilled /></el-icon>
                        </span>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="toDetail">{{ $t('market_card_detail') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
                <div v-if="businessStatus !== 'BUSINESS_STATUS_UNKNOWN' && pageFrom !== 'market'" class="badge-info">
                    <el-badge is-dot :type="businessInfo.type" />
                    <span class="badge-text">{{ businessInfo.text }}</span>
                </div>
                <div class="headline">
                    <div class="name">{{ detail.name }}</div>
                    <div class="title" v-if="pageFrom === 'market'">
                        <div class="title-chips">
                            <el-tag type="primary" size="small">{{ $t('market_card_community') }}</el-tag>
                            <el-tag size="small" effect="plain">{{ applicationCodeText }}</el-tag>
                            <el-tag size="small" effect="plain">{{ versionText }}</el-tag>
                        </div>
                        <span class="market-title-time">{{ marketPublishedDateText }}</span>
                    </div>
                    <div class="title" v-else-if="pageFrom === 'myCreate' || !ownerAddress">
                        <div class="title-chips" v-if="pageFrom === 'myCreate' || !ownerAddress">
                            <el-tag type="primary" size="small">{{ $t('market_card_community') }}</el-tag>
                            <el-tag size="small" effect="plain">{{ applicationCodeText }}</el-tag>
                            <el-tag size="small" effect="plain">{{ versionText }}</el-tag>
                        </div>
                        <span>
                            {{ pageFrom === 'myCreate' || !isOnline ? $t('market_card_created_at') : $t('market_card_published_at') }}
                            {{ dayjs(detail.createdAt).format('YYYY-MM-DD') }}
                        </span>
                    </div>
                </div>
            </div>
        </div>
        <el-tooltip :content="descriptionText" placement="top" :disabled="!isDescOverflow">
            <div ref="descRef" class="desc">
                {{ displayDescription }}
            </div>
        </el-tooltip>

        <!-- 应用市场 -->
        <div v-if="pageFrom === 'market' && !isOwner">
            <div class="bottom owner">
                <div @click.stop="applyUse()" class="cursor">{{ $t('market_card_apply_use') }}</div>
            </div>
        </div>
        <!-- 我的创建 -->
        <div v-if="pageFrom === 'myCreate'">
            <div class="bottom owner">
                <div @click="toDetail" class="cursor">{{ $t('app_list_detail') }}</div>
                <el-divider direction="vertical" />
                <div v-if="isOnline" @click="handleOfflineConfirm" class="cursor">{{ $t('app_list_unpublish') }}</div>
                <div v-else @click="handleOnline" class="cursor">{{ $t('app_list_publish') }}</div>
                <el-divider direction="vertical" />
                <div class="bottom-more">
                    <el-dropdown placement="top-start">
                        <div>{{ $t('market_card_more') }}</div>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item v-if="!isOnline">
                                    <el-popconfirm
                                        :confirm-button-text="$t('btn_ok')"
                                        :cancel-button-text="$t('btn_cancel')"
                                        :icon="WarningFilled"
                                        icon-color="#FB9A0E"
                                        :title="$t('app_list_delete_confirm')"
                                        width="220px"
                                        @confirm="toDelete"
                                    >
                                        <template #reference> {{ $t('app_list_delete') }} </template>
                                    </el-popconfirm>
                                </el-dropdown-item>

                                <el-dropdown-item @click="toEdit">{{ $t('app_list_edit') }}</el-dropdown-item>
                                <el-dropdown-item @click="exportIdentity">{{ $t('app_list_export_identity') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
            </div>
        </div>

        <!-- 我的申请 -->
        <div v-if="pageFrom === 'myApply'">
            <div class="bottom owner">
                <div @click="toDetail" class="cursor">{{ $t('app_list_detail') }}</div>
                <el-divider direction="vertical" />

                <el-popconfirm
                    :confirm-button-text="$t('btn_ok')"
                    :cancel-button-text="$t('btn_cancel')"
                    :icon="WarningFilled"
                    icon-color="#FB9A0E"
                    :title="$t('app_list_cancel_confirm')"
                    width="220px"
                    @confirm="cancelApply"
                >
                    <template #reference>
                        <div v-if="applyStatus === 'applying'" class="cursor">{{ $t('app_list_cancel_apply') }}</div>
                    </template>
                </el-popconfirm>

                <div v-if="applyStatus === 'success'" @click="toConfigCapability" class="cursor">{{ $t('app_list_config_capability') }}</div>

                <el-divider v-if="applyStatus === 'success' || applyStatus === 'reject'" direction="vertical" />
                <div v-if="applyStatus === 'reject'" class="bottom-more">
                    <el-dropdown placement="top-start">
                        <div>{{ $t('market_card_more') }}</div>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="dialogVisible = true">{{ $t('app_list_reapply') }}</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
            </div>
        </div>
    </div>
    <ApplyUseModal
        :title="pageFrom === 'market' ? $t('apply_use_title') : $t('app_list_reapply')"
        :dialogVisible="dialogVisible"
        :detail="detail"
        :afterSubmit="afterSubmit"
        :closeClick="afterSubmit"
    />
    <ConfigCapabilityModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detail" />
    <ResultChooseModal
        v-model="innerVisible"
        :title="$t('market_card_publish_request_title')"
        :mainDesc="$t('market_card_publish_request_main')"
        :subDesc="$t('market_card_publish_request_sub')"
        :leftBtnText="$t('market_card_view_detail')"
        :rightBtnText="$t('market_card_back_list')"
        :leftBtnClick="toDetail"
        :rightBtnClick="toList"
        :closeClick="toList"
    >
        <template #icon>
            <el-icon :size="70"><SuccessFilled color="#30A46C" /></el-icon>
        </template>
    </ResultChooseModal>
</template>
<script lang="ts" setup>
import { ref, computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import $audit, { isAuditForResource, resolveUsageAuditStatus } from '@/plugins/audit'
import { MoreFilled, SuccessFilled, WarningFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { exportIdentityInfo } from '@/plugins/account'
import { ElMessage, ElMessageBox } from 'element-plus'
import { h } from 'vue'
import ApplyUseModal from './ApplyUseModal.vue'
import ConfigCapabilityModal from './ConfigCapabilityModal.vue'
import ResultChooseModal from './ResultChooseModal.vue'
import $application, {
    ApplicationMetadata,
    businessStatusMap,
    resolveApplicationCategoryLabel,
    resolveBusinessStatus
} from '@/plugins/application'
import { notifyError, notifySuccess } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'
import { normalizeAddress } from '@/utils/actionSignature'
import defaultAppAvatar from '@/assets/img/default.jpg'

const router = useRouter()
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const props = defineProps({
    detail: Object as () => ApplicationMetadata,
    selectId: Number,
    refreshCardList: Function,
    pageFrom: String
})

const isOwner = computed(() => {
    const account = getCurrentAccount()
    if (!account) {
        return false
    }
    return normalizeAddress(account) === normalizeAddress(String(props.detail?.owner || ''))
})

const innerVisible = ref(false)
const dialogVisible = ref(false)
const modalVisible = ref(false)
const descRef = ref<HTMLElement | null>(null)
const isDescOverflow = ref(false)
const displayDescription = ref('-')
let descriptionResizeObserver: ResizeObserver | null = null
const businessStatus = computed(() => resolveBusinessStatus(props.detail))
const businessInfo = computed(() => businessStatusMap[businessStatus.value] || businessStatusMap.BUSINESS_STATUS_UNKNOWN)
const isOnline = computed(() => businessStatus.value === 'BUSINESS_STATUS_ONLINE')
const resolveAvatarSrc = (value: unknown) => {
    const src = String(value || '').trim()
    return src || defaultAppAvatar
}
const marketPublishedDateText = computed(() => {
    const raw = String(props.detail?.createdAt || '').trim()
    if (!raw) {
        return '-'
    }
    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '-'
})
const applicationCodeText = computed(() => {
    return resolveApplicationCategoryLabel(props.detail?.code)
})
const versionText = computed(() => {
    const raw = props.detail?.version
    if (raw === undefined || raw === null || raw === '') {
        return '-'
    }
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
        return `v${parsed}`
    }
    return String(raw)
})
const descriptionText = computed(() => {
    const raw = String(props.detail?.description || '').trim()
    return raw || '-'
})
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

const updateDescriptionOverflow = async () => {
    displayDescription.value = descriptionText.value
    await nextTick()
    const el = descRef.value
    if (!el) {
        isDescOverflow.value = false
        return
    }
    const isOverflow = () => el.scrollHeight > el.clientHeight + 1
    if (!isOverflow()) {
        isDescOverflow.value = false
        return
    }
    if (descriptionText.value === '-') {
        isDescOverflow.value = false
        return
    }
    isDescOverflow.value = true
    let left = 0
    let right = descriptionText.value.length
    let best = '...'
    while (left <= right) {
        const mid = Math.floor((left + right) / 2)
        const candidate = `${descriptionText.value.slice(0, mid).trimEnd()}...`
        displayDescription.value = candidate
        await nextTick()
        if (!isOverflow()) {
            best = candidate
            left = mid + 1
        } else {
            right = mid - 1
        }
    }
    displayDescription.value = best
}

/**
 * 申请应用的状态
 * 我申请的-每个应用卡片的右上角展示申请状态
 * 每个卡片的按钮展示与隐藏依赖该状态
 */
const applyStatus = ref(props.detail?.applyStatus || 'applying')

const getApplyStatus = async () => {
    if (props.detail?.applyStatus) {
        applyStatus.value = props.detail.applyStatus
        return
    }
    const account = getCurrentAccount()
    if (!account) {
        applyStatus.value = 'applying'
        return
    }
    const applicant = `${account}::${account}`
    const detail = await $audit.search({ applicant })
    const candidates = Array.isArray(detail)
        ? detail.filter((audit) =>
              isAuditForResource(audit, {
                  auditType: 'application',
                  reason: 'Request Access',
                  uid: props.detail?.uid,
                  did: props.detail?.did,
                  version: props.detail?.version,
                  name: props.detail?.name
              })
          )
        : []
    if (candidates.length === 0) {
        applyStatus.value = 'applying'
        return
    }
    const latest = candidates.sort((a, b) => {
        const at = a.meta?.createdAt ? Date.parse(a.meta.createdAt) : 0
        const bt = b.meta?.createdAt ? Date.parse(b.meta.createdAt) : 0
        return bt - at
    })[0]
    applyStatus.value = resolveUsageAuditStatus(latest)
}

/**
 * 取消申请
 *
 */
const cancelApply = async () => {
    const auditId = props.detail?.applyAuditId
    if (auditId) {
        await $audit.cancel(auditId)
    } else {
        const account = getCurrentAccount()
        if (!account) {
            notifyError(String($t('market_missing_account')))
            return
        }
        const applicant = `${account}::${account}`
        const detail = await $audit.search({ applicant })
        const latest = Array.isArray(detail)
            ? detail
                  .filter((audit) =>
                      isAuditForResource(audit, {
                          auditType: 'application',
                          reason: 'Request Access',
                          uid: props.detail?.uid,
                          did: props.detail?.did,
                          version: props.detail?.version,
                          name: props.detail?.name
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
        }
    }
    if (props.refreshCardList) {
        props.refreshCardList()
    }
}

/**
 * 删除
 */
const toDelete = async () => {
    if (props.pageFrom === 'myCreate') {
        await $application.myCreateDelete(props.detail?.uid)
    }
    props.refreshCardList()
}

const toEdit = async () => {
    router.push({
        path: '/market/dev/apply-edit',
        query: {
            uid: props.detail?.uid
        }
    })
}
/**
 * 导出身份
 */
const exportIdentity = async () => {
    if (props.pageFrom === 'myCreate') {
        const detailRst = await $application.myCreateDetailByUid(props.detail?.uid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    } else {
        const detailRst = await $application.queryByUid(props.detail?.uid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    }
}

const toDetail = () => {
    if (props.pageFrom === 'market') {
        router.push({
            path: '/market/detail',
            query: {
                uid: props.detail?.uid
            }
        })
        return
    }
    router.push({
        path: '/market/dev/apply-detail',
        query: {
            uid: props.detail?.uid,
            pageFrom: props.pageFrom,
            auditId: props.pageFrom === 'myApply' ? props.detail?.applyAuditId : undefined
        }
    })
}

const normalizeLocationUrl = (value: unknown) => {
    const raw = String(value || '').trim()
    if (!raw) {
        return ''
    }
    try {
        return new URL(raw).toString()
    } catch {
        try {
            return new URL(`http://${raw}`).toString()
        } catch {
            return ''
        }
    }
}

const goUse = () => {
    const target = normalizeLocationUrl(props.detail?.location)
    if (!target) {
        notifyError(String($t('market_card_location_missing')))
        return
    }
    window.location.href = target
}

const handleCardClick = () => {
    if (props.pageFrom !== 'market') {
        return
    }
    const target = normalizeLocationUrl(props.detail?.location)
    if (!target) {
        toDetail()
        return
    }
    window.location.href = target
}
const toList = () => {
    innerVisible.value = false
}

const toConfigCapability = () => {
    modalVisible.value = true
}

const cancelModal = () => {
    modalVisible.value = false
}

// 下架应用
const handleOffline = async () => {
    const offlinelRst = await $application.offline({ uid: props.detail?.uid, did: props.detail?.did, version: props.detail?.version })

    if (offlinelRst?.unpublished) {
        ElMessage({
            message: String($t('app_list_unpublish_success')),
            type: 'success'
        })
        props.refreshCardList()
    } else {
        ElMessage({
            message: String($t('app_list_unpublish_failed')),
            type: 'error'
        })
    }    
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
        .then(() => {
            handleOffline()
        })
        .catch(() => undefined)
}

const applyUse = async () => {
    dialogVisible.value = true
}

// 上架应用
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
                const detailRst = await $application.myCreateDetailByUid(props.detail.uid)
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

const afterSubmit = () => {
    dialogVisible.value = false
    if (props.refreshCardList) {
        props.refreshCardList()
    }
}

if (props.pageFrom === 'myApply') {
    getApplyStatus()
}

onMounted(() => {
    updateDescriptionOverflow()
    if (typeof ResizeObserver !== 'undefined' && descRef.value) {
        descriptionResizeObserver = new ResizeObserver(() => {
            updateDescriptionOverflow()
        })
        descriptionResizeObserver.observe(descRef.value)
    }
})

watch(
    () => props.detail?.description,
    () => {
        updateDescriptionOverflow()
    }
)

onBeforeUnmount(() => {
    if (descriptionResizeObserver) {
        descriptionResizeObserver.disconnect()
        descriptionResizeObserver = null
    }
})

// const emit = defineEmits(['change']);
</script>
<style scoped lang="less">
.tab {
    background-color: #fff;
    border-radius: 6px;
    padding: 14px 10px;
    &.tab-market-clickable {
        cursor: pointer;
    }
    .cursor {
        cursor: pointer;
    }
    .top {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        .top-left {
            width: 70px;
            height: 70px;
            flex: 0 0 70px;
            display: flex;
            align-items: center;
            justify-content: center;
            .avatar-fallback {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
        }
        .top-right {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 8px;
            &.has-menu {
                padding-right: 22px;
            }
            .card-menu {
                position: absolute;
                top: 0;
                right: 0;
                z-index: 5;
            }
            .card-menu-trigger {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                border-radius: 6px;
                color: rgba(0, 0, 0, 0.45);
                transition: background-color 0.2s ease, color 0.2s ease;
            }
            .card-menu-trigger:hover {
                background-color: rgba(0, 0, 0, 0.06);
                color: rgba(0, 0, 0, 0.72);
            }
            .name {
                font-size: 18px;
                font-weight: 500;
                color: rgba(0, 0, 0, 0.85);
                line-height: 1.35;
            }
            .headline {
                min-height: 70px;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 8px;
            }
            .title {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                color: rgba(0, 0, 0, 0.45);
                font-size: 14px;
                font-weight: 400;
                gap: 8px;
                .el-tag {
                    margin-top: 0;
                }
            }
            .title-chips {
                display: inline-flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 6px;
                min-width: 0;
            }
            .market-title-time {
                color: rgba(0, 0, 0, 0.45);
                font-size: 13px;
                line-height: 1.2;
            }
            .meta {
                display: flex;
                flex-wrap: wrap;
                gap: 6px 12px;
                color: rgba(0, 0, 0, 0.6);
                font-size: 13px;
                .owner-meta {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .copy-owner-icon {
                    font-size: 14px;
                    color: rgba(22, 119, 255, 1);
                    cursor: pointer;
                }
            }
            .badge-info {
                position: absolute;
                right: 0;
                top: 0;
                width: 100%;
                display: inline-flex;
                align-items: center;
                justify-content: flex-end;
                .el-badge {
                    margin-top: 0;
                }
            }

            .badge-text {
                font-size: 13px;
                margin-left: 8px;
                line-height: 1.2;
            }
        }
    }
    .desc {
        margin-top: 10px;
        color: rgba(0, 0, 0, 0.45);
        font-size: 14px;
        font-weight: 400;
        line-height: 22px;
        height: 33px;
        overflow: hidden;
        word-break: break-word;
    }
    .bottom {
        padding-top: 10px;
        border-top: 1px solid rgba(0, 0, 0, 0.06);
        margin-top: 12px;
        display: flex;
        font-size: 14px;
        color: rgba(22, 119, 255, 1);
        .bottom-left {
            width: 50%;
            text-align: center;
            border-right: 1px solid rgba(0, 0, 0, 0.06);
            cursor: pointer;
        }
        .bottom-right {
            width: 50%;
            text-align: center;
            cursor: pointer;
        }
        .bottom-more {
            display: flex;
            align-items: center;
        }
    }
    .owner {
        justify-content: space-around;
    }
    .el-dropdown {
        font-size: 14px;
        color: rgba(22, 119, 255, 1);
    }
}

.status-desc {
    color: rgba(0, 0, 0, 0.45);
    font-size: 13px;
}
.waring-text {
    font-size: 16px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
}
</style>
