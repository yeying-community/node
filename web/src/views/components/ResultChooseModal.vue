<template>
    <el-dialog
        v-model="props.modelValue"
        :title="title"
        width="430px"
        :close-on-click-modal="false"
        @close="props.closeClick()"
        :close-icon="props.closeIconHidden ? 'null' : null"
    >
        <el-space size="24" direction="vertical" alignment="center" style="width: 100%">
            <div v-if="$slots.icon"><slot name="icon" /></div>

            <el-space size="8" direction="vertical" alignment="center" style="width: 100%; margin-bottom: 8px">
                <div class="status-desc">{{ mainDesc }}</div>
                <div class="waring-text">
                    {{ subDesc }}
                </div>
            </el-space>

            <el-space size="8" direction="horizontal" alignment="center" style="width: 100%; margin-bottom: 8px">
                <el-button v-if="props.leftBtnText" :type="leftBtnType || 'primary'" @click="props.leftBtnClick">
                    {{ leftBtnText }}
                </el-button>
                <el-button :type="rightBtnType || 'default'" @click="rightBtnClick">
                    {{ rightBtnText }}
                </el-button>
            </el-space>
        </el-space>
    </el-dialog>
</template>

<script lang="ts" setup>
const props = defineProps({
    modelValue: {
        type: Boolean,
        default: false
    },
    title: {
        type: String,
        default: '提示'
    },
    closeIconHidden: {
        type: Boolean,
        default: false
    },
    mainDesc: {
        type: String,
        default: '应用申请中'
    },
    subDesc: {
        type: String,
        default: '正在等待服务所有人审批，请耐心等待'
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
        default: '返回列表'
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

const emits = defineEmits(['update:modelValue'])

// const closeDialog = () => {

//   emits("update:modelValue", false);
// };
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
