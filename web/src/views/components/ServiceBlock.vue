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
                        <div class="ownerTitle">所有者:</div>
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
                        <div>所有者名称:</div>
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
                <div @click="handleOfflineConfirm" class="cursor">下架服务</div>
                <el-divider direction="vertical" />
                <div class="bottom-more">
                    <el-dropdown placement="top-start">
                        <div>更多</div>
                        <template #dropdown>
                            <el-dropdown-menu>
                                <el-dropdown-item>
                                    <el-popconfirm
                                        confirm-button-text="确定"
                                        cancel-button-text="取消"
                                        :icon="WarningFilled"
                                        icon-color="#FB9A0E"
                                        title="您确定要删除该服务吗？"
                                        width="220px"
                                        @confirm="toDelete"
                                    >
                                        <template #reference> 删除 </template>
                                    </el-popconfirm>
                                </el-dropdown-item>

                                <el-dropdown-item @click="toEdit">编辑</el-dropdown-item>
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
                <div v-if="isOnline" @click="handleOfflineConfirm" class="cursor">下架服务</div>
                <div v-else @click="handleOnline" class="cursor">上架服务</div>
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
                                        title="您确定要删除该服务吗？"
                                        width="220px"
                                        @confirm="toDelete"
                                    >
                                        <template #reference>删除</template>
                                    </el-popconfirm>
                                </el-dropdown-item>

                                <el-dropdown-item v-if="!isOnline" @click="toEdit"
                                    >编辑</el-dropdown-item
                                >
                                <el-dropdown-item disabled>加入子网</el-dropdown-item>
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
                    title="您确定要取消当前服务的申请吗？"
                    width="220px"
                    @confirm="cancelApply"
                >
                    <template #reference>
                        <div v-if="applyStatus === 'applying'" class="cursor">取消申请</div>
                    </template>
                </el-popconfirm>

                <div v-if="applyStatus === 'success'" @click="toConfigService" class="cursor">配置服务</div>

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
        :operateType="operateType"
    />
    <ConfigServiceModal :modalVisible="modalVisible" :cancelModal="cancelModal" :detail="detail" operateType="service" />
    <ResultChooseModal
        v-model="innerVisible"
        title="服务申请上架"
        mainDesc="服务申请上架"
        subDesc="服务已申请上架，待审批"
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
import { SuccessFilled, WarningFilled } from '@element-plus/icons-vue'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { h } from 'vue'
import ApplyUseModal from './ApplyUseModal.vue'
import ConfigServiceModal from './ConfigServiceModal.vue'
import ResultChooseModal from './ResultChooseModal.vue'
import { exportIdentityInfo } from '@/plugins/account'
import $audit, { isAuditForResource, resolveUsageAuditStatus } from '@/plugins/audit'
import $service, { ServiceMetadata, businessStatusMap, resolveBusinessStatus } from '@/plugins/service'
import { getCurrentAccount } from '@/plugins/auth'
import { notifyError } from '@/utils/message'
import { normalizeAddress } from '@/utils/actionSignature'

const innerVisible = ref(false)
const dialogVisible = ref(false)
const modalVisible = ref(false)
const operateType = ref('service')


const router = useRouter()
const props = defineProps({
    detail: Object as () => ServiceMetadata,
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
    return normalizeAddress(account) === normalizeAddress(String(props.detail?.owner || ''))
}

const businessStatus = computed(() => resolveBusinessStatus(props.detail))
const businessInfo = computed(() => businessStatusMap[businessStatus.value] || businessStatusMap.BUSINESS_STATUS_UNKNOWN)
const isOnline = computed(() => businessStatus.value === 'BUSINESS_STATUS_ONLINE')
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
                  auditType: 'service',
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
 * 申请使用
 */
const applyUse = async () => {
    dialogVisible.value = true
}

const toDelete = async () => {
    if (props.pageFrom === 'myCreate') {
        await $service.myCreateDelete(props.detail?.uid)
    }
    props.refreshCardList()
}
const toEdit = () => {
    router.push({
        path: '/market/service-edit',
        query: {
            uid: props.detail?.uid
        }
    })
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
                          auditType: 'service',
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

const cancelModal = () => {
    modalVisible.value = false
}

const toConfigService = () => {
    modalVisible.value = true
}

const toList = () => {
    innerVisible.value = false
}

const exportIdentity = async () => {
    if (props.pageFrom === 'myCreate') {
        const detailRst = await $service.myCreateDetailByUid(props.detail?.uid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    } else {
        const detailRst = await $service.queryByUid(props.detail?.uid)
        await exportIdentityInfo(detailRst.did, detailRst.name)
    }
}
const toDetail = () => {
    router.push({
        path: '/market/service-detail',
        query: {
            uid: props.detail?.uid,
            pageFrom: props.pageFrom,
            auditId: props.pageFrom === 'myApply' ? props.detail?.applyAuditId : undefined
        }
    })
}

// 下架服务
const handleOffline = async () => {
    const status = await $service.offline({ uid: props.detail?.uid, did: props.detail?.did, version: props.detail?.version })
    if (status?.unpublished) {
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
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, '你确定要下架当前服务吗？'),
            h(
                'div',
                { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' },
                '下架后当前应用将不在服务市场展示。'
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
        .catch(() => {})
}

// 上架应用
const handleOnline = () => {
    ElMessageBox.confirm('', {
        message: h('p', null, [
            h('div', { style: 'font-size:18px;color:rgba(0,0,0,0.85)' }, '你确定要上架当前服务吗？'),
            h(
                'div',
                { style: 'font-size:14px;font-weight:400;color:rgba(0,0,0,0.85)' },
                '上架后当前服务将不可再编辑修改。'
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
            const detailRst = await $service.myCreateDetailByUid(props.detail?.uid)
            if (!detailRst) {
                notifyError("❌服务不存在")
                return
            }
            const created = await $audit.submitPublishRequest({
                auditType: 'service',
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

// const emit = defineEmits(['change']);
</script>
<style scoped lang="less">
/* 强制显示弹窗 */

.tab {
    background-color: #fff;
    border-radius: 6px;
    padding: 20px;
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
                font-size: 18px;
                font-weight: 500;
                color: rgba(0, 0, 0, 0.85);
                line-height: 1.35;
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
                font-size: 14px;
                font-weight: 400;
                line-height: 1.6;
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
                font-size: 13px;
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
    font-size: 13px;
}
.waring-text {
    font-size: 16px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
}
.high-z-index {
    z-index: 3000 !important; /* 需大于 ElDropdown 的 z-index（通常是 2000+） */
}
</style>
