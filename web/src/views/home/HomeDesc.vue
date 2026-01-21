<script lang="ts" setup>
import { useRoute, useRouter } from 'vue-router'
import { connectWallet } from '@/plugins/auth'

const router = useRouter();
const route = useRoute();

const connectToWallet = async () => {
  await connectWallet(router, route)
}
</script>

<template>
  <div class="mx-auto pt-10 sm:pt-16 lg:pt-40">
    <div class="text-center">
      <div class="text-center flex justify-center">
        <div
            class="text-balance max-w-4xl font-puhuiMedium opacity-85 text-4xl tracking-tight text-gray-900 sm:text-6xl line_height sm:line_height2 leading-snug	">
          Build any smart <span class="blue-color">web3</span> application freely
        </div>
      </div>
      <div class="mt-10 px-5 lg:px-0 lg:px-0 text-lg font-puhuiRegular">It is a Web3 open source community driven by the
        community and independent developers, focusing on full-stack technologies related to Web3 and AI, used to build
        open infrastructure, and provide the ability to DIY various Web3 applications.
      </div>
      <div class="mt-14 flex items-center justify-center gap-x-6">
        <button type="button" @click="connectToWallet"
                class="mx-2.5 font-puhuiRegular rounded-full bg-blue-600 px-3 sm:px-8 py-2.5 py-2.5 text-base sm:text-xl text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          Connect to wallet
        </button>
      </div>
    </div>
    <!-- <Contact :isOpen="open" ref="RefContact"/> -->
  </div>
</template>
<style scoped>
.line_height2 {
  line-height: 1.4;
}

.line_height {
  line-height: 1.4;
}
</style>
