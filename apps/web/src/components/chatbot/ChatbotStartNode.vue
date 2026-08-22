<script setup lang="ts">
import './chatbot-node-workbench.css';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

const props = defineProps<NodeProps>();
const { t } = useI18n();
</script>

<template>
  <div
    class="chatbot-start-node chatbot-workbench-node chatbot-workbench-node--compact"
  >
    <Handle
      id="source"
      type="source"
      :position="Position.Bottom"
      class="handle-source"
    />
    <VCard class="start-card chatbot-workbench-card" elevation="2">
      <VCardTitle
        class="node-drag-handle chatbot-workbench-header chatbot-workbench-start-header"
      >
        <div class="chatbot-workbench-identity">
          <VIcon
            icon="tabler-flag"
            color="primary"
            size="20"
            class="chatbot-workbench-icon"
          />
          <span class="chatbot-workbench-title">
            {{ props.label || t('chatbot_start') }}
          </span>
        </div>
      </VCardTitle>
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
  background-color: rgb(var(--v-theme-primary)) !important;
  color: rgb(var(--v-theme-on-primary)) !important;
}
</style>
