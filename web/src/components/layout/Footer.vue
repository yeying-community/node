<template>
  <div class="bg-gray-100 mt-16">
    <div class="mx-auto max-w-6xl py-20 px-5 lg:px-0">
      <div class="block sm:flex justify-between items-center">
        <img class="w-28 h-8 mr-2" src="../../assets/img/logo.svg" />
        <div class="block sm:flex items-center">
          <div class="flex my-5 sm:my-0">
            <span class="text-sm font-puhuiBold">{{ $t("common.contactUs") }}：</span>
            <span class="text-sm text-black-400 font-puhuiRegular"
              >yeying.community@gmail.com</span
            >
          </div>
          <span class="iconfont icon-GitHub sm:ml-6 self-icon" aria-hidden="true" />
          <a
            target="_blank"
            href="https://www.xiaohongshu.com/user/profile/656ddc960000000020031366?xhsshare=WeixinSession&appuid=656ddc960000000020031366&apptime=1732503950&share_id=0d65734da9264065b28e61c93f220371"
            class="iconfont icon-xiaohongshu ml-4 self-icon text-red-600"
            aria-hidden="true"
          />
        </div>
      </div>
      <hr class="my-10 bg-gray-500" />
      <div class="text-sm font-puhuiRegular text-black flex justify-between">
        <!-- <a href="https://beian.miit.gov.cn" target="_blank">
                    浙ICP备2024126729号-2
                </a> -->
        <div>
          <a
            href="https://beian.mps.gov.cn/#/query/webSearch?code=33010902004112"
            rel="noreferrer"
            target="_blank"
            class="record-link"
          >
            <span style="margin-right: 10px;">浙公网安备33010902004112号</span>
          </a>
      
          <a
            href="https://beian.miit.gov.cn/"
            rel="noreferrer"
            target="_blank"
            >
            <span>浙ICP备2024126729号-2</span></a
          >
        </div>
        <span>Copyright © 2024</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup></script>
<style scoped>
.self-icon {
  font-size: 1.875rem;
}
</style>
