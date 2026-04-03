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
                    <el-button plain @click="toConfigService">配置服务</el-button>
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
                <el-col :span="8" :xs="24">应用状态:{{ '-' }}</el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24">应用描述: {{ detailInfo.description }}</el-col>
            </el-row>
        </div>
        <div class="part">
            <div class="title">应用信息</div>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">应用代号: {{ detailInfo.code }}</el-col>
                <el-col :span="8" :xs="24"
                    >绑定服务代号:
                    {{ detailInfo.serviceCodes && detailInfo.serviceCodes.join(',') }}
                </el-col>
                <el-col :span="8" :xs="24">访问地址(URL): {{ detailInfo.location }} </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="8" :xs="24"
                    >代码包:
                    <a class="link-url" :href="detailInfo.codePackagePath" style="color: rgba(22, 119, 255, 1)">
                        <el-link type="primary" :icon="Link">{{ detailInfo.code }}</el-link>
                    </a>
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

    <ConfigServiceModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detailInfo" operateType="application" />

    <ApplyUseModal
        title="重新申请"
        :dialogVisible="dialogVisible"
        :detail="detailInfo"
        :afterSubmit="afterSubmit"
        :closeClick="afterSubmit"
        operateType="application"
    />
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import BreadcrumbHeader from '@/views/components/BreadcrumbHeader.vue'
import ApplyStatus from '@/views/components/ApplyStatus.vue'
import { WarningFilled, SuccessFilled } from '@element-plus/icons-vue'
import ResultChooseModal from '@/views/components/ResultChooseModal.vue'
import { ElMessageBox } from 'element-plus'
import { h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import $application, { ApplicationMetadata } from '@/plugins/application'
import { Link } from '@element-plus/icons-vue'
import ConfigServiceModal from '@/views/components/ConfigServiceModal.vue'
import ApplyUseModal from '@/views/components/ApplyUseModal.vue'
import AuditSummaryPanel from '@/views/components/AuditSummaryPanel.vue'
import { exportIdentityInfo } from '@/plugins/account'
import { getCurrentAccount } from '@/plugins/auth'
import { notifyError } from '@/utils/message'
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

const toConfigService = () => {
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
}
</style>
