<template>
    <div class="tab">
        <div class="top">
            <div class="top-left">
                <el-avatar shape="square" size="50" :src="detail.avatar" />
            </div>
            <div class="top-right">
                <div class="name">{{ detail.name }}</div>
                <div v-if="businessStatus !== 'BUSINESS_STATUS_UNKNOWN'" class="badge-info">
                    <el-badge is-dot :type="businessInfo.type" />
                    <span class="badge-text">{{ businessInfo.text }}</span>
                </div>
                <div class="title">
                     <div class="ownerWrap" v-if="detail.owner && pageFrom !== 'myCreate'">
                        <div>所有者:</div>
                        <div class="ownerContent">{{ detail.owner }}</div>
                    </div>
                    <span v-else>
                        <el-tag type="primary" size="small">官方</el-tag>
                    </span>
                    <span>
                        {{ pageFrom === 'myCreate' || !isOnline ? '创建于' : '上架于' }}
                        {{ dayjs(detail.createdAt).format('YYYY-MM-DD') }}</span
                    >
                </div>
                <div class="desc">
                    <div class="ownerWrap" v-if="detail.ownerName && pageFrom !== 'myCreate'">
                        <div>所有者名称：</div>
                        <div class="ownerContent">{{ detail.ownerName }}</div>
                    </div>
                </div>
                <div class="desc">
                    {{ detail.description }}
                </div>
            </div>
        </div>

        <!-- 应用市场 -->
        <div v-if="pageFrom === 'market'">
            <div class="bottom owner" v-if="!isOwner">
                <div @click="toDetail" class="cursor">详情</div>
                <el-divider direction="vertical" />
                <div v-if="!isOwner" @click="applyUse()" class="cursor">申请使用</div>
            </div>
            <div class="bottom owner" v-else>
                <div @click="toDetail" class="cursor">详情</div>
                <el-divider direction="vertical" />
                <div @click="handleOfflineConfirm" class="cursor">下架应用</div>
                <el-divider direction="vertical" />
                <div class="bottom-more">
                    <el-dropdown placement="top-start">
                        <div>更多</div>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item @click="exportIdentity">导出身份</el-dropdown-item>
                            </el-dropdown-menu>
                        </template>
                    </el-dropdown>
                </div>
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

                <Popover
                    :show="applyStatus === 'success'"
                    title="您确定要解绑当前服务吗？"
                    subTitle="解绑后，当前服务将从当前列表移除，如需使用需重新申请。"
                    :okClick="confirmUnbind"
                    referenceText="解绑应用"
                />

                <el-divider v-if="applyStatus === 'success'" direction="vertical" />
                <div v-if="applyStatus !== 'applying'" class="bottom-more">
                    <el-dropdown placement="top-start">
                        <div>更多</div>
                        <template #dropdown>
                            <el-dropdown-menu>
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
                                        <el-dropdown-item v-if="applyStatus === 'cancel' || applyStatus === 'reject'">
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
                                    </template>
                                </el-popconfirm>

                                <el-dropdown-item v-if="applyStatus === 'cancel' || applyStatus === 'reject'" @click="dialogVisible = true"
                                    >重新申请</el-dropdown-item>
                                <el-dropdown-item v-if="applyStatus === 'success'" @click="toConfigService"
                                    >配置服务</el-dropdown-item
                                >
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
        :operateType="operateType"
    />
    <ConfigServiceModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detail" operateType="application" />
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
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import $audit, { AuditAuditMetadata, resolveAuditState } from '@/plugins/audit'
import { SuccessFilled } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { exportIdentityInfo } from '@/plugins/account'
import { ElMessage, ElMessageBox } from 'element-plus'
import { h } from 'vue'
import Popover from '@/views/components/Popover.vue'
import ApplyUseModal from './ApplyUseModal.vue'
import ConfigServiceModal from './ConfigServiceModal.vue'
import ResultChooseModal from './ResultChooseModal.vue'
import { generateUuid, getCurrentUtcString } from '@/utils/common'
import $application, { businessStatusMap, resolveBusinessStatus } from '@/plugins/application'
import { notifyError } from '@/utils/message'
import { getCurrentAccount, signWithWallet } from '@/plugins/auth'
import { buildSubmitAuditMessage, normalizeAddress } from '@/utils/auditSignature'

