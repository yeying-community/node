<template>
  <Menu as="div" class="relative inline-block text-left">
    <MenuButton class="lang-trigger" :aria-label="currentLabel" :title="currentLabel">
      <el-icon class="lang-trigger-icon" aria-hidden="true">
        <Connection />
      </el-icon>
      <span class="lang-trigger-label">{{ currentLabel }}</span>
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
        class="absolute right-0 z-10 mt-2 w-24 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
      >
        <div class="py-1">
          <MenuItem v-slot="{ active }" v-for="item in menuList" :key="item.code">
            <button
              type="button"
              @click="changeLang(item.code)"
              :class="[
                active ? 'bg-gray-100 text-gray-900 outline-none' : 'text-gray-700',
                'block w-full px-4 py-2 text-left text-sm',
              ]"
            >{{ item.title }}</button>
          </MenuItem>
        </div>
      </MenuItems>
    </transition>
  </Menu>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import { Connection } from "@element-plus/icons-vue";
import { ensureDefaultLocale, getLocaleRef, setLocale } from "@/lang/locale";

const changeLang = async (code: string) => {
  setLocale(code);
};
ensureDefaultLocale();
const locale = getLocaleRef();
const menuList = ref([
  { title: "中文", code: "zh-CN" },
  { title: "English", code: "en-US" },
]);
const currentLabel = computed(() => (locale.value === "en-US" ? "English" : "中文"));
</script>
<style scoped>
.lang-trigger {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: rgba(0, 0, 0, 0.72);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: color 0.2s ease;
}

.lang-trigger:hover {
  color: rgba(0, 0, 0, 0.88);
}

.lang-trigger-icon {
  font-size: 18px;
}

.lang-trigger-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
