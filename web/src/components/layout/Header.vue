<template>
  <header class="inset-x-0 top-0 z-10 flex justify-center header">
    <nav
      class="flex items-center justify-between py-4 w-full px-5 lg:px-2 xl:w-5/6"
      aria-label="Global"
    >
      <div class="flex lg:flex-1 items-center cursor-pointer" @click="changeRouter('/')">
        <img class="w-28 h-8 mr-2" src="../../assets/img/logo.svg" />
      </div>
      <div class="flex lg:hidden">
        <button
          type="button"
          class="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700"
          @click="mobileMenuOpen = true"
        >
          <span class="sr-only">Open main menu</span>
          <span class="iconfont icon-horizon scale-125" />
        </button>
      </div>
      <div class="hidden lg:flex lg:gap-x-12 font-puhuiRegular text-base">
        <span
          class="cursor-pointer opacity-85"
          :class="item.name == selectName ? 'text-blue-600' : ''"
          v-for="item in navigation"
          :key="item.title"
          @click="changeRouter(item.to)"
          >{{ item.title }}</span
        >
      </div>
      <div class="hidden items-center lg:flex lg:flex-1 lg:justify-end ml-3">
        <Language style="transform: translateY(10%)" />
      </div>
    </nav>
    <Dialog class="lg:hidden" @close="mobileMenuOpen = false" :open="mobileMenuOpen">
      <div class="fixed inset-0 z-50" />
      <DialogPanel
        class="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white px-6 py-6 h-screen sm:max-w-sm sm:ring-1 sm:ring-gray-900/10"
      >
        <div class="flex items-center justify-between">
          <a href="#" class="-m-1.5 p-1.5">
            <span class="sr-only">Your Company</span>
            <img class="h-8 w-auto" src="../../assets/img/logo.svg" alt="" />
          </a>
          <button
            type="button"
            class="-m-2.5 rounded-md p-2.5 text-gray-700"
            @click="mobileMenuOpen = false"
          >
            <span class="iconfont icon-close" />
          </button>
        </div>
        <div class="mt-6 flow-root">
          <div class="-my-6 divide-y divide-gray-500/10">
            <div class="space-y-2 py-6">
              <span
                href="#"
                @click="() => changeRouter(item.to)"
                v-for="item in navigation"
                :key="item.name"
                class="block px-3 py-2 text-base/7 font-puhuiRegular text-gray-900 hover:bg-gray-50"
                :style="{ color: item.name == selectName ? 'blue' : '' }"
                >{{ item.title }}</span
              >
            </div>
            <div class="py-6">
              <Language style="transform: translateY(40%)" />
            </div>
          </div>
        </div>
      </DialogPanel>
    </Dialog>
  </header>
</template>
<script lang="ts" setup>
import { ref, watch, getCurrentInstance } from "vue";
import { useRoute, useRouter } from "vue-router";
import Language from "@/components/common/Language.vue";
import { Dialog, DialogPanel } from "@headlessui/vue";

const route = useRoute();
const selectName = ref("home");
const { proxy } = getCurrentInstance();
const { $t } = proxy;
const router = useRouter();

// 监听路由变化
watch(
  () => route,
  (newRoute, oldRoute) => {
    if (newRoute?.name) {
      selectName.value = newRoute.name;
    }
  },
  { deep: true, immediate: true }
);
const navigation = [
  { title: $t("portal.solution"), to: "/solution", name: "solution" },
  { title: $t("portal.document"), to: "" },
  { title: $t("portal.blog"), to: "" },
  { title: $t("portal.aboutUs"), to: "" },
];
const mobileMenuOpen = ref(false);

const changeRouter = async (url) => {
  router.push(url);
  if (url && mobileMenuOpen.value) {
    mobileMenuOpen.value = false;
  }
};
</script>
<style scoped>
.header {
  backdrop-filter: blur(10px);
  position: fixed;
}
</style>