const router = useRouter()
const props = defineProps({
    detail: Object,
    selectId: Number,
    refreshCardList: Function,
    pageFrom: String
})

const isOwner = () => {
    const account = getCurrentAccount()
    if (account === undefined || account === null) {
        notifyError("❌未查询到当前账户，请登录")
        return false
    }
    return account === props.detail?.owner
}

// 解绑应用
const confirmUnbind = async () => {
    await $application.unbind(props.detail?.uid)
    props.refreshCardList()
}
const innerVisible = ref(false)
const dialogVisible = ref(false)
const modalVisible = ref(false)
const operateType = ref('application')

const businessStatus = computed(() => resolveBusinessStatus(props.detail))
const businessInfo = computed(() => businessStatusMap[businessStatus.value] || businessStatusMap.BUSINESS_STATUS_UNKNOWN)
const isOnline = computed(() => businessStatus.value === 'BUSINESS_STATUS_ONLINE')

/**
 * 申请应用的状态
 * 我申请的-每个应用卡片的右上角展示申请状态
 * 每个卡片的按钮展示与隐藏依赖该状态
 */
const applyStatus = ref('applying')

const getApplyStatus = async () => {
    const account = getCurrentAccount()
    if (!account) {
        applyStatus.value = 'cancel'
        return
    }
    const applicant = `${account}::${account}`
    const detail = await $audit.search({ applicant })
    const candidates = Array.isArray(detail)
        ? detail.filter((d) => d.meta?.reason === '申请使用' && d.meta?.appOrServiceMetadata?.includes(`"name":"${props.detail?.name}"`))
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

/**
 * 取消申请
 *
 */
const cancelApply = async () => {
    const account = getCurrentAccount()
    if (!account) {
        notifyError('❌未查询到当前账户，请登录')
        return
    }
    const applicant = `${account}::${account}`
    const detail = await $audit.search({ applicant })
    const auditUids = Array.isArray(detail)
        ? detail
              .filter(
                  (d) =>
                      d.meta?.reason === '申请使用' &&
                      d.meta?.appOrServiceMetadata?.includes(`"name":"${props.detail?.name}"`)
              )
              .map((s) => s.meta.uid)
        : []
    for (const item of auditUids) {
        await $audit.cancel(item)
    }
    applyStatus.value = 'cancel'
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
    } else {
        await $application.myApplyDelete(props.detail?.uid)
    }
    props.refreshCardList()
}

