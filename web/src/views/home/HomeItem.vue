<template>
  <div class="mx-auto max-w-5xl pt-20 lg:pt-80">
    <div class="text-center text-3xl font-display font-semibold tracking-tight text-black-900 sm:text-5xl">{{ $t('home_advantages_title') }}</div>
    <dl class="grid px-5 mt-8 sm:mt-11 grid-cols-1 gap-x-6 gap-y-6 lg:max-w-none lg:grid-cols-2">
      <div v-for="feature in itemList" :key="feature.title"
           class="flex flex-col rounded-[calc(theme(borderRadius.xl)+theme(spacing.2))] shadow-sm ring-1 ring-black/5 p-6">
        <dt class="flex items-center h-14 leading-none	 gap-x-3 text-gray-900">
          <span :class="['text-indigo-600','iconfont','icon-'+feature.icon]" style="font-size:3rem"></span>
        </dt>
        <dd class="font-display font-medium opacity-85 mt-5 flex flex-auto flex-col text-2xl">
          {{ feature.title }}
        </dd>
        <dd class="font-body opacity-80 mt-3.5 flex flex-auto flex-col text-base ">
          {{ feature.desc }}
        </dd>
      </div>
    </dl>
  </div>
</template>
<script lang="ts" setup>
import { getCurrentInstance } from 'vue'
const { proxy } = getCurrentInstance()!
const { $t } = proxy
const itemList = [
  {
    title: $t('home_advantage_control_title'),
    desc: $t('home_advantage_control_desc'),
    icon: 'vertical'
  },
  {
    title: $t('home_advantage_privacy_title'),
    desc: $t('home_advantage_privacy_desc'),
    icon: 'qa'
  },
  {
    title: $t('home_advantage_custom_title'),
    desc: $t('home_advantage_custom_desc'),
    icon: 'crown'
  },
  {
    title: $t('home_advantage_productivity_title'),
    desc: $t('home_advantage_productivity_desc'),
    icon: 'set'
  },
]
</script>
