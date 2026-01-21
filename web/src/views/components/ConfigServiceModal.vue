<template>
    <el-dialog
        v-model="props.modalVisible"
        title="配置服务"
        width="430px"
        :close-on-click-modal="false"
        @close="props.cancelModal()"
    >
        <div class="case-label">配置服务实例：</div>
        <el-form ref="formRef" :model="dynamicValidateForm" label-width="120px" class="demo-dynamic">
            <el-row class="part-row" :gutter="8" style="margin-bottom: 8px">
                <el-col :span="8" :xs="24">服务代号</el-col>
                <el-col :span="16" :xs="24">服务实例</el-col>
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
                            <el-select v-model="domain.value" placeholder="请选择" />
                        </el-form-item>
                    </el-col>
                    <el-col :span="15" :xs="24">
                        <el-form-item label="" :prop="`domains[${index}].case`" :rules="rules.case" class="inline-item">
                            <el-input v-model="domain.case" placeholder="请输入" />
                        </el-form-item>
                    </el-col>

                    <el-col :span="1" :xs="24" v-if="dynamicValidateForm.domains.length > 1">
                        <el-icon @click.prevent="removeDomain(domain)" style="margin-top: 8px; cursor: pointer"
                            ><Delete
                        /></el-icon>
                    </el-col>
                </el-row>
            </div>

            <el-form-item>
                <el-button @click="addDomain" :icon="Plus" class="addBtn">添加服务实例</el-button>
            </el-form-item>
        </el-form>
        <template #footer>
            <span class="dialog-footer">
                <el-button @click="props.cancelModal()">取消</el-button>
                <el-button type="primary" @click="submitForm(formRef)"> 确定 </el-button>
            </span>
        </template>
    </el-dialog>
</template>

<script lang="ts" setup>
import { reactive, ref } from 'vue'
import type { FormInstance } from 'element-plus'
const props = defineProps({
    modalVisible: Boolean,
    detail: Object,
    title: String,
    cancelModal: Function
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
    // 服务代号（value）的验证规则
    value: [
        { required: true, message: '服务代号不能为空', trigger: 'blur' },
        { min: 2, max: 10, message: '服务代号长度在 2-10 之间', trigger: 'blur' }
    ],
    // 服务实例（case）的验证规则
    case: [
        { required: true, message: '服务实例不能为空', trigger: 'blur' },
        {
            pattern: /^[a-zA-Z0-9_]+$/,
            message: '只能包含字母、数字和下划线',
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
        if (valid) {
            console.log('submit!', dynamicValidateForm.domains?.[0])
        } else {
            console.log('error submit!')
            return false
        }
    })
}

const resetForm = (formEl: FormInstance | undefined) => {
    if (!formEl) return
    formEl.resetFields()
}
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
