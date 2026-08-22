<script setup lang="ts">
defineProps<{
  title: string;
  icon: string;
}>();
</script>

<template>
  <VCard class="account-settings-section" variant="flat">
    <div class="account-settings-section__header">
      <div class="account-settings-section__icon">
        <VIcon :icon="icon" size="20" />
      </div>
      <h2 class="account-settings-section__title">
        {{ title }}
      </h2>
    </div>

    <div class="account-settings-section__body">
      <slot />
    </div>

    <div v-if="$slots.actions" class="account-settings-section__actions">
      <slot name="actions" />
    </div>
  </VCard>
</template>

<style scoped lang="scss">
.account-settings-section {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 10px 34px -26px rgb(var(--v-theme-shadow-color) / 0.42);
}

.account-settings-section__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px 14px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.1);
}

.account-settings-section__icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border: 1px solid rgb(var(--v-theme-primary) / 0.18);
  border-radius: 8px;
  background: rgb(var(--v-theme-primary) / 0.08);
  color: rgb(var(--v-theme-primary));
}

.account-settings-section__title {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.35;
}

.account-settings-section__body {
  padding: 18px 22px 16px;
}

.account-settings-section__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 0 22px 18px;
}

@media (max-width: 599px) {
  .account-settings-section__header {
    padding: 16px 16px 12px;
  }

  .account-settings-section__body {
    padding: 16px;
  }

  .account-settings-section__actions {
    padding: 0 16px 16px;
  }
}
</style>
