<script lang="ts" setup>
import { getCurrentInstance } from 'vue'

const { proxy } = getCurrentInstance()!
const { $t } = proxy
</script>

<template>
  <div class="welcome">
    {{ $t('welcome_title') }}
  </div>
</template>

<style scoped lang="less">
.welcome {
  font-size: 16px;
  line-height: 1.6;
  font-weight: 400;
  color: rgba(0, 0, 0, 0.82);
}
</style>