const toEdit = async () => {
    router.push({
        path: '/market/apply-edit',
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
    router.push({
        path: '/market/apply-detail',
        query: {
            uid: props.detail?.uid,
            pageFrom: props.pageFrom
        }
    })
}
const toList = () => {
    innerVisible.value = false
}

const toConfigService = () => {
    modalVisible.value = true
}

const cancelModal = () => {
    modalVisible.value = false
}

const isOkStatus = (code) => code === 0 || code === 1 || code === 'OK' || code === 'RESPONSE_CODE_OK'

// 下架应用
const handleOffline = async () => {
    /**
     * todo 学虎 这块调用下架应用接口
     */
    const offlinelRst = await $application.offline({ uid: props.detail?.uid, did: props.detail?.did, version: props.detail?.version })

    if (isOkStatus(offlinelRst?.code)) {
        ElMessage({
            message: '已下架',
            type: 'success'
        })
        props.refreshCardList()
        const account = getCurrentAccount()
        if (account === undefined || account === null) {
            notifyError("❌未查询到当前账户，请登录")
            return
        }
        const applicant = `${account}::${account}`
        const detail = await $audit.search({applicant: applicant})
        const auditUids = detail.filter((d) => d.meta.appOrServiceMetadata.includes(`"name":"${props.detail?.name}"`)).map((s) => s.meta.uid)
        // 删除申请
        for (const item of auditUids) {
            await $audit.cancel(item)
        }
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
            /**
             * 创建上架申请
             * innerVisible.value = true 是上架成功后，打开一个弹窗提示用户上架成功了
             */
            const detailRst = await $application.myCreateDetailByUid(props.detail.uid)
            if (!detailRst) {
                notifyError("❌应用不存在")
                return
            }
            // 重复申请检查
            const account = getCurrentAccount()
            if (account === undefined || account === null) {
                notifyError("❌未查询到当前账户，请登录")
                return
            }
            const synced = await $application.syncToServer(detailRst)
            if (!synced) {
                return
            }
            detailRst.uid = detailRst.uid || synced.uid
            detailRst.did = detailRst.did || synced.did
            detailRst.version = detailRst.version ?? synced.version
            detailRst.owner = detailRst.owner || synced.owner
            detailRst.ownerName = detailRst.ownerName || synced.ownerName
            const applicant = `${account}::${account}`
            let searchList = await $audit.search({name: detailRst.name})
            searchList = Array.isArray(searchList)
                ? searchList.filter((a) => a.meta.applicant === applicant && a.meta.appOrServiceMetadata.includes(`"operateType":"application"`))
                : []
            if (searchList.length > 0) {
                ElMessageBox.alert('您已申请，无需重复申请', '提示')
                .then(() => {
                })
                .catch(() => {
                });
                return
            }
            detailRst.operateType = 'application'
            const auditUid = generateUuid()
            const createdAt = getCurrentUtcString()
            const applicantAddress = normalizeAddress(account)
            const signatureMessage = buildSubmitAuditMessage({
                targetType: 'application',
                targetDid: detailRst.did,
                targetVersion: detailRst.version,
                applicant: applicantAddress,
                timestamp: createdAt,
                nonce: auditUid
            })
            const signature = await signWithWallet(signatureMessage)
            const meta: AuditAuditMetadata = {
                uid: auditUid,
                appOrServiceMetadata: JSON.stringify(detailRst),
                auditType: 'application',
                applicant: applicant, // 申请人身份，did::name
                reason: '上架申请',
                createdAt,
                updatedAt: createdAt,
                signature
            }
            const status = await $audit.create(meta)
            if (isOkStatus(status?.code)) {
                innerVisible.value = true
            } else {
                notifyError(`❌申请失败: ${status?.message || '未知错误'}`)
            }
            } catch (error) {
                notifyError(`❌申请失败: ${error}`)
            }
        })
        .catch(() => {})
}

const afterSubmit = () => {
    dialogVisible.value = false
}

if (props.pageFrom === 'myApply') {
    getApplyStatus()
}

// const emit = defineEmits(['change']);
</script>
<style scoped lang="less">
.tab {
    background-color: #fff;
    border-radius: 6px;
    padding: 24px;
    .cursor {
        cursor: pointer;
    }
    .top {
        display: flex;
        gap: 16px;
        .top-left {
        }
        .top-right {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 8px;
            .name {
                font-size: 20px;
                font-weight: 500;
                color: rgba(0, 0, 0, 0.85);
            }
            .title {
                display: flex;
                color: rgba(0, 0, 0, 0.45);
                font-size: 14px;
                font-weight: 400;
                gap: 4px;
                .el-tag {
                    margin-top: -4px;
                }
            }
            .ownerWrap {
                display: flex;
            }
            .ownerTitle {
                white-space: nowrap;
            }
            .ownerContent {
                max-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .desc {
                color: rgba(0, 0, 0, 0.45);
                font-size: 16px;
                font-weight: 400;
                height: 44px;
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2; /* 限制显示的行数 */
                overflow: hidden;
                text-overflow: ellipsis; /* 文本溢出时显示省略号 */
            }

            .badge-info {
                position: absolute;
                right: 0px;
                top: 0px;
                .el-badge {
                    margin-top: 5px;
                }
            }

            .badge-text {
                font-size: 14px;
                margin: -15px 0 0 8px;
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
    font-size: 14px;
}
.waring-text {
    font-size: 18px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
}

.font-medium {
    font-weight: 500;
}

.text-sm {
    font-size: 12px;
}

.ml-3 {
    margin-left: 12px;
}

.mt-1 {
    margin-top: 4px;
}
</style>
