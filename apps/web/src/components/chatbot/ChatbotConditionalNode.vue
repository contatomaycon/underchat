<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position, useVueFlow } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import AppInfoTooltip from '@/components/AppInfoTooltip.vue';

type ConditionType =
  | 'contains'
  | 'equals'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | null;

interface Condition {
  id: string;
  conditionType: ConditionType;
  conditionTerm: string;
}

interface ConditionalData {
  conditions: Condition[];
  onRemove?: () => void;
  onRemoveCondition?: (conditionId: string) => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();
const { updateNodeInternals } = useVueFlow();

const getInitialData = (): ConditionalData => {
  const data = props.data as ConditionalData | undefined;
  return {
    conditions: Array.isArray(data?.conditions)
      ? data.conditions.map((c) => ({
          id: c.id || crypto.randomUUID(),
          conditionType: c.conditionType || null,
          conditionTerm: c.conditionTerm || '',
        }))
      : [],
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

const getNextConditionId = () => {
  return crypto.randomUUID();
};

const buildConditionHandleId = (conditionId: string) => {
  return `condition-${conditionId}-source`;
};

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as ConditionalData;
    data.conditions = [...conditionalData.value.conditions];
  }
  nextTick(() => {
    updateNodeInternals();
  });
};

const addCondition = () => {
  const newCondition: Condition = {
    id: getNextConditionId(),
    conditionType: null,
    conditionTerm: '',
  };
  conditionalData.value.conditions.push(newCondition);
  updateNodeData();
};

const removeCondition = (index: number) => {
  const condition = conditionalData.value.conditions[index];

  if (!condition) {
    return;
  }

  const data = props.data as ConditionalData;

  if (data?.onRemoveCondition && condition.id) {
    data.onRemoveCondition(condition.id);
  }

  conditionalData.value.conditions.splice(index, 1);
  updateNodeData();
};

const updateConditionType = (index: number, conditionType: ConditionType) => {
  conditionalData.value.conditions[index].conditionType = conditionType;
  updateNodeData();
};

const updateConditionTerm = (index: number, conditionTerm: string) => {
  conditionalData.value.conditions[index].conditionTerm = conditionTerm;
  updateNodeData();
};

const getConditionTermRules = (condition: Condition) => {
  return [
    (v: string | null | undefined) => {
      if (!condition.conditionType) return true;
      const s = (v ?? '').trim();
      return !!s || t('chatbot_conditional_term_required');
    },
  ];
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
        <div
          v-for="(condition, index) in conditionalData.conditions"
          :key="condition.id"
          class="condition-item mb-3"
        >
          <div class="d-flex align-center gap-2 mb-2">
            <VSelect
              :model-value="condition.conditionType"
              @update:model-value="updateConditionType(index, $event)"
              :items="conditionTypeOptions"
              :label="t('chatbot_conditional_type')"
              variant="outlined"
              density="compact"
              class="flex-grow-1"
              hide-details
            />
            <VBtn
              icon
              variant="text"
              color="error"
              size="small"
              @click="removeCondition(index)"
            >
              <VIcon icon="tabler-trash" size="18" />
            </VBtn>
          </div>
          <div class="d-flex align-center gap-2 condition-term-wrapper">
            <VTextField
              :model-value="condition.conditionTerm"
              @update:model-value="updateConditionTerm(index, $event)"
              :label="t('chatbot_conditional_term')"
              :placeholder="t('chatbot_conditional_term_placeholder')"
              variant="outlined"
              density="compact"
              :rules="getConditionTermRules(condition)"
              class="flex-grow-1"
              hide-details="auto"
            />
            <Handle
              :id="buildConditionHandleId(condition.id)"
              type="source"
              :position="Position.Right"
              class="condition-handle handle-source"
              @mousedown.stop
              @touchstart.stop
            />
          </div>
        </div>

        <VBtn
          color="primary"
          variant="outlined"
          size="small"
          block
          @click="addCondition"
        >
          <VIcon icon="tabler-plus" class="me-2" />
          {{ t('chatbot_conditional_add') }}
        </VBtn>

        <div class="d-flex align-center ga-1 mb-1 mt-4">
          <VLabel class="text-body-2">{{
            t('chatbot_conditional_default_label')
          }}</VLabel>
          <AppInfoTooltip
            :text="t('chatbot_conditional_default_description')"
            :title="t('chatbot_conditional_default_label')"
          />
        </div>
        <div class="default-item nodrag">
          <VTextField
            :model-value="t('chatbot_conditional_default_placeholder')"
            variant="outlined"
            density="compact"
            class="default-field"
            disabled
            hide-details
          />
          <Handle
            id="default-source"
            type="source"
            :position="Position.Right"
            class="default-handle handle-source"
            @mousedown.stop
            @touchstart.stop
          />
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-conditional-node {
  width: 350px;
  min-width: 350px;
  max-width: 350px;
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

.condition-item {
  padding: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background-color: rgba(var(--v-theme-surface), 0.5);
}

.condition-term-wrapper {
  position: relative;
}

.condition-handle {
  position: absolute;
  right: -25px;
  top: 50%;
  transform: translateY(-150%);
}

.default-item {
  position: relative;
  margin-top: 8px;
}

.default-field {
  flex-grow: 1;
}

.default-handle {
  position: absolute;
  right: -10px;
  top: 50%;
  transform: translateY(-50%);
}
</style>
