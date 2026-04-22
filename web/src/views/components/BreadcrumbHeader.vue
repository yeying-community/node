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
  gap: 10px;
  font-family: var(--app-font-display);
  font-weight: 500;
  font-size: 18px;
  line-height: 1.3;
  letter-spacing: 0.01em;
  margin: 8px 0 20px;
  color: rgba(0, 0, 0, 0.85);

  .back-icon {
    color: rgba(0, 0, 0, 0.55);
    transition: color 0.2s ease;
    &:hover {
      color: #409eff;
    }
  }
}
</style>
