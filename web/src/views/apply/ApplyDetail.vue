<template>
    <div class="detail">
        <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/market/' }">应用中心</el-breadcrumb-item>
            <el-breadcrumb-item>应用详情</el-breadcrumb-item>
        </el-breadcrumb>

        <div class="header">
            <div class="left-header">
                <BreadcrumbHeader :pageName="detailInfo.name" />
                <ApplyStatus status="applying" v-if="pageFrom === 'myApply'" />
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
                    <el-button plain. @click="handleOnline">上架应用</el-button>
                </div>
            </div>
            <!-- 应用中心-我的申请的详情 -->
            <div v-if="pageFrom === 'myApply'">
                <div v-if="mockApplyStatus === 'success'">
                    <el-button type="danger">
                        <Popover
                            :show="mockApplyStatus === 'success'"
                            title="您确定要解绑当前服务吗？"
                            subTitle="解绑后，当前服务将从当前列表移除，如需使用需重新申请。"
                            :okClick="confirmUnbind"
                            referenceText="解绑应用"
                        />
                    </el-button>
                    <el-button plain @click="toConfigService">配置服务</el-button>
                </div>
                <div v-if="mockApplyStatus === 'applying'">
                    <el-button plain>取消申请</el-button>
                </div>
                <div v-if="mockApplyStatus === 'cancel' || mockApplyStatus === 'reject'">
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
                            <el-button plain>删除</el-button>
                        </template>
                    </el-popconfirm>
                    <el-button plain>重新申请</el-button>
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
                    <a class="link-url" href="{{detailInfo.codePackagePath}}" style="color: rgba(22, 119, 255, 1)">
                        <el-link type="primary" :icon="Link">{{ detailInfo.code }}</el-link>
                    </a>
                </el-col>
            </el-row>
        </div>
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

    <ConfigServiceModal :modalVisible="modalVisible" :cancelModal="cancelModal" />
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
import $application, { ApplicationDetail } from '@/plugins/application'
import { Link } from '@element-plus/icons-vue'
import Popover from '@/views/components/Popover.vue'
import ConfigServiceModal from '@/views/components/ConfigServiceModal.vue'
import { exportIdentityInfo } from '@/plugins/account'
import { getCurrentAccount } from '@/plugins/auth'
import { notifyError } from '@/utils/message'
import $audit, { AuditAuditMetadata } from '@/plugins/audit'
import { generateUuid, getCurrentUtcString } from '@/utils/common'
const route = useRoute()
const router = useRouter()
const urlQuery = ref({})
const detailInfo = ref<ApplicationDetail>({
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
const { id = '', pageFrom = '' } = route.query || {}
const innerVisible = ref(false)
const modalVisible = ref(false)

/**
 * 应用是否上架
 * 我创建的-详情页需要展示这个字段，且右上角按钮也会跟着这个状态联动
 */
const isOnline = ref(true) // 是否已经上架

/**
 * 申请应用的状态
 * 我申请的-详情页需要展示这个字段，且右上角按钮也会跟着这个状态联动
 */
const mockApplyStatus = ref('success')

/**
 * 进入详情页的时候，需要查询详情接口
 */
const detail = async () => {
    if (pageFrom === 'myCreate') {
        /**
         * 应用中心：我创建的-详情接口
         */
        const detailRst = await $application.myCreateDetailByUid(route.query.uid)
        detailInfo.value = detailRst || {}
        isOnline.value = false
    } else {
        /**
         * 我申请的详情接口
         * 应用市场详情接口
         */
        const detailRst = await $application.queryByUid(route.query.uid)
        detailInfo.value = detailRst || {}
    }
}

/**
  我创建的tab-详情页-导出身份
 */
const exportIdentity = async () => {
    if (pageFrom === 'myCreate') {
        const detailRst = await $application.myCreateDetailByUid(route.query.uid)
        await exportIdentityInfo(detailRst.did, detailRst.ownerName)
    } else if (pageFrom === 'market') {
        const detailRst = await $application.queryByUid(route.query.uid)
        await exportIdentityInfo(detailRst.did, detailRst.ownerName)
    }
}

/**
 * 删除接口
 */
const toDelete = async () => {
    if (pageFrom === 'myCreate') {
        await $application.myCreateDelete(route.query.uid)
    } else if (pageFrom === 'myApply') {
        await $application.myApplyDelete(route.query.uid)
    } else if (pageFrom === 'market') {
        console.log(`下架应用`)
        const app = await $application.queryByUid(route.query.uid)
        await $application.offline(app.did, app.version)
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
    // console.log(urlQuery.value.did, '-urlQuery-')
    // router.push({
    //     path: '/market/apply-edit',
    //     query: {
    //         did: did,
    //         version: version
    //     }
    // })
}

const toConfigService = () => {
    modalVisible.value = true
}

const cancelModal = () => {
    modalVisible.value = false
}

const confirmUnbind = async () => {
    // 执行解绑逻辑
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
            /**
             * 创建上架申请
             * innerVisible.value = true 是上架成功后，打开一个弹窗提示用户上架成功了
             */
            const detailRst = await $application.myCreateDetailByUid(route.query.uid)
            // 重复申请检查
            const account = getCurrentAccount()
            if (account === undefined || account === null) {
                notifyError("❌未查询到当前账户，请登录")
                return
            }
            const applicant = `${account}::${account}`
            const approver = import.meta.env.VITE_APPLICANT
            let searchList = await $audit.search({name: detailRst.name})
            searchList = searchList.filter((a) => a.meta.applicant === applicant && a.meta.appOrServiceMetadata.includes(`"operateType":"application"`))
            if (searchList.length > 0) {
                ElMessageBox.alert('您已申请，无需重复申请', '提示')
                .then(() => {
                })
                .catch(() => {
                });
                return
            }
            detailRst.operateType = 'application'
            const meta: AuditAuditMetadata = {
                uid: generateUuid(),
                appOrServiceMetadata: JSON.stringify(detailRst),
                auditType: 'application',
                applicant: applicant, // 申请人身份，did::name
                approver: approver,
                reason: '上架申请',
                createdAt: getCurrentUtcString(),
                updatedAt: getCurrentUtcString(),
                signature: 'mock'
            }
            const status = await $audit.create(meta)
            if (status.code === "OK") {
                innerVisible.value = true
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
    urlQuery.value = route.query
    detail()
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
