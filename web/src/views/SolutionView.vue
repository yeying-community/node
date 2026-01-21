<script lang="ts" setup>
import SolutionSearch from '@/views/solution/SolutionSearch.vue'
import SolutionItem from '@/views/solution/SolutionItem.vue'
import Footer from '@/components/layout/Footer.vue'
</script>

<template>
  <div>
    <div class="mx-auto max-w-6xl py-5 sm:pt-18 lg:pt-16">
      <SolutionSearch/>
      <SolutionItem/>
    </div>
    <Footer/>
  </div>
</template>
