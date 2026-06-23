<template>
    <el-dialog
        v-model="props.modalVisible"
        :title="$t('config_capability_title')"
        width="430px"
        :close-on-click-modal="false"
        @close="props.cancelModal()"
    >
        <div class="case-label">{{ $t('config_capability_instance_label') }}</div>
        <el-form ref="formRef" :model="dynamicValidateForm" label-width="120px" class="demo-dynamic">
            <el-row class="part-row" :gutter="8" style="margin-bottom: 8px">
                <el-col :span="8" :xs="24">{{ $t('config_capability_code') }}</el-col>
                <el-col :span="16" :xs="24">{{ $t('config_capability_case') }}</el-col>
            </el-row>

            <div v-for="(domain, index) in dynamicValidateForm.domains" :key="domain.key">
                <el-row class="part-row" :gutter="8">
                    <el-col :span="8" :xs="24">
                        <el-form-item
                            label=""
                            :prop="`domains[${index}].value`"
                            :rules="rules.value"
                            class="inline-item"
                        >
                        <el-select v-model="domain.value" :placeholder="$t('ph_select')">
                            <el-option
                                v-for="(label, value) in serviceCodeOptions"
                                :key="value"
                                :label="label"
                                :value="value"
                            />
                        </el-select>
                        </el-form-item>
                    </el-col>
                    <el-col :span="15" :xs="24">
                        <el-form-item label="" :prop="`domains[${index}].case`" :rules="rules.case" class="inline-item">
                            <el-input v-model="domain.case" :placeholder="$t('ph_input')" />
                        </el-form-item>
                    </el-col>

                    <el-col :span="1" :xs="24" v-if="dynamicValidateForm.domains.length > 1">
                        <el-icon @click.prevent="removeDomain(domain)" style="margin-top: 8px; cursor: pointer"
                            ><DeleteIcon
                        /></el-icon>
                    </el-col>
                </el-row>
            </div>

            <el-form-item>
                <el-button @click="addDomain" :icon="PlusIcon" class="addBtn">{{ $t('config_capability_add') }}</el-button>
            </el-form-item>
        </el-form>
        <template #footer>
            <span class="dialog-footer">
                <el-button @click="props.cancelModal()">{{ $t('btn_cancel') }}</el-button>
                <el-button type="primary" @click="submitForm(formRef)"> {{ $t('btn_ok') }} </el-button>
            </span>
        </template>
    </el-dialog>
</template>

<script lang="ts" setup>
import { reactive, ref, watch, computed, getCurrentInstance } from 'vue'
import type { FormInstance } from 'element-plus'
import { ElMessage } from 'element-plus'
import { Delete as DeleteIcon, Plus as PlusIcon } from '@element-plus/icons-vue'
import $application, { type ApplicationConfigItem } from '@/plugins/application'
const props = defineProps({
    modalVisible: Boolean,
    detail: Object,
    title: String,
    cancelModal: Function
})
const { proxy } = getCurrentInstance()!
const { $t } = proxy

const serviceCodeOptions = computed(() => {
    const codes = Array.isArray(props.detail?.serviceCodes)
        ? props.detail?.serviceCodes
        : typeof props.detail?.serviceCodes === 'string'
          ? props.detail?.serviceCodes.split(',').map((item) => item.trim()).filter(Boolean)
          : []
    const options: Record<string, string> = {}
    for (const code of codes) {
        options[code] = code
    }
    return options
})

const formRef = ref<FormInstance>()
const dynamicValidateForm = reactive<{
    domains: DomainItem[]
}>({
    domains: [
        {
            key: 1,
            value: '',
            case: ''
        }
    ]
})

interface DomainItem {
    key: number
    value: string
    case: string
}

// 定义验证规则（单独声明，方便维护）
const rules = reactive({
    // 能力代号（value）的验证规则
    value: [
        { required: true, message: String($t('config_capability_code_required')), trigger: 'blur' },
        { min: 2, max: 32, message: String($t('config_capability_code_length')), trigger: 'blur' }
    ],
    // 实例标识（case）的验证规则
    case: [
        { required: true, message: String($t('config_capability_case_required')), trigger: 'blur' },
        {
            pattern: /^[a-zA-Z0-9_]+$/,
            message: String($t('config_capability_case_pattern')),
            trigger: 'blur'
        }
    ]
})
const removeDomain = (item: DomainItem) => {
    const index = dynamicValidateForm.domains.indexOf(item)
    if (index !== -1) {
        dynamicValidateForm.domains.splice(index, 1)
    }
}

const addDomain = () => {
    dynamicValidateForm.domains.push({
        key: Date.now(),
        value: '',
        case: ''
    })
}

const submitForm = (formEl: FormInstance | undefined) => {
    if (!formEl) return
    formEl.validate((valid) => {
        if (!valid) {
            return false
        }
        void (async () => {
            if (!props.detail?.uid) {
                ElMessage.error(String($t('config_capability_missing_app')))
                return
            }
            const configItems = dynamicValidateForm.domains
                .map((item) => ({
                    code: item.value,
                    instance: item.case
                }))
                .filter((item) => item.code && item.instance)
            await $application.saveConfig(props.detail.uid, configItems as ApplicationConfigItem[])
            ElMessage.success(String($t('config_capability_save_success')))
            props.cancelModal?.()
        })()
    })
}

const resetForm = (formEl: FormInstance | undefined) => {
    if (!formEl) return
    formEl.resetFields()
}

const loadConfig = async () => {
    if (!props.detail?.uid) {
        return
    }
    const configs = await $application.getConfig(props.detail.uid)
    if (Array.isArray(configs) && configs.length > 0) {
        dynamicValidateForm.domains = configs.map((item, index) => ({
            key: Date.now() + index,
            value: item.code,
            case: item.instance
        }))
    } else {
        dynamicValidateForm.domains = [
            {
                key: Date.now(),
                value: '',
                case: ''
            }
        ]
    }
}

watch(
    () => props.modalVisible,
    (visible) => {
        if (visible) {
            void loadConfig()
        } else {
            resetForm(formRef.value)
        }
    }
)
</script>

<style scoped lang="less">
.case-label {
    margin-bottom: 10px;
    &::before {
        content: '*';
        color: #f56c6c;
    }
}
.demo-dynamic {
    :deep(.el-form-item__label) {
        border: 1px solid blue;
        display: none;
    }
    :deep(.el-form-item__content) {
        margin-left: 0px !important;
    }
}

.addBtn {
    border-style: dashed !important;
    width: 100%;
    margin: 0 auto !important;
}
</style>
