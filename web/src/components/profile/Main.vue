<template>
  <div class="content flex">
    <TransitionRoot as="template" :show="sidebarOpen">
      <Dialog class="relative z-50 lg:hidden" @close="changeProfile(false)">
        <TransitionChild as="template" enter="transition-opacity ease-linear duration-300" enter-from="opacity-0" enter-to="opacity-100" leave="transition-opacity ease-linear duration-300" leave-from="opacity-100" leave-to="opacity-0">
          <div class="fixed inset-0 bg-gray-900/80" />
        </TransitionChild>
        <div class="fixed inset-0 flex">
          <TransitionChild as="template" enter="transition ease-in-out duration-300 transform" enter-from="-translate-x-full" enter-to="translate-x-0" leave="transition ease-in-out duration-300 transform" leave-from="translate-x-0" leave-to="-translate-x-full">
            <DialogPanel class="relative mr-16 flex w-full max-w-35 flex-1">
              <TransitionChild as="template" enter="ease-in-out duration-300" enter-from="opacity-0" enter-to="opacity-100" leave="ease-in-out duration-300" leave-from="opacity-100" leave-to="opacity-0">
                <div class="absolute left-full top-0 flex w-16 justify-center pt-5">
                  <button type="button" class="-m-2.5 p-2.5" @click="changeProfile(false)">
                    <span class="iconfont icon-close"/>
                  </button>
                </div>
              </TransitionChild>
              <!-- Sidebar component, swap this element with another sidebar if you like -->
              <div class="flex grow flex-col bg-white px-6 py-4 text-sm font-normal">
                  <div class="text-right">
                    <Language class="mr-6"/>
                    <UserMenu/>
                  </div>
                  <div v-for="item in navigation" 
                    :key="item.title" 
                    @click="changeRouter(item.to)"
                    class="h-10 leading-10 pl-3.5 cursor-pointer opacity-60"
                    :class="selectName==item.name?'active':''"
                  >
                    <span class="iconfont" :class="item.icon"/>
                    <span class="opacity-85 ml-2.5">{{item.title}}</span>
                  </div>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </TransitionRoot>

    <!-- Static sidebar for desktop -->
    <div class="hidden border-r lg:inset-y-0 lg:z-50 lg:flex lg:w-52 lg:flex-col">
      <!-- Sidebar component, swap this element with another sidebar if you like -->
      <div class="px-6 p-2 text-sm font-normal">
        <div v-for="item in navigation" 
          :key="item.title" 
          @click="changeRouter(item.to)"
          class="h-10 leading-10 pl-3.5 cursor-pointer opacity-60"
          :class="selectName==item.name?'active':''"
        >
          <span class="iconfont" :class="item.icon"/>
          <span class="opacity-85 ml-2.5">{{item.title}}</span>
        </div>
      </div>
    </div>

    <div class="flex-1">
        <!-- <div class="lg:hidden sticky top-0 flex shrink-0 items-center bg-white px-4 lg:px-8">
            <button type="button" class="-m-2.5 p-2.5 text-gray-700 lg:hidden" @click="sidebarOpen = true">
            <span class="iconfont icon-horizon scale-125"/>
            </button>
        </div> -->

        <RouterView />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref,watch,toRefs } from 'vue'
import { RouterView,useRouter,useRoute } from 'vue-router'
import {
  Dialog,
  DialogPanel,
  TransitionChild,
  TransitionRoot,
} from '@headlessui/vue'
import {useProfileStore} from '@/stores/index'
import Language from '@/components/common/Language.vue'
import UserMenu from '@/components/common/UserMenu.vue'
const profileStore = useProfileStore()
const router = useRouter();
const route = useRoute();
const selectName = ref("")
const {sidebarOpen} = toRefs(profileStore)

// const sidebarOpen = ref(false)
const navigation = [
  { title: "Account", to: '/profile/', name: 'user', icon:"icon-account" },
  { title: "Message", to: '/profile/message', name: 'message', icon:"icon-bell-full" },
]
// 监听路由变化
watch(
  () => route,
  (newRoute) => {
    if(newRoute?.name){
        selectName.value = newRoute.name
    }
  },{deep:true,immediate:true}
);
const changeRouter = (url) => {
  router.push(url)
  if(url && sidebarOpen.value){
    sidebarOpen.value = false
  }
}
const changeProfile = (isOpen) => {
  profileStore.changeSlide(isOpen)
}
</script>
<style scoped>
.content{
  height: calc(100vh - 3.5rem);
}
.active{
  background: rgba(0, 0, 0, 0.03);
  opacity: 1;
}
</style>