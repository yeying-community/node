<template>
  <div class="layout-background">
    <Header />
    <RouterView />
  </div>
</template>

<script lang="ts" setup>
import Header from '@/components/layout/Header.vue'
</script>

<style scoped>
.layout-background {
  min-height: 100vh;
  background: #f4f7f6;
}
</style>
