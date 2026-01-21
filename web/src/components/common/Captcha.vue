<template>
  <div class="login-container">
      <!-- 后端验证距离滑块 -->
      <SlideSplit
        ref="slideRef"
        w="200"
        h="120"
        st="3"
        :bigImg="imgAjaxInfo.bigImg"
        :smImg="imgAjaxInfo.smImg"
        @sliderJudge="onJudge"
      />
    <!-- </a-modal> -->
  </div>
</template>

<script lang="ts" setup>
import { reactive, ref, toRefs } from "vue";
import SlideSplit from "./SliderCaptcha.vue";
import { bgBase64,blockBase64 } from './test';
const slideRef = ref()
const imgAjaxInfo = ref({
  bigImg: bgBase64,
  smImg: blockBase64
})
const onJudge = (pos1,pos2) => {
  slideRef.value.onFail()
  // slideRef.value.reset()
  console.log("judge", pos1,pos2)
}

</script>

<style scoped>

</style>
