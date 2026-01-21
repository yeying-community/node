<template>
  <div class="mx-auto max-w-5xl pt-20 lg:pt-80">
    <div class="text-center text-3xl font-puhuiBold tracking-tight text-black-900 sm:text-5xl">Our advantage</div>
    <dl class="grid px-5 mt-8 sm:mt-11 grid-cols-1 gap-x-6 gap-y-6 lg:max-w-none lg:grid-cols-2">
      <div v-for="feature in itemList" :key="feature.title"
           class="flex flex-col rounded-[calc(theme(borderRadius.xl)+theme(spacing.2))] shadow-sm ring-1 ring-black/5 p-6">
        <dt class="flex items-center h-14 leading-none	 gap-x-3 text-gray-900">
          <span :class="['text-indigo-600','iconfont','icon-'+feature.icon]" style="font-size:3rem"></span>
        </dt>
        <dd class="font-puhuiMedium opacity-85 mt-5 flex flex-auto flex-col text-2xl">
          {{ feature.title }}
        </dd>
        <dd class="font-puhuiRegular opacity-80 mt-3.5 flex flex-auto flex-col text-base ">
          {{ feature.desc }}
        </dd>
      </div>
    </dl>
  </div>
</template>
<script lang="ts" setup>
const itemList = [
  {
    title: 'Self-Controllable',
    desc: 'The user\'s own number is the sum of the numbers and the amount is completely controlled and owned.',
    icon: 'vertical'
  },
  {
    title: 'Privacy Protection',
    desc: 'In order to protect the number of exchanges, it is necessary to maintain public safety and to protect the private security of non-public numbers.',
    icon: 'qa'
  },
  {
    title: 'individual',
    desc: 'You can use it based on your own academic needs, work methods, and lifestyle preferences.',
    icon: 'crown'
  },
  {
    title: 'Productivity Tools',
    desc: 'Established personal knowledge, used AI technology, constructed numbers worldwide, high production, work efficiency.',
    icon: 'set'
  },
]
</script>