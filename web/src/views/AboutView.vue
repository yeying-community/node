<template>
  <div class="about">
    <h1>关于我们</h1>
    <p>{{ $t['name'] }}</p>
  </div>
</template>
<script lang="ts" setup>
import {getCurrentInstance} from 'vue'

const {proxy} = getCurrentInstance()
const {$t} = proxy

</script>
<style scoped lang="less">
.about {
  margin: 20px;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
}

h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.3;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.88);
}

p {
  margin-top: 10px;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(0, 0, 0, 0.65);
}
</style>
