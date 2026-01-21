<template>
  <div class="layout_bg">
    <Header/>
    <RouterView />
  </div>
</template>

<script lang="ts" setup>
import Header from '@/components/layout/Header.vue'
</script> 
<style scoped>
.layout_bg{
  background:url('../../assets/img/bg.jpg') white 0px 0px / 100% 100% no-repeat;
  background-size:100% 50%; 
}
</style>