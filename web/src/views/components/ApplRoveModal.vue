<template>
    <el-dialog
        v-model="props.applroveShow"
        :title="props.title || $t('approval_modal_title')"
        width="860px"
        :close-on-click-modal="false"
        @close="props.closeClick()"
    >
        <div class="approval-modal">
            <div class="preview">
                <div class="block-title">{{ $t('approval_modal_preview') }}</div>
                <el-skeleton v-if="loading" :rows="6" animated />
                <AuditSummaryPanel v-else-if="auditDetail" :audit="auditDetail" embedded />
                <el-empty v-else :description="$t('approval_modal_empty')" :image-size="72" />
            </div>

            <div class="editor">
                <div class="block-title">{{ $t('approval_modal_action') }}</div>
                <el-form label-position="top" :model="form" :rules="rules" ref="formRef" label-width="100px">
                    <el-form-item :label="$t('approval_modal_result')" prop="result">
                        <el-radio-group v-model="form.result" class="ml-4">
                            <el-radio label="passed" size="large">{{ $t('approval_modal_passed') }}</el-radio>
                            <el-radio label="reject" size="large">{{ $t('approval_modal_rejected') }}</el-radio>
                        </el-radio-group>
                    </el-form-item>
                    <el-form-item :label="$t('approval_modal_opinion')" prop="opinion">
                        <el-input
                            type="textarea"
                            :rows="6"
                            v-model="form.opinion"
                            :placeholder="$t('approval_modal_opinion_placeholder')"
                        />
                    </el-form-item>
                </el-form>
            </div>
        </div>

        <template #footer>
            <span class="dialog-footer">
                <el-button @click="props.closeClick()">{{ $t('btn_cancel') }}</el-button>
                <el-button type="primary" @click="submitForm"> {{ $t('btn_ok') }} </el-button>
            </span>
        </template>
    </el-dialog>
</template>

<script lang="ts" setup>
import $audit, { AuditCommentStatusEnum } from '@/plugins/audit'
import type { AuditAuditDetail } from '@/plugins/audit'
import AuditSummaryPanel from './AuditSummaryPanel.vue'
import { ElForm } from 'element-plus';
import { getCurrentInstance, ref, reactive, watch } from 'vue'
import { notifyError, notifySuccess } from '@/utils/message';
const formRef = ref<InstanceType<typeof ElForm> | null>(null);
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const loading = ref(false)
const auditDetail = ref<AuditAuditDetail | null>(null)
const form = reactive({
    result: 'passed',
    opinion: ''
})

const rules = reactive({
    result: [{ required: true, message: String($t('approval_modal_result_required')), trigger: 'blur' }]
})
const props = defineProps({
    applroveShow: Boolean,
    afterSubmit: Function,
    uid: String,
    closeClick: Function,
    title: String
})
const resetForm = () => {
    form.result = 'passed'
    form.opinion = ''
    formRef.value?.clearValidate()
}

const resetDetail = () => {
    auditDetail.value = null
    loading.value = false
}

const loadDetail = async () => {
    const uid = String(props.uid || '').trim()
    if (!uid) {
        resetDetail()
        return
    }
    loading.value = true
    try {
        auditDetail.value = await $audit.detail(uid)
    } catch (error) {
        auditDetail.value = null
        notifyError(`${$t('approval_modal_load_failed')}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
        loading.value = false
    }
}

watch(
    () => [props.applroveShow, props.uid] as const,
    ([visible, uid]) => {
        if (visible && uid) {
            void loadDetail()
            return
        }
        resetDetail()
    },
    { immediate: true }
)

/**
 * 表单提交
 */
const submitForm = () => {
    if (formRef.value === undefined || formRef.value === null) {
        notifyError(String($t('approval_modal_result_required')))
        return false
    }
    if (!auditDetail.value) {
        notifyError(String($t('approval_modal_not_ready')))
        return false
    }
    formRef.value.validate(async (valid: boolean) => {
        if (valid) {
            const applyResult = form.result
            const applyOpinion = form.opinion
            if (applyResult === 'passed') {
                try {
                    await $audit.passed({
                        auditId: props.uid,
                        text: applyOpinion,
                        status: AuditCommentStatusEnum.COMMENTSTATUSAGREE
                    })
                    notifySuccess(String($t('approval_modal_pass_success')))
                } catch (e) {
                    notifyError(`${$t('approval_modal_submit_failed')}：${e}`)
                    return
                }
            } else if (applyResult === 'reject') {
                try {
                    await $audit.reject({
                        auditId: props.uid,
                        text: applyOpinion,
                        status: AuditCommentStatusEnum.COMMENTSTATUSREJECT
                    })
                    notifySuccess(String($t('approval_modal_reject_success')))
                } catch (e) {
                    notifyError(`${$t('approval_modal_submit_failed')}：${e}`)
                    return
                }
            }
            resetForm()
            await props.afterSubmit?.({
                decision: applyResult
            })
        } else {
            notifyError(String($t('approval_modal_result_required')))
        }
    })
}
</script>
<style scoped lang="less">
.approval-modal {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
    gap: 24px;
    align-items: start;
}

.preview,
.editor {
    min-width: 0;
}

.block-title {
    margin-bottom: 12px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
}

@media (max-width: 900px) {
    .approval-modal {
        grid-template-columns: 1fr;
    }
}
</style>
