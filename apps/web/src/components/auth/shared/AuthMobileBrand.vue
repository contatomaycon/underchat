<script setup lang="ts">
import type { VNode } from 'vue';
import { VNodeRenderer } from '@layouts/components/VNodeRenderer';

defineProps<{
  appTitle: string;
  logo: VNode | VNode[];
}>();
</script>

<template>
  <div class="auth-mobile-brand">
    <span class="auth-mobile-brand__logo">
      <VNodeRenderer :nodes="logo" />
    </span>
    <span class="auth-mobile-brand__name">{{ appTitle }}</span>
  </div>
</template>

<style scoped>
.auth-mobile-brand {
  display: none;
  align-items: center;
  gap: 0.7rem;
  margin-block-end: 4rem;
}

.auth-mobile-brand__logo {
  display: grid;
  block-size: 2.25rem;
  inline-size: 2rem;
  place-items: center;
}

.auth-mobile-brand__name {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-transform: capitalize;
}

@media (max-width: 959px) {
  .auth-mobile-brand {
    display: flex;
  }
}

@media (max-width: 599px) {
  .auth-mobile-brand {
    margin-block-end: 3.25rem;
  }
}
</style>
