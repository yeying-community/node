<template>
  <el-tag class="ml-2" :type="statusInfo[props.status]?.type || 'primary'">{{
    statusInfo[props.status]?.text || '-'
  }}</el-tag>
</template>
<script lang="ts" setup>
import { getCurrentInstance } from 'vue'

const { proxy } = getCurrentInstance()!
const { $t } = proxy

const statusInfo = {
  success: {
    type: "success",
    text: String($t('apply_status_success')),
  },
  applying: {
    type: "primary",
    text: String($t('apply_status_applying')),
  },
  reject: {
    type: "danger",
    text: String($t('apply_status_reject')),
  },
  cancel: {
    type: "info",
    text: String($t('apply_status_cancel')),
  },
};

const props = defineProps({
  status: String,
});
</script>
