<template>
  <el-tag class="ml-2" :type="statusInfo[props.status]?.type">{{
    statusInfo[props.status]?.text
  }}</el-tag>
</template>
<script lang="ts" setup>
const statusInfo = {
  success: {
    type: "success",
    text: "申请通过",
  },
  applying: {
    type: "",
    text: "申请中",
  },
  reject: {
    type: "danger",
    text: "申请驳回",
  },
  cancel: {
    type: "info",
    text: "已取消",
  },
};

const props = defineProps({
  status: String,
});
</script>
