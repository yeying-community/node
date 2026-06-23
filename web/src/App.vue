<script lang="ts" setup>
import { computed } from 'vue'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import en from 'element-plus/dist/locale/en.mjs'
import { RouterView } from 'vue-router'
import { getLocaleRef } from '@/lang/locale'

const locale = getLocaleRef()
const elementLocale = computed(() => (locale.value === 'en-US' ? en : zhCn))
</script>

<template>
  <el-config-provider :locale="elementLocale">
    <router-view :key="locale" />
  </el-config-provider>
</template>

<style scoped>

</style>
