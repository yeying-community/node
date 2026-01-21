<template>
  <div class="about">
    <h1 class="text-red-500	 font-bold underline">
      about--{{ $t['name'] }}
    </h1>
  </div>
</template>
<script lang="ts" setup>
import {getCurrentInstance} from 'vue'

const {proxy} = getCurrentInstance()
const {$t} = proxy

</script>
<style>
</style>
