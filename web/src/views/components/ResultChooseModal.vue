<template>
    <el-dialog
        v-model="props.modelValue"
        :title="dialogTitle"
        width="430px"
        :close-on-click-modal="false"
        @close="props.closeClick()"
        :show-close="!props.closeIconHidden"
    >
        <el-space size="24" direction="vertical" alignment="center" style="width: 100%">
            <div v-if="$slots.icon"><slot name="icon" /></div>

            <el-space size="8" direction="vertical" alignment="center" style="width: 100%; margin-bottom: 8px">
                <div class="status-desc">{{ dialogMainDesc }}</div>
                <div class="waring-text">
                    {{ dialogSubDesc }}
                </div>
            </el-space>

            <el-space size="8" direction="horizontal" alignment="center" style="width: 100%; margin-bottom: 8px">
                <el-button v-if="props.leftBtnText" :type="leftBtnType || 'primary'" @click="props.leftBtnClick">
                    {{ leftBtnText }}
                </el-button>
                <el-button :type="rightBtnType || 'default'" @click="rightBtnClick">
                    {{ dialogRightBtnText }}
                </el-button>
            </el-space>
        </el-space>
    </el-dialog>
</template>

<script lang="ts" setup>
import { computed, getCurrentInstance } from 'vue'
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false
    },
    title: {
        type: String,
        default: ''
    },
    closeIconHidden: {
        type: Boolean,
        default: false
    },
    mainDesc: {
        type: String,
        default: ''
    },
    subDesc: {
        type: String,
        default: ''
    },
    leftBtnType: {
        type: String,
        default: 'primary'
    },
    rightBtnType: {
        type: String,
        default: ''
    },
    leftBtnText: {
        type: String,
        default: ''
    },
    rightBtnText: {
        type: String,
        default: ''
    },
    leftBtnClick: {
        type: Function,
        default: () => {}
    },
    rightBtnClick: {
        type: Function,
        default: () => {}
    },
    closeClick: {
        type: Function,
        default: () => {}
    }
})
const dialogTitle = computed(() => props.title || String($t('result_modal_default_title')))
const dialogMainDesc = computed(() => props.mainDesc || String($t('result_modal_default_main')))
const dialogSubDesc = computed(() => props.subDesc || String($t('result_modal_default_sub')))
const dialogRightBtnText = computed(() => props.rightBtnText || String($t('result_modal_default_right')))
</script>

<style scoped>
.status-desc {
    font-size: 16px;
    font-weight: 500;
    color: #303133;
}

.waring-text {
    font-size: 14px;
    color: #606266;
}
</style>
