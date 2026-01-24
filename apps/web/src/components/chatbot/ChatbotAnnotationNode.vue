<script setup lang="ts">
import { ref, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

interface AnnotationData {
  annotation: string;
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
  <div class="chatbot-annotation-node">
    <Handle id="target" type="target" :position="Position.Top" class="handle-target" />
    <Handle id="source" type="source" :position="Position.Bottom" class="handle-source" />

    <VCard class="annotation-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-note" color="annotation" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_annotation_node_title')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as AnnotationData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VLabel class="text-body-2 mb-1">{{
          t('chatbot_annotation_label')
        }}</VLabel>
        <VTextarea
          v-model="annotationData.annotation"
          :placeholder="t('chatbot_annotation_placeholder')"
          variant="outlined"
          density="compact"
          rows="4"
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
