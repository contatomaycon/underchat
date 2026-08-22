<script setup lang="ts">
import './chatbot-node-workbench.css';
import { computed, ref, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import ApiVariableField from './api-request/ApiVariableField.vue';
import type { ApiRequestVariable } from './api-request/types';

interface AnnotationData {
  annotation: string;
  availableVariables?: ApiRequestVariable[];
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const getInitialData = (): AnnotationData => {
  const data = props.data as AnnotationData | undefined;
  return {
    annotation: data?.annotation || '',
  };
};

const annotationData = ref<AnnotationData>(getInitialData());
const availableVariables = computed<ApiRequestVariable[]>(
  () => (props.data as AnnotationData)?.availableVariables || []
);

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as AnnotationData;
    data.annotation = annotationData.value.annotation;
  }
};

watch(
  () => annotationData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);

const handleRemove = () => {
  const data = props.data as AnnotationData;
  if (data?.onRemove) {
    data.onRemove();
  }
};
</script>

<template>
  <div class="chatbot-annotation-node chatbot-workbench-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />
    <Handle
      id="source"
      type="source"
      :position="Position.Bottom"
      class="handle-source"
    />

    <VCard class="annotation-card chatbot-workbench-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle chatbot-workbench-header"
      >
        <div class="d-flex align-center ga-2 chatbot-workbench-identity">
          <VIcon
            icon="tabler-note"
            color="annotation"
            size="20"
            class="chatbot-workbench-icon"
          />
          <span class="text-sm font-weight-medium chatbot-workbench-title">{{
            t('chatbot_annotation_node_title')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as AnnotationData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer chatbot-workbench-remove"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3 chatbot-workbench-body">
        <VLabel class="text-body-2 mb-1">{{
          t('chatbot_annotation_label')
        }}</VLabel>
        <ApiVariableField
          v-model="annotationData.annotation"
          :variables="availableVariables"
          :placeholder="t('chatbot_annotation_placeholder')"
          multiline
          :rows="4"
          hide-details="auto"
        />
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-annotation-node {
  min-width: 350px;
}

.annotation-card {
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
