<template>
  <header class="inset-x-0 top-0 z-10 flex justify-center header">
    <nav
      class="flex items-center justify-between py-4 w-full px-5 lg:px-2 xl:w-5/6"
      aria-label="节点导航"
    >
      <div class="flex items-center cursor-pointer" @click="changeRouter('/')">
        <img class="w-28 h-8 mr-2" src="../../assets/img/logo.svg" />
      </div>
      <div class="flex items-center justify-end gap-3">
        <Language style="transform: translateY(10%)" />
        <button
          type="button"
          class="font-body rounded-full bg-blue-600 px-4 py-2 text-sm text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:px-6 sm:text-base"
          @click="connectToWallet"
        >
          {{ $t('home_connect_wallet') }}
        </button>
      </div>
    </nav>
  </header>
</template>

<script lang="ts" setup>
import { useRoute, useRouter } from "vue-router";
import Language from "@/components/common/Language.vue";
import { connectWallet } from "@/plugins/auth";

const router = useRouter();
const route = useRoute();

const changeRouter = async (url: string) => {
  await router.push(url);
};

const connectToWallet = async () => {
  await connectWallet(router, route);
};
</script>

<style scoped>
.header {
  backdrop-filter: blur(10px);
  position: fixed;
}
</style>
