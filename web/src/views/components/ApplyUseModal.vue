<template>
  <el-dialog
    v-model="props.dialogVisible"
    :title="props.title || $t('apply_use_title')"
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
        <div>{{ $t('apply_use_resource') }}{{ detail?.name }}</div>
        <div>{{ $t('apply_use_owner') }}{{ detail?.owner }}</div>
        <el-form-item :label="$t('apply_use_reason')" prop="reason">
          <el-input
            type="textarea"
            style="width: 400px"
            v-model="form.reason"
            :placeholder="$t('apply_use_reason_placeholder')"
          ></el-input>
        </el-form-item>
      </el-space>
    </el-form>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="props.closeClick()">{{ $t('btn_cancel') }}</el-button>
        <el-button type="primary" @click="submitForm"> {{ $t('btn_ok') }} </el-button>
      </span>
    </template>
  </el-dialog>

  <ResultChooseModal
    v-model="innerVisible"
    :title="$t('apply_use_title')"
    :mainDesc="$t('apply_use_result_main')"
    :subDesc="$t('apply_use_result_sub')"
    :leftBtnText="$t('apply_use_view_detail')"
    :rightBtnText="$t('apply_use_back_list')"
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
import ResultChooseModal from './ResultChooseModal.vue'
import { computed, getCurrentInstance, ref, reactive } from 'vue'
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
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const submittedAuditId = ref('')
const submittedResourceUid = ref('')

const rules = reactive({
  reason: [{ required: true, message: String($t('apply_use_reason')), trigger: 'blur' }],
})
const props = defineProps({
  dialogVisible: Boolean,
  afterSubmit: Function,
  detail: Object,
  title: String,
  closeClick: Function
})
const resourceLabel = computed(() => String($t('approval_type_application')))

/**
 * 表单提交
 */
const submitForm = () => {
  const account = getCurrentAccount()
  if (account === undefined || account === null) {
      notifyError(String($t('market_missing_account')))
      return
  }
  if (formRef.value === undefined || formRef.value === null) {
    return
  }
  formRef.value.validate(async (valid: boolean) => {
    if (valid) {
        const detailRst = await $application.detail(props.detail?.did, props.detail?.version)
        if (detailRst === undefined || detailRst === null) {
            notifyError(String($t('app_detail_app_missing')))
            return
        }
        const applicant = `${normalizeAddress(account)}::${normalizeAddress(account)}`
        const audits = await $audit.search({ applicant })
        const latestAudit = Array.isArray(audits)
          ? audits
              .filter((audit) =>
                isAuditForResource(audit, {
                  auditType: 'application',
                  reason: 'Request Access',
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
            notifyError(String($t('apply_use_duplicate')))
            return
          }
        }
        detailRst.operateType = 'application'
        const approverActor = normalizeAddress(String(props.detail?.owner || ''))
        if (!approverActor) {
          notifyError(String($t('apply_use_missing_approver')))
          return
        }
        const auditR = await $audit.submitUsageRequest({
          auditType: 'application',
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
      notifyError(String($t('apply_use_reason_required')))
    }
  })
}

const toDetail = () => {
  router.push({
    path: '/market/dev/apply-detail',
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
