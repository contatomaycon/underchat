<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

type ConditionType =
  | 'contains'
  | 'equals'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | null;

interface ConditionalData {
  conditionType: ConditionType;
  conditionTerm: string;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const getInitialData = (): ConditionalData => {
  const data = props.data as ConditionalData | undefined;
  return {
    conditionType: data?.conditionType || null,
    conditionTerm: data?.conditionTerm || '',
  };
};

const conditionalData = ref<ConditionalData>(getInitialData());

const conditionTypeOptions = computed(() => [
  {
    value: 'contains',
    title: t('chatbot_conditional_contains'),
  },
  {
    value: 'equals',
    title: t('chatbot_conditional_equals'),
  },
  {
    value: 'not_contains',
    title: t('chatbot_conditional_not_contains'),
  },
  {
    value: 'starts_with',
    title: t('chatbot_conditional_starts_with'),
  },
  {
    value: 'ends_with',
    title: t('chatbot_conditional_ends_with'),
  },
]);

const conditionTermRules = computed(() => [
  (v: string | null | undefined) => {
    if (!conditionalData.value.conditionType) return true;
    const s = (v ?? '').trim();
    return !!s || t('chatbot_conditional_term_required');
  },
]);

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as ConditionalData;
    data.conditionType = conditionalData.value.conditionType;
    data.conditionTerm = conditionalData.value.conditionTerm;
  }
};

const handleRemove = () => {
  const data = props.data as ConditionalData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => conditionalData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-conditional-node">
    <Handle type="target" :position="Position.Top" class="handle-target" />
    <Handle type="source" :position="Position.Bottom" class="handle-source" />

    <VCard class="conditional-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-code" color="primary" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_conditional')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as ConditionalData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VSelect
          v-model="conditionalData.conditionType"
          :items="conditionTypeOptions"
          :label="t('chatbot_conditional_type')"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <VTextField
          v-model="conditionalData.conditionTerm"
          :label="t('chatbot_conditional_term')"
          :placeholder="t('chatbot_conditional_term_placeholder')"
          variant="outlined"
          density="compact"
          :rules="conditionTermRules"
          hide-details="auto"
        />
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-conditional-node {
  min-width: 350px;
}

.conditional-card {
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
