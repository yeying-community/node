<template>
  <div class="bg-white p-6 rounded-md">
    <div v-for="(item,index) in solutionList" :key="'solute:'+item.code">
      <hr v-if="index!=0" class="my-6">
      <div class="flex justify-between">
        <div class="text-2xl font-puhuiMedium opacity-85">{{ item.title }}</div>
      </div>
      <div class="text-base font-puhuiRegular text-blak-600 mt-3 opacity-65	">{{ item.desc }}</div>
      <div
          class="flex items-center gap-6 isolate mx-auto mt-6 grid max-w-md grid-cols-1 md:max-w-2xl md:grid-cols-2 lg:max-w-4xl xl:mx-0 xl:max-w-none xl:grid-cols-4 "
          :class="[item.isShow?'hidden':'']"
      >
        <div
            v-for="fitem in item.list"
            :key="'solute:'+fitem.code"
            class="flex flex-col justify-between rounded-3xl bg-white p-5 ring-1 ring-gray-900/10 sm:p-6"
        >
          <div class="h-72">
            <div class="text-xl font-puhuiMedium">{{ fitem.name }}</div>
            <div class="text-3xl mt-3 font-puhuiBold">{{ fitem.price }}</div>
            <hr class="mt-5 mb-1"/>
            <div class="flex text-base mt-4" v-for="(gitem,gindex) in fitem.items" :key="'solute:'+gitem.name+gindex">
              <div class="text-gray-500 font-puhuiRegular opacity-65">{{ gitem.name }}</div>
              <div class="ml-1 font-puhuiMedium">{{ gitem.value }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import {onMounted, ref, toRefs} from 'vue'
import {useSolutionStore} from '@/stores/index'

const open = ref(false)
const RefContact = ref()
const solutionStore = useSolutionStore()
const {solutionList} = toRefs(solutionStore)
const openContact = () => {
  open.value = true
  RefContact.value.openModal()
}
const close = () => {
  open.value = false
}
const changeShow = (item) => {
  item.isShow = !item.isShow
}
onMounted(() => {
  solutionStore.getSolutionList()
})
</script>