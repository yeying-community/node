<template>
  <header class="site-header">
    <nav class="site-header-inner" :aria-label="$t('auth_node_label')">
      <button type="button" class="brand-button" :aria-label="$t('auth_home_label')" @click="goHome">
        <img src="../../assets/img/logo.svg" alt="YeYing" />
      </button>
      <div class="header-context">
        <span class="header-context-label">{{ $t('auth_node_label') }}</span>
        <Language />
      </div>
    </nav>
  </header>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router'
import Language from '@/components/common/Language.vue'

const router = useRouter()

function goHome() {
  void router.push('/')
}
</script>

<style scoped>
.site-header {
  position: absolute;
  inset: 0 0 auto;
  z-index: 10;
  padding: 24px clamp(20px, 5vw, 72px);
}

.site-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: min(1180px, 100%);
  margin: 0 auto;
}

.brand-button {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.brand-button img {
  display: block;
  width: 121px;
  height: 32px;
}

.header-context {
  display: flex;
  align-items: center;
  gap: 18px;
}

.header-context-label {
  color: #667386;
  font-size: 13px;
}

.brand-button:focus-visible,
.header-context :deep(.lang-trigger):focus-visible {
  outline: 2px solid #0b8e8b;
  outline-offset: 5px;
}

@media (max-width: 640px) {
  .site-header {
    padding: 18px 20px;
  }

  .brand-button img {
    width: 104px;
    height: auto;
  }

  .header-context-label {
    display: none;
  }
}
</style>
