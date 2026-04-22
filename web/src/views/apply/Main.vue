<template>
  <div class="profile">
    <div class="left" :class="{ collapsed: isCollapsed }">
      <div class="sidebar-head">
        <span v-show="!isCollapsed" class="sidebar-title">工具栏</span>
        <el-tooltip :content="isCollapsed ? '展开工具栏' : '收起工具栏'" placement="right">
          <button type="button" class="collapse-btn" @click="toggleCollapse">
            <el-icon>
              <component :is="isCollapsed ? Expand : Fold" />
            </el-icon>
          </button>
        </el-tooltip>
      </div>
      <div class="cont">
        <el-tooltip
          v-for="item in navigation"
          :key="item.title"
          :content="item.title"
          :disabled="!isCollapsed"
          placement="right"
        >
          <div
            @click="changeRouter(item.to)"
            class="item"
            :class="{ active: selectName.includes(item.name) }"
          >
            <el-icon class="item-icon">
              <component :is="item.icon" />
            </el-icon>
            <span v-show="!isCollapsed" class="item-text">{{ item.title }}</span>
          </div>
        </el-tooltip>
      </div>
    </div>
    <div class="right">
      <router-view />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { Menu, Document, Setting, Expand, Fold } from "@element-plus/icons-vue";

const SIDEBAR_COLLAPSED_KEY = "market:sidebar:collapsed";

const router = useRouter();
const route = useRoute();
const selectName = ref("");
const isCollapsed = ref(false);

const navigation = [
  { title: "应用中心", to: "/market/", name: "apply", icon: Menu },
  {
    title: "我的审批",
    to: "/market/approval/",
    name: "approval",
    icon: Document,
  },
  {
    title: "我的配置",
    to: "/market/my-config/",
    name: "myConfig",
    icon: Setting,
  }
];

watch(
  () => route,
  (newRoute) => {
    if (newRoute?.name) {
      selectName.value = String(newRoute.name);
    }
  },
  { deep: true, immediate: true }
);

const changeRouter = (url: string) => {
  router.push(url);
};

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isCollapsed.value ? "1" : "0");
  } catch {
    // ignore storage failure
  }
};

onMounted(() => {
  try {
    isCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    isCollapsed.value = false;
  }
});
</script>

<style scoped lang="less">
.profile {
  min-height: calc(100vh - 3.8rem);
  display: flex;

  .right {
    flex: 1;
    min-width: 0;
  }

  .left {
    width: 13rem;
    min-width: 13rem;
    flex: 0 0 13rem;
    border-right: 1px solid #e5e7eb;
    background: #fff;
    transition: width 0.2s ease, min-width 0.2s ease, flex-basis 0.2s ease;

    .sidebar-head {
      height: 3rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 0.75rem;
      border-bottom: 1px solid #f0f2f5;
    }

    .sidebar-title {
      font-size: 0.9375rem;
      color: rgba(0, 0, 0, 0.7);
      font-family: var(--app-font-display);
      font-weight: 500;
      letter-spacing: 0.01em;
    }

    .collapse-btn {
      width: 1.75rem;
      height: 1.75rem;
      border: none;
      background: transparent;
      border-radius: 0.5rem;
      color: rgba(0, 0, 0, 0.55);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(0, 0, 0, 0.06);
        color: rgba(0, 0, 0, 0.82);
      }
    }

    .cont {
      padding: 0.625rem;
      font-size: 0.9375rem;
      line-height: 1.35;
    }

    .item {
      height: 2.5rem;
      opacity: 0.78;
      padding: 0 0.625rem;
      cursor: pointer;
      color: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 400;
      border-radius: 0.5rem;
      letter-spacing: 0.01em;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(0, 0, 0, 0.03);
        opacity: 1;
      }

      .item-icon {
        font-size: 1rem;
      }

      .item-text {
        white-space: nowrap;
      }
    }

    .item.active {
      background: rgba(0, 0, 0, 0.06);
      color: rgba(0, 0, 0, 0.9);
      font-family: var(--app-font-display);
      font-weight: 500;
      opacity: 1;
    }
  }

  .left.collapsed {
    width: 4rem;
    min-width: 4rem;
    flex-basis: 4rem;

    .sidebar-head {
      justify-content: center;
      padding: 0;
    }

    .cont {
      padding: 0.625rem 0.5rem;
    }

    .item {
      justify-content: center;
      padding: 0;
    }
  }
}

@media (max-width: 768px) {
  .left {
    display: none;
  }
}
</style>
