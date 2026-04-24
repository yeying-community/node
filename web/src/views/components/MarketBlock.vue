<template>
    <div class="tab" :class="{ 'tab-market-clickable': pageFrom === 'market' }" @click="handleCardClick">
        <div class="top">
            <div class="top-left">
                <el-avatar shape="square" size="56" :src="detail.avatar" />
            </div>
            <div class="top-right" :class="{ 'has-menu': pageFrom === 'market' }">
                <div v-if="pageFrom === 'market'" class="card-menu" @click.stop>
                    <el-dropdown trigger="click" placement="bottom-end">
                        <span class="card-menu-trigger">
                            <el-icon><MoreFilled /></el-icon>
                        </span>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="toDetail">详情</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
                <div class="name">{{ detail.name }}</div>
                <div v-if="businessStatus !== 'BUSINESS_STATUS_UNKNOWN' && pageFrom !== 'market'" class="badge-info">
                    <el-badge is-dot :type="businessInfo.type" />
                    <span class="badge-text">{{ businessInfo.text }}</span>
                </div>
                <div class="title" v-if="pageFrom === 'market'">
                    <el-tag type="primary" size="small">社区</el-tag>
                    <span class="market-title-time">{{ marketPublishedDateText }}</span>
                </div>
                <div class="title" v-else-if="pageFrom === 'myCreate' || !ownerAddress">
                    <span v-if="pageFrom === 'myCreate' || !ownerAddress">
                        <el-tag type="primary" size="small">社区</el-tag>
                    </span>
                    <span>
                        {{ pageFrom === 'myCreate' || !isOnline ? '创建于' : '上架于' }}
                        {{ dayjs(detail.createdAt).format('YYYY-MM-DD') }}
                    </span>
                </div>
                <div v-if="ownerAddress" class="meta owner-meta-line">
                    <span class="owner-meta">
                        作者：{{ ownerShortAddress }}
                    </span>
                    <el-tooltip content="复制" placement="top">
                        <el-icon class="copy-owner-icon" @click.stop="copyOwnerAddress">
                            <CopyDocument />
                        </el-icon>
                    </el-tooltip>
                </div>
                <div class="meta">
                    <span>分类：{{ applicationCodeText }}</span>
                </div>
                <div class="meta meta-version">
                    <span>版本：{{ versionText }}</span>
                </div>
                <el-tooltip :content="descriptionText" placement="top" :disabled="!isDescOverflow">
                    <div ref="descRef" class="desc">
                        {{ displayDescription }}
                    </div>
                </el-tooltip>
            </div>
        </div>

        <!-- 应用市场 -->
        <div v-if="pageFrom === 'market' && !isOwner">
            <div class="bottom owner">
                <div @click.stop="applyUse()" class="cursor">申请使用</div>
            </div>
        </div>
        <!-- 我的创建 -->
        <div v-if="pageFrom === 'myCreate'">
            <div class="bottom owner">
                <div @click="toDetail" class="cursor">详情</div>
                <el-divider direction="vertical" />
                <div v-if="isOnline" @click="handleOfflineConfirm" class="cursor">下架应用</div>
                <div v-else @click="handleOnline" class="cursor">上架应用</div>
                <el-divider direction="vertical" />
                <div class="bottom-more">
                    <el-dropdown placement="top-start">
                        <div>更多</div>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item v-if="!isOnline">
                                    <el-popconfirm
                                        confirm-button-text="确定"
                                        cancel-button-text="取消"
                                        :icon="WarningFilled"
                                        icon-color="#FB9A0E"
                                        title="您确定要删除该应用吗？"
                                        width="220px"
                                        @confirm="toDelete"
                                    >
                                        <template #reference> 删除 </template>
                                    </el-popconfirm>
                                </el-dropdown-item>

                                <el-dropdown-item v-if="!isOnline" @click="toEdit">编辑</el-dropdown-item>
                                <el-dropdown-item @click="exportIdentity">导出身份</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
            </div>
        </div>

        <!-- 我的申请 -->
        <div v-if="pageFrom === 'myApply'">
            <div class="bottom owner">
                <div @click="toDetail" class="cursor">详情</div>
                <el-divider direction="vertical" />

                <el-popconfirm
                    confirm-button-text="确定"
                    cancel-button-text="取消"
                    :icon="WarningFilled"
                    icon-color="#FB9A0E"
                    title="您确定要取消当前应用的申请吗？"
                    width="220px"
                    @confirm="cancelApply"
                >
                    <template #reference>
                        <div v-if="applyStatus === 'applying'" class="cursor">取消申请</div>
                    </template>
                </el-popconfirm>

                <div v-if="applyStatus === 'success'" @click="toConfigCapability" class="cursor">配置能力</div>

                <el-divider v-if="applyStatus === 'success' || applyStatus === 'reject'" direction="vertical" />
                <div v-if="applyStatus === 'reject'" class="bottom-more">
                    <el-dropdown placement="top-start">
                        <div>更多</div>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="dialogVisible = true">重新申请</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
            </div>
        </div>
    </div>
    <ApplyUseModal
        :title="pageFrom === 'market' ? '申请使用' : '重新申请'"
        :dialogVisible="dialogVisible"
        :detail="detail"
        :afterSubmit="afterSubmit"
        :closeClick="afterSubmit"
    />
    <ConfigCapabilityModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detail" />
    <ResultChooseModal
        v-model="innerVisible"
        title="应用上架申请"
        mainDesc="应用上架申请中，联系管理员审批"
        subDesc="应用申请上架"
        leftBtnText="查看详情"
        rightBtnText="返回列表"
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
import { ref, computed, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import $audit, { isAuditForResource, resolveUsageAuditStatus } from '@/plugins/audit'
import { CopyDocument, MoreFilled, SuccessFilled, WarningFilled } from '@element-plus/icons-vue'
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
    codeMap,
    resolveBusinessStatus
} from '@/plugins/application'
import { notifyError, notifySuccess } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'
import { normalizeAddress } from '@/utils/actionSignature'

