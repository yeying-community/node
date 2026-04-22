<template>
    <div class="detail">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/market/service' }">服务中心</el-breadcrumb-item>
            <el-breadcrumb-item>服务详情</el-breadcrumb-item>
        </el-breadcrumb>

        <div class="header">
            <div class="left-header">
                <BreadcrumbHeader :pageName="detailInfo.name" />
                <ApplyStatus :status="applyStatus" v-if="pageFrom === 'myApply'" />
            </div>

            <!-- 服务中心-我的创建的详情 -->
            <div v-if="pageFrom === 'myCreate'">
                <div v-if="isOnline">
                    <el-button plain @click="exportIdentity">导出身份</el-button>
                    <el-button type="danger" plain @click="handleOfflineConfirm">下架服务</el-button>
                </div>
                <div v-else>
                    <el-popconfirm
                        confirm-button-text="确定"
                        cancel-button-text="取消"
                        :icon="WarningFilled"
                        icon-color="#FB9A0E"
                        title="您确定要删除该服务吗？"
                        width="220px"
                        @confirm="toDelete"
                    >
                        <template #reference> <el-button plain>删除</el-button> </template>
                    </el-popconfirm>

                    <el-button plain @click="exportIdentity">导出身份</el-button>
                    <el-button plain @click="toEdit">编辑</el-button>
                    <el-button type="danger" plain @click="handleOnlineConfirm">上架服务</el-button>
                </div>
            </div>
            <!-- 服务中心-我的申请的详情 -->
            <div v-if="pageFrom === 'myApply'">
                <div>
                    <el-button v-if="applyStatus === 'applying'" type="danger" @click="cancelApply">取消申请</el-button>
                    <el-button v-if="applyStatus === 'success'" plain @click="toConfigService">配置服务</el-button>
                    <el-button v-if="applyStatus === 'reject'" plain @click="dialogVisible = true">重新申请</el-button>
                </div>
            </div>
        </div>

        <div class="part">
            <el-row class="count-row">
                <el-col :span="4" :xs="24"
                    >绑定服务数:
                    <div class="count-value">{{ detailInfo.bindApplyCount || '-' }}</div></el-col
                >
                <el-col :span="1" :xs="24"> <el-divider direction="vertical" /></el-col>
                <el-col :span="4" :xs="24"
                    >用户使用数:
                    <div class="count-value">{{ detailInfo.userCount || '-' }}</div></el-col
                >
            </el-row>
        </div>

        <div class="part">
            <div class="title">基本信息</div>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">服务名称: {{ detailInfo.name }}</el-col>
                <el-col :span="8" :xs="24">创建人: {{ detailInfo.owner }}</el-col>
                <el-col :span="8" :xs="24">服务状态:{{ '-' }}</el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24">创建时间: {{ detailInfo.createdAt }}</el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24">服务描述: {{ detailInfo.description }}</el-col>
            </el-row>
        </div>
        <div class="part">
            <div class="title">服务信息</div>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">服务代码: {{ detailInfo.code }}</el-col>
                <el-col :span="8" :xs="24"
                    >接口代码:
                    {{ detailInfo.apiCodes && detailInfo.apiCodes.join(',') }}
                </el-col>
                <el-col :span="8" :xs="24">代理地址: {{ detailInfo.proxy }} </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">服务地址:{{ detailInfo.grpc }} </el-col>
            </el-row>
        </div>
        <div class="part">
            <el-row class="part-row">
                <el-col :span="24" :xs="24" class="section-label">【功能介绍】</el-col>
                <el-col :span="24" :xs="24">
                    <el-input v-model="textarea" :rows="2" type="textarea" placeholder="请输入功能介绍" />
                </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24" :xs="24" class="section-label">【使用方法】</el-col>
                <el-col :span="24" :xs="24">
                    <el-input v-model="textarea" :rows="2" type="textarea" placeholder="请输入使用方法" />
                </el-col>
            </el-row>
        </div>

        <AuditSummaryPanel v-if="pageFrom === 'myApply' && auditDetail" :audit="auditDetail" />
    </div>

    <ApplyUseModal
        title="重新申请"
        :dialogVisible="dialogVisible"
        :detail="detailInfo"
        :afterSubmit="afterSubmit"
        :closeClick="afterSubmit"
        operateType="service"
    />
    <ConfigServiceModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detailInfo" operateType="service" />
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue'
import BreadcrumbHeader from '@/views/components/BreadcrumbHeader.vue'
import ApplyStatus from '@/views/components/ApplyStatus.vue'
import { WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { exportIdentityInfo } from '@/plugins/account'
import { useRoute, useRouter } from 'vue-router'
import $service, { ServiceMetadata } from '@/plugins/service'
import $audit, {
    AuditAuditDetail,
    isAuditForResource,
    parseAuditTargetMetadata,
    resolveUsageAuditStatus
} from '@/plugins/audit'
import { notifyError } from '@/utils/message'
import ApplyUseModal from '@/views/components/ApplyUseModal.vue'
import ConfigServiceModal from '@/views/components/ConfigServiceModal.vue'
import AuditSummaryPanel from '@/views/components/AuditSummaryPanel.vue'
const route = useRoute()
const router = useRouter()
const pageFrom = String(route.query.pageFrom || '')
const detailInfo = ref<ServiceMetadata>({})
const serviceUid = String(route.query.uid || '').trim()
/**
 * 应用是否上架，这里需要调用接口查询应用的上架状态
 */
const isOnline = ref(false) // 是否已经上架

const applyStatus = ref('applying')
const dialogVisible = ref(false)
const modalVisible = ref(false)
const textarea = ref('')
const currentAuditId = ref(String(route.query.auditId || ''))
const auditDetail = ref<AuditAuditDetail | null>(null)

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
        throw new Error('审批单缺少服务信息')
    }
    let remote: ServiceMetadata | null | undefined = null
    try {
        if (parsed.uid) {
            remote = await $service.queryByUid(parsed.uid)
        } else if (parsed.did && parsed.version !== undefined) {
            remote = await $service.detail(parsed.did, parsed.version)
        }
    } catch {
        remote = null
    }
    detailInfo.value = {
        ...(parsed.raw as ServiceMetadata),
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
    const routeDid = String(route.query.did || '').trim()
    const routeVersionValue = route.query.version !== undefined ? Number(route.query.version) : undefined
    const routeVersion = Number.isFinite(routeVersionValue) ? routeVersionValue : undefined
    const audits = await $audit.search({})
    const latest = Array.isArray(audits)
        ? audits
              .filter((audit) =>
                  isAuditForResource(audit, {
                      auditType: 'service',
                      reason: '申请使用',
                      uid: serviceUid || detailInfo.value?.uid,
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

const detail = async () => {
    if (pageFrom === 'myCreate') {
        auditDetail.value = null
        const detailRst = await $service.myCreateDetailByUid(serviceUid)
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
    const detailRst = await $service.queryByUid(serviceUid)
    detailInfo.value = detailRst || {}
    updateOnlineState()
}

/**
 * 导出身份
 */
const exportIdentity = async () => {
    if (pageFrom === 'myCreate') {
        const detailRst = await $service.myCreateDetailByUid(serviceUid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    } else {
        const detailRst = await $service.queryByUid(serviceUid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    }
}

const toEdit = () => {
    router.push({
        path: '/market/service-edit',
        query: {
            uid: serviceUid
        }
    })
}

const toDelete = async () => {
    if (pageFrom === 'myCreate') {
        await $service.myCreateDelete(serviceUid)
    }
    router.push({
        path: '/market/service'
    })
}

const cancelApply = async () => {
    const auditId = await resolveCurrentAuditId()
    if (!auditId) {
        notifyError('❌未找到申请记录')
        return
    }
    await $audit.cancel(auditId)
    router.push({
        path: '/market/service'
    })
}

const afterSubmit = () => {
    dialogVisible.value = false
    applyStatus.value = 'applying'
    currentAuditId.value = ''
    auditDetail.value = null
    if (pageFrom === 'myApply') {
        void detail().catch((error) => {
            notifyError(`❌获取服务详情失败: ${error instanceof Error ? error.message : String(error)}`)
        })
    }
}

const toConfigService = () => {
    modalVisible.value = true
}

const cancelModal = () => {
    modalVisible.value = false
}

const handleOnline = async () => {
    const detailRst = await $service.myCreateDetailByUid(serviceUid)
    if (!detailRst) {
        notifyError('❌服务不存在')
        return
    }
    const created = await $audit.submitPublishRequest({
        auditType: 'service',
        resource: detailRst as Record<string, unknown>
    })
    if (!created?.meta?.uid) {
        return
    }
    ElMessage({ message: '已提交上架申请', type: 'success' })
}

const handleOffline = async () => {
    const offlineRst = await $service.offline({
        uid: detailInfo.value?.uid,
        did: detailInfo.value?.did,
        version: detailInfo.value?.version
    })
    if (offlineRst?.unpublished) {
        isOnline.value = false
        ElMessage({ message: '已下架', type: 'success' })
    } else {
        ElMessage({ message: '下架失败', type: 'error' })
    }
}

const handleOnlineConfirm = () => {
    ElMessageBox.confirm('你确定要上架当前服务吗？', '提示', {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消'
    })
        .then(() => handleOnline())
        .catch(() => {})
}

const handleOfflineConfirm = () => {
    ElMessageBox.confirm('你确定要下架当前服务吗？', '提示', {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消'
    })
        .then(() => handleOffline())
        .catch(() => {})
}

onMounted(() => {
    void detail().catch((error) => {
        notifyError(`❌获取服务详情失败: ${error instanceof Error ? error.message : String(error)}`)
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
        .count-row {
            font-size: 14px;
            font-weight: 400;
            color: rgba(0, 0, 0, 0.85);
        }
        .count-value {
            margin-top: 6px;
            font-size: 24px;
            line-height: 1.2;
            font-weight: 500;
        }
        .section-label {
            font-size: 18px;
            line-height: 1.4;
            font-weight: 500;
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
