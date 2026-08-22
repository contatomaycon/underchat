<script setup lang="ts">
import './chatbot-node-workbench.css';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

interface FinishData {
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const handleRemove = () => {
  const data = props.data as FinishData;
  if (data?.onRemove) {
    data.onRemove();
  }
};
</script>

<template>
  <div
    class="chatbot-finish-node chatbot-workbench-node chatbot-workbench-node--compact"
  >
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />

    <VCard class="finish-card chatbot-workbench-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle chatbot-workbench-header"
      >
        <div class="d-flex align-center ga-2 chatbot-workbench-identity">
          <VIcon
            icon="tabler-circle-check"
            color="error"
            size="20"
            class="chatbot-workbench-icon"
          />
          <span class="text-sm font-weight-medium chatbot-workbench-title">{{
            t('chatbot_finish')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as FinishData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer chatbot-workbench-remove"
          @click.stop="handleRemove"
        />
      </VCardTitle>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-finish-node {
  min-width: 150px;
}

.finish-card {
  border-radius: 8px;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
