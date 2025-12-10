<script setup lang="ts">
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
  <div class="chatbot-finish-node">
    <Handle type="target" :position="Position.Top" class="handle-target" />

    <VCard class="finish-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-circle-check" color="error" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_finish')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as FinishData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
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
