<template>
    <div class="detail">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/market/' }">应用中心</el-breadcrumb-item>
            <el-breadcrumb-item>应用详情</el-breadcrumb-item>
        </el-breadcrumb>

        <div class="header">
            <div class="left-header">
                <BreadcrumbHeader :pageName="detailInfo.name" />
                <ApplyStatus :status="applyStatus" v-if="pageFrom === 'myApply'" />
            </div>
            <!-- 应用中心-应用市场的详情 -->
            <div v-if="pageFrom === 'market'">
                <div v-if="isOnline">
                    <el-popconfirm
                        confirm-button-text="确定"
                        cancel-button-text="取消"
                        :icon="WarningFilled"
                        icon-color="#FB9A0E"
                        title="您确定要删除该应用吗？"
                        width="220px"
                        @confirm="toDelete"
                    >
                        <template #reference>
                            <el-button type="danger" plain>下架应用</el-button>
                        </template>
                    </el-popconfirm>
                </div>
            </div>

            <!-- 应用中心-我的创建的详情 -->
            <div v-if="pageFrom === 'myCreate'">
                <div>
                    <el-popconfirm
                        confirm-button-text="确定"
                        cancel-button-text="取消"
                        :icon="WarningFilled"
                        icon-color="#FB9A0E"
                        title="您确定要删除该应用吗？"
                        width="220px"
                        @confirm="toDelete"
                    >
                        <template #reference>
                            <el-button type="danger" plain>删除</el-button>
                        </template>
                    </el-popconfirm>
                    <el-button plain @click="toEdit">编辑</el-button>
                    <el-button plain @click="exportIdentity">导出身份</el-button>
                    <el-button plain @click="handleOnline">上架应用</el-button>
                </div>
            </div>
            <!-- 应用中心-我的申请的详情 -->
            <div v-if="pageFrom === 'myApply'">
                <div v-if="applyStatus === 'success'">
                    <el-button plain @click="toConfigCapability">配置能力</el-button>
                </div>
                <div v-if="applyStatus === 'applying'">
                    <el-button plain @click="cancelApply">取消申请</el-button>
                </div>
                <div v-if="applyStatus === 'reject'">
                    <el-button plain @click="dialogVisible = true">重新申请</el-button>
                </div>
            </div>
        </div>
        <div class="part">
            <div class="title">基本信息</div>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">应用名称: {{ detailInfo.name }}</el-col>
                <el-col :span="8" :xs="24">创建人: {{ detailInfo.owner }}</el-col>
                <el-col :span="8" :xs="24">应用状态: {{ businessStatusText }}</el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24" :xs="24" class="app-id-cell">
                    AppId:
                    <span class="app-id-text">{{ appIdText }}</span>
                    <el-button
                        v-if="appIdText !== '-'"
                        class="app-id-copy-btn"
                        link
                        type="primary"
                        @click="copyAppId"
                    >
                        复制
                    </el-button>
                </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24">应用描述: {{ detailInfo.description }}</el-col>
            </el-row>
        </div>
        <div class="part">
            <div class="title">应用信息</div>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">应用分类: {{ applicationCodeText }}</el-col>
                <el-col :span="8" :xs="24"
                    >依赖应用:
                    {{ dependencyText }}
                </el-col>
                <el-col :span="8" :xs="24">访问地址(URL): {{ detailInfo.location }} </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="8" :xs="24"
                    >源码路径:
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
            </el-row>
        </div>

        <AuditSummaryPanel v-if="pageFrom === 'myApply' && auditDetail" :audit="auditDetail" />
    </div>

    <ResultChooseModal
        v-model="innerVisible"
        title="应用上架成功"
        mainDesc="应用上架成功"
        subDesc="应用已成功上架至应用市场"
        rightBtnText="返回列表"
        :rightBtnClick="toList"
        :closeClick="closeInnerModal"
    >
        <template #icon>
            <el-icon :size="70"><SuccessFilled color="#30A46C" /></el-icon>
        </template>
    </ResultChooseModal>

    <ConfigCapabilityModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detailInfo" />

    <ApplyUseModal
        title="重新申请"
        :dialogVisible="dialogVisible"
        :detail="detailInfo"
        :afterSubmit="afterSubmit"
        :closeClick="afterSubmit"
    />
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue'
import BreadcrumbHeader from '@/views/components/BreadcrumbHeader.vue'
import ApplyStatus from '@/views/components/ApplyStatus.vue'
import { WarningFilled, SuccessFilled } from '@element-plus/icons-vue'
import ResultChooseModal from '@/views/components/ResultChooseModal.vue'
import { ElMessageBox } from 'element-plus'
import { h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import $application, {
    ApplicationMetadata,
    businessStatusMap,
    codeMap,
    resolveBusinessStatus,
    serviceCodeMap
} from '@/plugins/application'
import { Link } from '@element-plus/icons-vue'
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
const detailInfo = ref<ApplicationMetadata>({
    name: '',
    description: '',
    location: '',
    code: '',
    serviceCodes: [],
    avatar: '',
    owner: '',
    ownerName: '',
    codePackagePath: ''
})
const pageFrom = String(route.query.pageFrom || '')
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
    const code = String(detailInfo.value.code || '').trim()
    if (!code) {
        return '-'
    }
    return codeMap[code] || code
})

const dependencyText = computed(() => {
    const raw = detailInfo.value.serviceCodes
    const codes = Array.isArray(raw)
        ? raw.map((item) => String(item).trim()).filter(Boolean)
        : typeof raw === 'string'
          ? raw.split(',').map((item) => item.trim()).filter(Boolean)
          : []
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
        throw new Error('审批单缺少应用信息')
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

const copyAppId = async () => {
    const appId = String(detailInfo.value?.uid || applyUid || '').trim()
    if (!appId) {
        notifyError('当前应用缺少 AppId')
        return
    }
    try {
        await writeClipboardText(appId)
        notifySuccess('AppId 已复制')
    } catch {
        notifyError('复制 AppId 失败')
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
                      reason: '申请使用',
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
            throw new Error('未找到申请记录')
        }
        const audit = await $audit.detail(auditId)
        if (!audit) {
            throw new Error('申请记录不存在')
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
        notifyError('❌未找到申请记录')
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
        await $application.myCreateDelete(applyUid)
    } else if (pageFrom === 'market') {
        const app = detailInfo.value?.uid ? detailInfo.value : await $application.queryByUid(applyUid)
        if (!app) {
            notifyError('❌应用不存在')
            return
        }
        await $application.offline({ uid: app.uid, did: app.did, version: app.version })
    }
    // 删除成功后跳转到列表页
    toList()
}

const toList = () => {
    router.push({
        path: '/market'
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
        path: '/market/apply-edit',
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
            notifyError(`❌获取应用详情失败: ${error instanceof Error ? error.message : String(error)}`)
        })
    }
}

/**
 * 上架应用
 */
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
            const detailRst = await $application.myCreateDetailByUid(applyUid)
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

/**
 * 下架应用
 */
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
            /**
             * todo 学虎 我创建的-详情页-右上角-下架按钮调用接口
             */
        })
        .catch(() => {})
}

onMounted(() => {
    void detail().catch((error) => {
        notifyError(`❌获取应用详情失败: ${error instanceof Error ? error.message : String(error)}`)
    })
})
</script>

<style scoped lang="less">
.detail {
    margin: 20px;
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
    .app-id-copy-btn {
        padding: 0;
    }
}
</style>
