<template>
  <div class="profile">
    <div class="left">
      <div class="cont">
        <div
          v-for="item in navigation"
          :key="item.title"
          @click="changeRouter(item.to)"
          class="item"
          :class="selectName.includes(item.name) ? 'active' : ''"
        >
          <el-icon>
            <component :is="item.icon" />
          </el-icon>
          <span style="margin-left: 5px">{{ item.title }}</span>
        </div>
      </div>
    </div>
    <div class="right">
      <router-view />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import { RouterView, useRouter, useRoute } from "vue-router";
import { Menu, Operation, Document } from "@element-plus/icons-vue";

const router = useRouter();
const route = useRoute();
const selectName = ref("");
const sidebarOpen = ref(false);

const navigation = [
  { title: "应用中心", to: "/market/", name: "apply", icon: Menu },
  {
    title: "服务中心",
    to: "/market/service/",
    name: "service",
    icon: Operation,
  },
  {
    title: "我的审批",
    to: "/market/approval/",
    name: "approval",
    icon: Document,
  }
];

// 监听路由变化
watch(
  () => route,
  (newRoute) => {
    if (newRoute?.name) {
      selectName.value = newRoute.name;
    }
  },
  { deep: true, immediate: true }
);

const changeRouter = (url: string) => {
  router.push(url);
  if (sidebarOpen.value) {
    sidebarOpen.value = false;
  }
};

const toggleSidebar = () => {
  sidebarOpen.value = !sidebarOpen.value;
};
</script>

<style scoped lang="less">
.profile {
  min-height: calc(100vh - 3.8rem);
  display: flex;

  .right {
    flex: 1;
  }

  .left {
    width: 13rem;
    border-right: 1px solid #e5e7eb;

    .cont {
      padding: 1rem;
      font-size: 0.875rem;
      line-height: 1.25rem;
    }

    .item {
      height: 2.5rem;
      line-height: 2.5rem;
      opacity: 0.6;
      padding-left: 0.875rem;
      cursor: pointer;
      color: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
    }
  }
}

@media (max-width: 768px) {
  .left {
    display: none;
  }
}

.active {
  background: rgba(0, 0, 0, 0.03);
  color: black !important;
  opacity: 1;
}
</style>
