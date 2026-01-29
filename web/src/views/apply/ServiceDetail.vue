<template>
    <div class="detail">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/market/service' }">服务中心</el-breadcrumb-item>
            <el-breadcrumb-item>服务详情</el-breadcrumb-item>
        </el-breadcrumb>

        <div class="header">
            <div class="left-header">
                <BreadcrumbHeader :pageName="detailInfo.name" />
                <ApplyStatus :status="applyStatus" v-if="urlQuery.pageFrom === 'myApply'" />
            </div>

            <!-- 服务中心-我的创建的详情 -->
            <div v-if="urlQuery.pageFrom === 'myCreate'">
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
                    <el-button plain>编辑</el-button>
                    <el-button type="danger" plain @click="handleOnlineConfirm">上架服务</el-button>
                </div>
            </div>
            <!-- 服务中心-我的申请的详情 -->
            <div v-if="urlQuery.pageFrom === 'myApply'">
                <div>
                    <el-button v-if="applyStatus === 'applying'" type="danger" @click="cancelApply">取消申请</el-button>
                    <el-button v-if="applyStatus === 'success'" type="danger" @click="handleUnbindConfirm">解绑服务</el-button>
                    <el-button v-if="applyStatus === 'success'" plain @click="toConfigService">配置服务</el-button>
                    <el-button
                        v-if="applyStatus === 'cancel' || applyStatus === 'reject'"
                        plain
                        @click="dialogVisible = true"
                    >重新申请</el-button>
                </div>
            </div>
        </div>

        <div class="part">
            <el-row class="count-row">
                <el-col :span="4" :xs="24"
                    >绑定服务数:
                    <div style="font-weight: 500; font-size: 30px">{{ detailInfo.bindApplyCount || '-' }}</div></el-col
                >
                <el-col :span="1" :xs="24"> <el-divider direction="vertical" /></el-col>
                <el-col :span="4" :xs="24"
                    >用户使用数:
                    <div style="font-weight: 500; font-size: 30px">{{ detailInfo.userCount || '-' }}</div></el-col
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
                <el-col :span="24">创建时间: {{ detailInfo.createTime }}</el-col>
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
                    {{ detailInfo.serviceCodes && detailInfo.serviceCodes.join(',') }}
                </el-col>
                <el-col :span="8" :xs="24">代理地址: {{ detailInfo.location }} </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="8" :xs="24">服务地址:{{ detail.serviceIP }} </el-col>
            </el-row>
        </div>
        <div class="part">
            <el-row class="part-row">
                <el-col :span="24" :xs="24" style="font-size: 26px; font-weight: 500">【功能介绍】</el-col>
                <el-col :span="24" :xs="24">
                    <el-input v-model="textarea" :rows="2" type="textarea" placeholder="请输入功能介绍" />
                </el-col>
            </el-row>
            <el-row class="part-row">
                <el-col :span="24" :xs="24" style="font-size: 26px; font-weight: 500">【使用方法】</el-col>
                <el-col :span="24" :xs="24">
                    <el-input v-model="textarea" :rows="2" type="textarea" placeholder="请输入使用方法" />
                </el-col>
            </el-row>
        </div>
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
import { useRoute } from 'vue-router'
import $service from '@/plugins/service'
import $audit, { resolveAuditState } from '@/plugins/audit'
import { getCurrentAccount, signWithWallet } from '@/plugins/auth'
import { generateUuid, getCurrentUtcString } from '@/utils/common'
import { buildSubmitAuditMessage, normalizeAddress } from '@/utils/auditSignature'
import { notifyError } from '@/utils/message'
import ApplyUseModal from '@/views/components/ApplyUseModal.vue'
import ConfigServiceModal from '@/views/components/ConfigServiceModal.vue'
import { Link } from '@element-plus/icons-vue'
const route = useRoute()
const urlQuery = ref({})
const detailInfo = ref({})
/**
 * 应用是否上架，这里需要调用接口查询应用的上架状态
 */
const isOnline = ref(false) // 是否已经上架

const applyStatus = ref('applying')
const dialogVisible = ref(false)
const modalVisible = ref(false)

const detail = async () => {
    if (route.query.pageFrom === 'myCreate') {
        const detailRst = await $service.myCreateDetailByUid(route.query.uid as string)
        detailInfo.value = detailRst || {}
    } else if (route.query.pageFrom === 'myApply') {
        const detailRst = await $service.myApplyDetailByUid(route.query.uid as string)
        if (detailRst) {
            detailInfo.value = detailRst || {}
        } else {
            const remote = await $service.queryByUid(route.query.uid as string)
            detailInfo.value = remote || {}
        }
    } else {
        const detailRst = await $service.queryByUid(route.query.uid as string)
        detailInfo.value = detailRst || {}
    }
    const status = detailInfo.value?.status
    isOnline.value = Boolean(detailInfo.value?.isOnline) || status === 'BUSINESS_STATUS_ONLINE'
}