const router = useRouter()
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
const ownerAddress = computed(() => String(props.detail?.owner || '').trim())
const ownerShortAddress = computed(() => {
    const value = ownerAddress.value
    if (!value) {
        return ''
    }
    if (value.length <= 12) {
        return value
    }
    return `${value.slice(0, 6)}...${value.slice(-4)}`
})
const marketPublishedDateText = computed(() => {
    const raw = String(props.detail?.createdAt || '').trim()
    if (!raw) {
        return '-'
    }
    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '-'
})
const applicationCodeText = computed(() => {
    const code = String(props.detail?.code || '').trim()
    if (!code) {
        return '未分类'
    }
    return codeMap[code] || '未分类'
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
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
    }
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
}

const copyOwnerAddress = async () => {
    const value = ownerAddress.value
    if (!value) {
        return
    }
    try {
        await writeClipboardText(value)
        notifySuccess('已复制')
    } catch {
        notifyError('复制失败')
    }
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
                  reason: '申请使用',
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
            notifyError('❌未查询到当前账户，请登录')
            return
        }
        const applicant = `${account}::${account}`
        const detail = await $audit.search({ applicant })
        const latest = Array.isArray(detail)
            ? detail
                  .filter((audit) =>
                      isAuditForResource(audit, {
                          auditType: 'application',
                          reason: '申请使用',
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
        notifyError('❌应用未配置可访问地址')
        return
    }
    window.location.href = target
}

const handleCardClick = () => {
    if (props.pageFrom !== 'market') {
        return
    }
    toDetail()
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
            message: '已下架',
            type: 'success'
        })
        props.refreshCardList()
    } else {
        ElMessage({
            message: '下架失败',
            type: 'error'
        })
    }    
}

const handleOfflineConfirm = () => {
    ElMessageBox.confirm('', {
        message: h('p', null, [
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, '你确定要下架当前应用吗？'),
            h(
                'div',
                { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' },
                '下架后当前应用将不在应用市场展示。'
            )
        ]),
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        showClose: false,
        customClass: 'messageBox-wrap'
    })
        .then(() => {
            handleOffline()
        })
        .catch(() => {
            console.log(`下架异常`)
        })
}

/**
 * 申请使用
 */
const applyUse = async () => {
    dialogVisible.value = true
}

// 上架应用
const handleOnline = () => {
    ElMessageBox.confirm('', {
        message: h('p', null, [
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, '你确定要上架当前应用吗？'),
            h(
                'div',
                { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' },
                '上架后当前应用将不可再编辑修改。'
            )
        ]),
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        showClose: false,
        customClass: 'messageBox-wrap'
    })
        .then(async () => {
            try {
            const detailRst = await $application.myCreateDetailByUid(props.detail.uid)
            if (!detailRst) {
                notifyError("❌应用不存在")
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
                notifyError(`❌申请失败: ${error}`)
            }
        })
        .catch(() => {})
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
    padding: 20px;
    &.tab-market-clickable {
        cursor: pointer;
    }
    .cursor {
        cursor: pointer;
    }
    .top {
        display: flex;
        gap: 16px;
        .top-left {
            width: 56px;
            height: 56px;
            flex: 0 0 56px;
        }
        .top-right {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 8px;
            &.has-menu {
                padding-right: 26px;
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
            .title {
                display: flex;
                align-items: center;
                color: rgba(0, 0, 0, 0.45);
                font-size: 14px;
                font-weight: 400;
                gap: 8px;
                .el-tag {
                    margin-top: 0;
                }
            }
            .market-title-time {
                color: rgba(0, 0, 0, 0.45);
                font-size: 13px;
                line-height: 1.2;
            }
            .meta {
                display: flex;
                flex-wrap: wrap;
                gap: 8px 16px;
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
            .meta-version {
                margin-top: -4px;
            }
            .owner-meta-line {
                align-items: center;
            }
            .desc {
                color: rgba(0, 0, 0, 0.45);
                font-size: 14px;
                font-weight: 400;
                line-height: 22px;
                height: 33px;
                overflow: hidden;
                word-break: break-word;
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
