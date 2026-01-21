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
import { userInfo } from '@/plugins/account'
import $audit, { AuditAuditMetadata } from '@/plugins/audit'
import $application from '@/plugins/application'
import $service from '@/plugins/service'
import ResultChooseModal from './ResultChooseModal.vue'
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { SuccessFilled } from '@element-plus/icons-vue'
import { notifyError } from '@/utils/message'
import { v4 as uuidv4 } from 'uuid';
import { generateUuid, getCurrentUtcString } from '@/utils/common'
import { ElMessageBox } from 'element-plus'
import { getCurrentAccount } from '@/plugins/auth'

const mainMsg = ref<string>()
const innerVisible = ref(false)
const formRef = ref(null)
const form = reactive({
  reason: '',
})
const router = useRouter()

const emits = defineEmits(['update:dialogVisible'])

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

          const r = await $application.myApplyList(account)
          const names: string[] = r.map((d) => d.name)
          if (names.includes(detailRst.name)) {
            notifyError("❌申请使用已经提交，请勿重复操作")
            return
          }
        } else if (props.operateType === `service`) {
          detailRst = await $service.detail(props.detail?.did, props.detail?.version)
          if (detailRst === undefined || detailRst === null) {
              notifyError("❌服务不存在")
              return
          }

          const r = await $service.myApplyList(account)
          const names: string[] = r.map((d) => d.name)
          if (names.includes(detailRst.name)) {
            notifyError("❌申请使用已经提交，请勿重复操作")
            return
          }
        }
        const applicant = `${account}::${account}`
        const approver = `${props.detail?.owner}::${props.detail?.ownerName}`
        const auditUid = generateUuid()
        detailRst.operateType = props.operateType
        const meta: AuditAuditMetadata = {
            uid: auditUid,
            appOrServiceMetadata: JSON.stringify(detailRst),
            auditType: '',
            applicant: applicant, // 申请人身份，did::name
            approver: approver,
            reason: '申请使用',
            createdAt: getCurrentUtcString(),
            updatedAt: getCurrentUtcString(),
            signature: 'xxx'
        }
        if (props.operateType === `application`) {
          meta.auditType = 'application'
        } else if (props.operateType === `service`) {
          meta.auditType = 'service'
        }
        const auditR = await $audit.create(meta)
        props.closeClick()
        try {
          const rs = await $audit.detail(auditUid)
          const appOrService = JSON.parse(rs.meta.appOrServiceMetadata)
          if (props.operateType === `application`) {
            const detailRstApp = await $application.detail(appOrService.did, appOrService.version)
            if (detailRstApp === undefined || detailRstApp === null) {
                notifyError("❌应用不存在")
                return
            }
            detailRstApp.applyOwner = account
            detailRstApp.uid = uuidv4()
            const r = await $application.myApplyCreate(detailRstApp)
          } else if (props.operateType === `service`) {
            const detailRstService = await $service.detail(appOrService.did, appOrService.version)
            if (detailRstService === undefined || detailRstService === null) {
                notifyError("❌服务不存在")
                return
            }
            detailRstService.applyOwner = account
            detailRstService.uid = uuidv4()
            const r = await $service.myApplyCreate(detailRstService)
            innerVisible.value = true
          }
        } catch (e) {
            notifyError(`❌创建申请的应用/服务异常，error=${e}`)
        }
    } else {
      notifyError('❌请先填写申请原因')
    }
  })
}

const toDetail = () => {
  router.push({
    path: '/market/apply-detail',
    query: {
      did: props.detail?.did,
      version: props.detail?.version,
    },
  })
}

const toList = () => {
  innerVisible.value = false
}
</script>
