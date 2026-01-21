<template>
  <div @click="openContact" class="blue-color cursor-pointer bg-white px-3 py-5 frame fixed right-1.5 sm:right-12 top-1/4">
    <span class="iconfont icon-phone"/>
    <span class="mt-2 text-base font-puhuiRegular">{{$t("common.contactUs")}}</span>
  </div>
</template>

<script lang="ts" setup>
import {ref,getCurrentInstance} from 'vue'
import Contact from '@/components/contact/Modal.vue'
import { useRouter } from 'vue-router'

const open = ref(false)
const RefLogin = ref()
const RefContact = ref()
const { proxy } = getCurrentInstance();
const {$t}=proxy
const router = useRouter();

const openContact = async () => {
  open.value = true
  RefContact.value.openModal()
}
const close = () => {
    open.value = false
}
</script>
<style scoped>
.frame{
  writing-mode: vertical-lr;
  box-shadow: 0px 0px 8px -2px;
}
</style>
