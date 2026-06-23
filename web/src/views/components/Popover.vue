<template>
  <el-popover v-model:visible="visible" placement="top" :width="300" trigger="click">
    <div class="custom-popover-content">
      <el-space :size="8" alignment="flex-start">
        <el-icon :size="16" class="text-warning">
          <WarningFilled />
        </el-icon>
        <el-space :size="8" direction="vertical" alignment="flex-start">
          <span class="title">{{ title }}</span>
          <span class="sub-title">{{ subTitle }}</span>
        </el-space>
      </el-space>

      <div class="flex justify-end mt-4">
        <el-button size="small" @click="handleCancel">{{
          cancelText || $t('popover_default_cancel')
        }}</el-button>
        <el-button size="small" type="primary" @click="handleOk">{{
          okText || $t('popover_default_ok')
        }}</el-button>
      </div>
    </div>
    <template #reference>
      <div v-if="props.show">
        <div v-if="$slots.btn" @click="visible = true"><slot name="btn" /></div>
        <div v-else class="cursor" @click="visible = true">
          {{ referenceText }}
        </div>
      </div>
    </template>
  </el-popover>
</template>

<script lang="ts" setup>
import { getCurrentInstance, ref } from "vue";
import { WarningFilled } from "@element-plus/icons-vue";
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const props = defineProps({
  show: Boolean,
  title: String,
  subTitle: String,
  okText: String,
  cancelText: String,
  okClick: Function,
  cancelClick: Function,
  referenceText: String,
});
const visible = ref(false);

const handleCancel = () => {
  props.cancelClick?.();
  visible.value = false;
};

const handleOk = async () => {
  await props.okClick?.();
  visible.value = false;
};
</script>
<style scoped lang="less">
.custom-popover-content {
  padding: 0 4px;
}
.text-warning {
  color: #fb9a0e;
  margin-top: 3px;
}
.title {
  color: rgba(0, 0, 0, 0.85);
  font-size: 16px;
  font-weight: 500;
}
.cursor {
  cursor: pointer;
}
</style>