const resolveApplyStatus = async () => {
    const account = getCurrentAccount()
    if (!account) {
        applyStatus.value = 'cancel'
        return
    }
    const applicant = `${account}::${account}`
    const detailList = await $audit.search({ applicant })
    const candidates = Array.isArray(detailList)
        ? detailList.filter((d) => d.meta?.reason === '申请使用' && d.meta?.appOrServiceMetadata?.includes(`"name":"${detailInfo.value?.name}"`))
        : []
    if (candidates.length === 0) {
        applyStatus.value = 'cancel'
        return
    }
    const latest = candidates.sort((a, b) => {
        const at = a.meta?.createdAt ? Date.parse(a.meta.createdAt) : 0
        const bt = b.meta?.createdAt ? Date.parse(b.meta.createdAt) : 0
        return bt - at
    })[0]
    const state = resolveAuditState(latest.commentMeta, latest.meta?.approver)
    if (state === '审批通过') {
        applyStatus.value = 'success'
    } else if (state === '审批驳回') {
        applyStatus.value = 'reject'
    } else {
        applyStatus.value = 'applying'
    }
}

const props = defineProps({
    detail: Object,
    selectId: Number,
    refreshCardList: Function,
    pageFrom: String
})


/**
 * 导出身份
 */
const exportIdentity = async () => {
    if (props.pageFrom === 'myCreate') {
        const detailRst = await $service.myCreateDetailByUid(props.detail?.uid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    } else {
        const detailRst = await $service.queryByUid(props.detail?.uid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    }
}

/**
 * todo 学虎，删除应用接口
 */

const toDelete = () => {}

const cancelApply = async () => {
    const account = getCurrentAccount()
    if (!account) {
        notifyError('❌未查询到当前账户，请登录')
        return
    }
    const applicant = `${account}::${account}`
    const detailList = await $audit.search({ applicant })
    const auditUids = Array.isArray(detailList)
        ? detailList
              .filter(
                  (d) =>
                      d.meta?.reason === '申请使用' &&
                      d.meta?.appOrServiceMetadata?.includes(`"name":"${detailInfo.value?.name}"`)
              )
              .map((s) => s.meta.uid)
        : []
    for (const item of auditUids) {
        await $audit.cancel(item)
    }
    applyStatus.value = 'cancel'
}

const afterSubmit = () => {
    dialogVisible.value = false
    applyStatus.value = 'applying'
}

const toConfigService = () => {
    modalVisible.value = true
}

const cancelModal = () => {
    modalVisible.value = false
}

const isOkStatus = (code) => code === 0 || code === 1 || code === 'OK' || code === 'RESPONSE_CODE_OK'

const handleOnline = async () => {
    const detailRst = await $service.myCreateDetailByUid(route.query.uid as string)
    if (!detailRst) {
        notifyError('❌服务不存在')
        return
    }
    const account = getCurrentAccount()
    if (!account) {
        notifyError('❌未查询到当前账户，请登录')
        return
    }
    const applicant = `${account}::${account}`
    let searchList = await $audit.search({ name: detailRst.name })
    searchList = Array.isArray(searchList)
        ? searchList.filter(
              (a) =>
                  a.meta.applicant === applicant &&
                  a.meta.appOrServiceMetadata.includes(`"operateType":"service"`)
          )
        : []
    if (searchList.length > 0) {
        ElMessageBox.alert('您已申请，无需重复申请', '提示')
            .then(() => {})
            .catch(() => {})
        return
    }
    detailRst.operateType = 'service'
    const auditUid = generateUuid()
    const createdAt = getCurrentUtcString()
    const signatureMessage = buildSubmitAuditMessage({
        targetType: 'service',
        targetDid: detailRst.did,
        targetVersion: detailRst.version,
        applicant: normalizeAddress(account),
        timestamp: createdAt,
        nonce: auditUid
    })
    const signature = await signWithWallet(signatureMessage)
    const meta = {
        uid: auditUid,
        appOrServiceMetadata: JSON.stringify(detailRst),
        auditType: 'service',
        applicant,
        reason: '上架申请',
        createdAt,
        updatedAt: createdAt,
        signature
    }
    const status = await $audit.create(meta)
    if (isOkStatus(status?.code)) {
        ElMessage({ message: '已提交上架申请', type: 'success' })
    } else {
        ElMessage({ message: status?.message || '上架申请失败', type: 'error' })
    }
}

const handleOffline = async () => {
    const offlineRst = await $service.offline({
        uid: detailInfo.value?.uid,
        did: detailInfo.value?.did,
        version: detailInfo.value?.version
    })
    if (isOkStatus(offlineRst?.code)) {
        isOnline.value = false
        ElMessage({ message: '已下架', type: 'success' })
        const account = getCurrentAccount()
        if (!account) {
            notifyError('❌未查询到当前账户，请登录')
            return
        }
        const applicant = `${account}::${account}`
        const detail = await $audit.search({ applicant })
        const uids = Array.isArray(detail)
            ? detail
                  .filter((d) => d.meta.appOrServiceMetadata.includes(`"name":"${detailInfo.value?.name}"`))
                  .map((s) => s.meta.uid)
            : []
        for (const item of uids) {
            await $audit.cancel(item)
        }
    } else {
        ElMessage({ message: offlineRst?.message || '下架失败', type: 'error' })
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

const handleUnbindConfirm = () => {
    ElMessageBox.confirm('确定要解绑当前服务吗？', '提示', {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消'
    })
        .then(async () => {
            await $service.unbind(route.query.uid as string)
            applyStatus.value = 'cancel'
            ElMessage({ message: '已解绑', type: 'success' })
        })
        .catch(() => {})
}

onMounted(() => {
    urlQuery.value = route.query
    void (async () => {
        await detail()
        if (route.query.pageFrom === 'myApply') {
            await resolveApplyStatus()
        }
    })()
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
    }
    .link-url {
        vertical-align: middle;
    }
    .link-icon {
        color: rgba(22, 119, 255, 1);
    }
}
</style>
