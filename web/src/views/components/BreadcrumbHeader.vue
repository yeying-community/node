<template>
  <div class="back-wrap">
    <el-icon class="back-icon" @click="goBack" :size="20"><Back /></el-icon
    ><span>{{ pageName }}</span>
  </div>
</template>

<script lang="ts" setup>
import { useRouter } from "vue-router";
import { Back } from "@element-plus/icons-vue";
const router = useRouter();
const goBack = () => {
  router.back();
};
const props = defineProps({
  pageName: String,
});
</script>
<style scoped lang="less">
.back-wrap {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  font-weight: 500;
  font-size: 18px;
  margin: 10px 0 24px;
  color: rgba(0, 0, 0, 0.85);

  .back-icon {
    &:hover {
      color: #409eff;
    }
  }
}
</style>
