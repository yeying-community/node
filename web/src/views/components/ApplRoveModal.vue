<template>
    <el-dialog
        v-model="props.applroveShow"
        :title="props.title || '审批'"
        width="860px"
        :close-on-click-modal="false"
        @close="props.closeClick()"
    >
        <div class="approval-modal">
            <div class="preview">
                <div class="block-title">申请预览</div>
                <el-skeleton v-if="loading" :rows="6" animated />
                <AuditSummaryPanel v-else-if="auditDetail" :audit="auditDetail" embedded />
                <el-empty v-else description="未加载到申请详情" :image-size="72" />
            </div>

            <div class="editor">
                <div class="block-title">审批操作</div>
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
                            :rows="6"
                            v-model="form.opinion"
                            placeholder="请填写审批意见，申请人会在审批轨迹中看到这条记录"
                        />
                    </el-form-item>
                </el-form>
            </div>
        </div>

        <template #footer>
            <span class="dialog-footer">
                <el-button @click="props.closeClick()">取消</el-button>
                <el-button type="primary" @click="submitForm"> 确定 </el-button>
            </span>
        </template>
    </el-dialog>
</template>

<script lang="ts" setup>
import $audit, { AuditCommentStatusEnum } from '@/plugins/audit'
import type { AuditAuditDetail } from '@/plugins/audit'
import AuditSummaryPanel from './AuditSummaryPanel.vue'
import { ElForm } from 'element-plus';
import { ElMessage } from 'element-plus';
import { ref, reactive, watch } from 'vue'
import { notifyError } from '@/utils/message';
const formRef = ref<InstanceType<typeof ElForm> | null>(null);
const loading = ref(false)
const auditDetail = ref<AuditAuditDetail | null>(null)
const form = reactive({
    result: 'passed',
    opinion: ''
})

const rules = reactive({
    result: [{ required: true, message: '请选择审批结果', trigger: 'blur' }]
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
        notifyError(`获取申请详情失败: ${error instanceof Error ? error.message : String(error)}`)
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
        ElMessage.error('请先选择审批结果')
        return false
    }
    if (!auditDetail.value) {
        notifyError('申请详情尚未加载完成')
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
                    ElMessage.success('审批通过')
                } catch (e) {
                    notifyError(`审批失败: ${e}`)
                }
            } else if (applyResult === 'reject') {
                try {
                    await $audit.reject({
                        auditId: props.uid,
                        text: applyOpinion,
                        status: AuditCommentStatusEnum.COMMENTSTATUSREJECT
                    })
                    ElMessage.success('已驳回')
                } catch (e) {
                    notifyError(`审批失败: ${e}`)
                }
            }
            resetForm()
            props.afterSubmit?.()
            props.closeClick?.()
        } else {
            notifyError('请先选择审批结果')
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
