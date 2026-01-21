<template>
    <el-dialog
        v-model="props.applroveShow"
        :title="props.title || '审批'"
        width="430px"
        :close-on-click-modal="false"
        @close="props.closeClick()"
    >
        <el-form label-position="top" :model="form" :rules="rules" ref="formRef" label-width="100px">
            <el-form-item label="审批结果" prop="result">
                <el-radio-group v-model="form.result" class="ml-4">
                    <el-radio label="passed" size="large">通过</el-radio>
                    <el-radio label="reject" size="large">驳回</el-radio>
                </el-radio-group>
            </el-form-item>
            <el-form-item label="审批意见" prop="opinion">
                <el-input
                    type="textarea"
                    style="width: 400px"
                    v-model="form.opinion"
                    placeholder="请填写申请原因，以便所有者知悉增加通过概率"
                ></el-input>
            </el-form-item>
        </el-form>

        <template #footer>
            <span class="dialog-footer">
                <el-button @click="props.closeClick()">取消</el-button>
                <el-button type="primary" @click="submitForm"> 确定 </el-button>
            </span>
        </template>
    </el-dialog>
</template>

<script lang="ts" setup>
import { userInfo } from '@/plugins/account'
import $audit, { AuditAuditDetail, AuditCommentMetadata, AuditCommentStatusEnum } from '@/plugins/audit'
import { generateUuid, getCurrentUtcString } from '@/utils/common';
import { ElForm } from 'element-plus';
import { ElMessage } from 'element-plus';
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import $application, { ApplicationMetadata } from '@/plugins/application'
import $service from '@/plugins/service'
import { notifyError } from '@/utils/message';
import { v4 as uuidv4 } from 'uuid';
import { AuditDetailBox, useDataStore } from '@/stores/audit'
import { getCurrentAccount } from '@/plugins/auth';

const store = useDataStore()
const formRef = ref<InstanceType<typeof ElForm> | null>(null);
const form = reactive({
    result: 'passed',
    opinion: ''
})
const router = useRouter()

const emits = defineEmits(['update:applroveShow'])

const rules = reactive({
    result: [{ required: true, message: '请选择审批结果', trigger: 'blur' }]
})
const props = defineProps({
    applroveShow: Boolean,
    afterSubmit: Function,
    uid: String,
    closeClick: Function
})


function allEqualTo<T>(arr: T[], value: T): boolean {
  return arr.every(item => item === value);
}

function getState(metas?: AuditCommentMetadata[]) {
  let status: string = "待审批";
  if (metas === undefined || metas.length === 0) {
    return status;
  }

  // 过滤掉 status 为 undefined 的项
  const statusList: AuditCommentStatusEnum[] = metas
    .map(item => item.status)
    .filter((status): status is AuditCommentStatusEnum => status !== undefined);

  if (statusList.length === 0) {
    return status; // 如果没有有效状态，仍为“待审批”
  }

  if (statusList.includes(AuditCommentStatusEnum.COMMENTSTATUSREJECT)) {
    status = '审批驳回';
  } else if (allEqualTo(statusList, AuditCommentStatusEnum.COMMENTSTATUSAGREE)) {
    status = '审批通过';
  }

  return status;
}

function cvData(auditMyApply: AuditAuditDetail) {
    if (auditMyApply === undefined || auditMyApply.meta === undefined || auditMyApply.meta.appOrServiceMetadata === undefined || auditMyApply.meta.applicant === undefined) {
        return null
    }
    const rawData = JSON.parse(auditMyApply.meta.appOrServiceMetadata);
    const did = auditMyApply.meta.applicant.split('::')[0]

    const metadata: AuditDetailBox = {
        uid: auditMyApply.meta.uid,
        name: rawData.name,
        desc: rawData.description,
        serviceType: rawData.code,
        applicantor: did,
        state: getState(auditMyApply.commentMeta),
        date: auditMyApply.meta.createdAt
    };
    return metadata
 
}

function convertApplicationMetadata(auditMyApply: AuditAuditDetail[]) {
  return auditMyApply
    .map(cvData)
    .filter((item): item is AuditDetailBox => item !== null) // ✅ 过滤 null 并类型收窄
}

const tableData = ref<AuditDetailBox[]>([])

const searchWaitApply = async () => {
    const account = getCurrentAccount()
    if (account === undefined || account === null) {
        notifyError("❌未查询到当前账户，请登录")
        return
    }
    const approver = `${account}::${account}`
    const auditMyApply: AuditAuditDetail[] = await $audit.search({approver: approver})

    let res: AuditDetailBox[] = convertApplicationMetadata(auditMyApply)
    res = res.filter((s) => s.state === '待审批')
    if (Array.isArray(res)) {
        tableData.value = res
        store.setItems(tableData.value)
    } else {
        console.warn('Expected array, but got:', res)
        tableData.value = []
        store.setItems(tableData.value)
    }
}

/**
 * 表单提交
 */
const submitForm = () => {
    if (formRef.value === undefined || formRef.value === null) {
        ElMessage.error('请先选择审批结果')
        return false
    }
    formRef.value.validate(async (valid: boolean) => {
        if (valid) {
            const applyResult = form.result
            const applyOpinion = form.opinion
            if (applyResult === 'passed') {
                try {
                    const param = {
                        uid: generateUuid(),
                        auditId: props.uid,
                        text: applyOpinion,
                        status: AuditCommentStatusEnum.COMMENTSTATUSAGREE,
                        createdAt: getCurrentUtcString(),
                        updatedAt: getCurrentUtcString(),
                        signature: ''
                    }
                    const r: AuditCommentMetadata = await $audit.passed(param)
                    const reasonRes = await $audit.detail(props.uid as string)
                    const rs = await $audit.detail(props.uid as string)
                    const appOrService = JSON.parse(rs.meta.appOrServiceMetadata)
                    if (reasonRes.meta.reason === '上架申请') {
                        if (appOrService.operateType === 'application') {
                            // 创建应用上线记录
                            const app = await $application.online(appOrService)
                        } else if (appOrService.operateType === 'service') {
                            // 创建服务上线记录
                            const service = await $service.online(appOrService)
                        }
        
                    }
                } catch (e) {
                    console.log(e)
                }
            } else if (applyResult === 'reject') {
                try {
                    const param = {
                        uid: generateUuid(),
                        auditId: props.uid,
                        text: applyOpinion,
                        status: AuditCommentStatusEnum.COMMENTSTATUSREJECT,
                        createdAt: getCurrentUtcString(),
                        updatedAt: getCurrentUtcString(),
                        signature: ''
                    }
                    const r: AuditCommentMetadata = await $audit.reject(param)
                } catch (e) {
                    console.log(e)
                }
            }
            searchWaitApply()
            props.closeClick()
        } else {
            notifyError('请先选择审批结果')
        }
    })
}
</script>
