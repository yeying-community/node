<template>
  <el-dialog
    v-model="props.dialogVisible"
    :title="props.title || '申请使用'"
    width="430px"
    :close-on-click-modal="false"
    @close="props.closeClick()"
  >
    <el-form
      label-position="top"
      :model="form"
      :rules="rules"
      ref="formRef"
      label-width="100px"
    >
      <el-space direction="vertical" alignment="flex-start">
        <div>申请应用/服务：{{ detail?.name }}</div>
        <div>应用创建人：{{ detail?.owner }}</div>
        <el-form-item label="申请原因" prop="reason">
          <el-input
            type="textarea"
            style="width: 400px"
            v-model="form.reason"
            placeholder="请填写申请原因，以便所有者知悉增加通过概率"
          ></el-input>
        </el-form-item>
      </el-space>
    </el-form>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="props.closeClick()">取消</el-button>
        <el-button type="primary" @click="submitForm"> 确定 </el-button>
      </span>
    </template>
  </el-dialog>

  <ResultChooseModal
    v-model="innerVisible"
    title="申请使用"
    mainDesc="应用/服务申请中,请联系应用/服务 owner 审批"
    subDesc="正在等待应用/服务所有人审批，请耐心等待"
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
import $audit, {
  isAuditForResource,
  resolveUsageAuditStatus
} from '@/plugins/audit'
import $application from '@/plugins/application'
import $service from '@/plugins/service'
import ResultChooseModal from './ResultChooseModal.vue'
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { SuccessFilled } from '@element-plus/icons-vue'
import { notifyError } from '@/utils/message'
import { getCurrentAccount } from '@/plugins/auth'
import { normalizeAddress } from '@/utils/actionSignature'

const innerVisible = ref(false)
const formRef = ref(null)
const form = reactive({
  reason: '',
})
const router = useRouter()
const submittedAuditId = ref('')
const submittedResourceUid = ref('')

const rules = reactive({
  reason: [{ required: true, message: '请输入申请原因', trigger: 'blur' }],
})
const props = defineProps({
  dialogVisible: Boolean,
  afterSubmit: Function,
  detail: Object,
  title: String,
  closeClick: Function,
  operateType: String
})

/**
 * 表单提交
 */
const submitForm = () => {
  const account = getCurrentAccount()
  if (account === undefined || account === null) {
      notifyError("❌未查询到当前账户，请登录")
      return
  }
  if (formRef.value === undefined || formRef.value === null) {
    return
  }
  formRef.value.validate(async (valid: boolean) => {
    if (valid) {
        let detailRst = null
        if (props.operateType === `application`) {
          detailRst = await $application.detail(props.detail?.did, props.detail?.version)
          if (detailRst === undefined || detailRst === null) {
              notifyError("应用不存在")
              return
          }
        } else if (props.operateType === `service`) {
          detailRst = await $service.detail(props.detail?.did, props.detail?.version)
          if (detailRst === undefined || detailRst === null) {
              notifyError("❌服务不存在")
              return
          }
        }
        const applicant = `${normalizeAddress(account)}::${normalizeAddress(account)}`
        const audits = await $audit.search({ applicant })
        const latestAudit = Array.isArray(audits)
          ? audits
              .filter((audit) =>
                isAuditForResource(audit, {
                  auditType: props.operateType as 'application' | 'service',
                  reason: '申请使用',
                  uid: detailRst.uid,
                  did: detailRst.did,
                  version: detailRst.version,
                  name: detailRst.name
                })
              )
              .sort((left, right) => {
                const leftTime = left.meta?.createdAt ? Date.parse(left.meta.createdAt) : 0
                const rightTime = right.meta?.createdAt ? Date.parse(right.meta.createdAt) : 0
                return rightTime - leftTime
              })[0]
          : undefined
        if (latestAudit) {
          const latestStatus = resolveUsageAuditStatus(latestAudit)
          if (latestStatus === 'applying' || latestStatus === 'success') {
            notifyError("❌申请使用已经提交，请勿重复操作")
            return
          }
        }
        detailRst.operateType = props.operateType
        const approverActor = normalizeAddress(String(props.detail?.owner || ''))
        if (!approverActor) {
          notifyError('❌缺少审批人')
          return
        }
        const auditR = await $audit.submitUsageRequest({
          auditType: props.operateType as 'application' | 'service',
          resource: detailRst as Record<string, unknown>,
          approver: `${approverActor}::${String(props.detail?.ownerName || approverActor)}`
        })
        if (!auditR?.meta?.uid) {
          return
        }
        submittedAuditId.value = auditR.meta.uid || ''
        submittedResourceUid.value = String(detailRst.uid || props.detail?.uid || '')
        props.closeClick?.()
        innerVisible.value = true
    } else {
      notifyError('❌请先填写申请原因')
    }
  })
}

const toDetail = () => {
  router.push({
    path: props.operateType === 'service' ? '/market/service-detail' : '/market/apply-detail',
    query: {
      uid: submittedResourceUid.value || props.detail?.uid,
      pageFrom: 'myApply',
      auditId: submittedAuditId.value || props.detail?.applyAuditId,
    },
  })
}

const toList = () => {
  innerVisible.value = false
}
</script>
