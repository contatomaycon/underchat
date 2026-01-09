<script lang="ts" setup>
import { ref } from 'vue';

const props = defineProps<{
  text: string;
  title?: string;
}>();

const isMenuOpen = ref(false);
</script>

<template>
  <VMenu
    v-model="isMenuOpen"
    location="top"
    :close-on-content-click="false"
    offset="8"
  >
    <template #activator="{ props: menuProps }">
      <VIcon
        v-bind="menuProps"
        icon="tabler-info-circle"
        size="16"
        color="primary"
        class="cursor-pointer info-icon"
      />
    </template>
    <VCard class="info-tooltip-card" min-width="280" max-width="320">
      <VCardText class="pa-3">
        <div class="d-flex align-center justify-space-between mb-2">
          <span v-if="props.title" class="info-tooltip-title">{{
            props.title
          }}</span>
          <span v-else></span>
          <VIcon
            icon="tabler-x"
            size="16"
            class="cursor-pointer close-icon flex-shrink-0"
            @click="isMenuOpen = false"
          />
        </div>
        <div class="info-tooltip-text">{{ text }}</div>
      </VCardText>
    </VCard>
  </VMenu>
</template>

<style lang="scss" scoped>
.info-icon {
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.7;
  }
}

.info-tooltip-card {
  border-radius: 0.5rem;
}

.info-tooltip-title {
  font-weight: 700;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface));
}

.close-icon {
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.7;
  }
}

.info-tooltip-text {
  white-space: normal;
  word-wrap: break-word;
  text-align: left;
  line-height: 1.5;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface));
}
</style>
