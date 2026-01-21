<template>
  <div class="layout_bg">
    <ProHeader/>
    <Main />
  </div>
</template>

<script lang="ts" setup>
import {ref} from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import ProHeader from '@/components/profile/ProHeader.vue'
import Main from '@/components/profile/Main.vue'

</script>
<style scoped>
.layout_bg{
  background:url('../../assets/img/user_bg.jpg') white 0px 0px / 100% 100% no-repeat;
  background-size:100% 100%; 
}
</style>