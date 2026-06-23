<template>
    <div class="header h-14 p-4 border-b flex justify-between">
        <div class="flex">
            <img class="w-24 h-6 pr-4 border-r" src="../../assets/img/logo.svg"/>
            <span class="text-base opacity-85 font-medium pl-4">{{ $t('user_menu_center') }}</span>
        </div>
        <div class="hidden lg:flex">
            <Language/>
            <UserMenu/>
        </div>
        <div class="flex lg:hidden">
            <button type="button" class="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700" @click="openSlide">
              <span class="sr-only">打开主菜单</span>
              <span class="iconfont icon-horizon scale-125"/>
              <!-- <Bars3Icon class="size-6" aria-hidden="true" /> -->
            </button>
          </div>
    </div>
</template>
<script lang="ts" setup>
import { getCurrentInstance } from 'vue'
import Language from '@/components/common/Language.vue'
import UserMenu from '@/components/common/UserMenu.vue'
import {useProfileStore} from '@/stores/index'
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const profileStore = useProfileStore()
const openSlide = () => {
    profileStore.changeSlide(true)
}
</script>
<style scoped>
</style>
