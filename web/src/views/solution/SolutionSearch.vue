<script lang="ts" setup>
import {getCurrentInstance, ref} from 'vue'
import {useSolutionStore} from '@/stores/index'
import { Search } from '@element-plus/icons-vue'

const {proxy} = getCurrentInstance()
const {$t} = proxy
const solutionStore = useSolutionStore()

const searchVal = ref()
const search = () => {
  solutionStore.getSolutionList(searchVal.value)
}
</script>

<template>
  <div class="my-12 center flex justify-center">
    <div class="w-4/5 flex lg:w-1/2">
      <el-input
        v-model="searchVal"
        size="large"
        :placeholder="$t('common.pleaseSearch')"
        @keyup.enter="search"
      >
        <template #suffix>
          <el-icon class="el-input__icon search-icon" @click="search">
            <Search />
          </el-icon>
        </template>
      </el-input>
    </div>
  </div>
</template>
