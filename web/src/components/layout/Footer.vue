<template>
  <div class="bg-gray-100 mt-16">
    <div class="mx-auto max-w-6xl py-20 px-5 lg:px-0">
      <div class="block sm:flex justify-between items-center">
        <img class="w-28 h-8 mr-2" src="../../assets/img/logo.svg" />
        <div class="footer-contact-area">
          <span class="iconfont icon-GitHub sm:ml-6 self-icon" aria-hidden="true" />
          <a
            target="_blank"
            href="https://www.xiaohongshu.com/user/profile/656ddc960000000020031366?xhsshare=WeixinSession&appuid=656ddc960000000020031366&apptime=1732503950&share_id=0d65734da9264065b28e61c93f220371"
            class="iconfont icon-xiaohongshu ml-4 self-icon text-red-600"
            aria-hidden="true"
          />
          <div class="footer-contact-text">
            <span class="text-sm font-display font-semibold">{{ $t("btn_contact") }}：</span>
            <span class="text-sm text-black-400 font-body"
              >yeying.community@gmail.com</span
            >
          </div>
        </div>
      </div>
      <hr class="my-10 bg-gray-500" />
      <div class="text-sm font-body text-black flex justify-between">
        <div>
          <a
            href="https://beian.mps.gov.cn/#/query/webSearch?code=33010902004112"
            rel="noreferrer"
            target="_blank"
            class="record-link"
          >
            <span style="margin-right: 10px;">{{ $t('footer_public_security_record') }}</span>
          </a>
      
          <a
            href="https://beian.miit.gov.cn/"
            rel="noreferrer"
            target="_blank"
            >
            <span>{{ $t('footer_icp_record') }}</span></a
          >
        </div>
        <span>{{ $t('footer_copyright') }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup></script>
<style scoped>
.self-icon {
  font-size: 1.875rem;
}

.footer-contact-area {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-left: auto;
  text-align: right;
}

.footer-contact-text {
  display: flex;
  justify-content: flex-end;
  margin: 1.25rem 0 1.25rem 1.5rem;
  text-align: right;
}

@media (max-width: 639px) {
  .footer-contact-area {
    flex-wrap: wrap;
    margin-top: 1.25rem;
  }

  .footer-contact-text {
    flex-basis: 100%;
    margin: 0 0 1.25rem;
    order: -1;
  }
}
</style>
