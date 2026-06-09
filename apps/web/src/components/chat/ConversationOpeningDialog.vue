<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineProps<{
  visible: boolean;
  subtitle: string;
}>();

const { t } = useI18n();
</script>

<template>
  <VDialog
    :model-value="visible"
    persistent
    max-width="300"
    scrim="rgba(0,0,0,0.28)"
    class="conversation-opening-dialog"
  >
    <VCard class="conversation-opening-card">
      <VProgressCircular indeterminate color="primary" size="42" width="4" />
      <h2 class="conversation-opening-title">
        {{ t('conversation_opening_title') }}
      </h2>
      <p class="conversation-opening-text">
        {{ subtitle }}
      </p>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.conversation-opening-card {
  align-items: center;
  border-radius: 14px !important;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.16) !important;
  display: flex;
  flex-direction: column;
  padding: 24px 22px;
  text-align: center;
}

.conversation-opening-title {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
  font-weight: 800;
  line-height: 1.35;
  margin-block: 14px 0;
}

.conversation-opening-text {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.8125rem;
  line-height: 18px;
  margin-block: 6px 0;
}
</style>
