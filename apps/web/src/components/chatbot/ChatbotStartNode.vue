<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

const props = defineProps<NodeProps>();
const { t } = useI18n();
</script>

<template>
  <div class="chatbot-start-node">
    <Handle id="source" type="source" :position="Position.Bottom" class="handle-source" />
    <VCard class="start-card" elevation="2">
      <VCardText class="d-flex flex-column align-center justify-center pa-3">
        <VAvatar
          size="40"
          variant="flat"
          rounded
          color="success"
          class="mb-2 start-avatar"
        >
          <VIcon icon="tabler-flag" size="24" />
        </VAvatar>
        <span class="text-sm font-weight-medium">
          {{ props.label || t('chatbot_start') }}
        </span>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-start-node {
  min-width: 120px;
}

.start-card {
  border-radius: 8px;
}

.start-avatar {
  background-color: rgb(var(--v-theme-success)) !important;
  color: rgb(var(--v-theme-on-success)) !important;
}
</style>
