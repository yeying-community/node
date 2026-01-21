<template>
  <Menu as="div" class="relative inline-block text-left">
    <MenuButton class="flex items-start">
        <div
            aria-hidden="true"
            class="iconfont icon-language w-7 h-7 opacity-60 lang text-center cursor-pointer"
        ></div>
    </MenuButton>
    <transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <MenuItems
        class="absolute right-0 z-10 mt-2 w-20 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
      >
        <div class="py-1">
          <MenuItem
            @click="changeLang(item.code)"
            v-slot="{ active }"
            v-for="item in menuList"
            :key="item.code"
          >
            <a
              href="#"
              :class="[
                active ? 'bg-gray-100 text-gray-900 outline-none' : 'text-gray-700',
                'block px-4 py-2 text-sm',
              ]"
              >{{ item.title }}</a
            >
          </MenuItem>
        </div>
      </MenuItems>
    </transition>
  </Menu>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import { setLanguage } from "@yeying-community/yeying-i18n";

const changeLang = async (code) => {
  console.log("code", code);
  await setLanguage(code);
  location.reload();
};
const menuList = ref([
  { title: "English", code: "en-US" },
  { title: "Chinese", code: "zh-CN" },
]);

//   import { ChevronDownIcon } from '@heroicons/vue/20/solid'
</script>
<style scoped>
.lang {
  font-size: 1.4rem;
  transform: translateY(-25%);
}
</style>
