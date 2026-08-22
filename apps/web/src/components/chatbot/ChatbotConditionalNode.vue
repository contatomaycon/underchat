<script setup lang="ts">
import './chatbot-node-workbench.css';
import { ref, computed, watch, nextTick } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position, useVueFlow } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import AppInfoTooltip from '@/components/AppInfoTooltip.vue';
import ApiVariableField from '@/components/chatbot/api-request/ApiVariableField.vue';
import type { ApiRequestVariable } from '@/components/chatbot/api-request/types';

type ConditionType =
  | 'contains'
  | 'equals'
  | 'not_equals'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'exists'
  | 'not_exists'
  | 'greater_than'
  | 'greater_or_equal'
  | 'less_than'
  | 'less_or_equal'
  | null;

interface Condition {
  id: string;
  conditionType: ConditionType;
  conditionTerm: string;
  valueType: 'string' | 'number' | 'boolean';
}

interface ConditionalData {
  conditions: Condition[];
  conditionalOperand: 'message' | 'variable';
  conditionalVariable: string;
  availableVariables?: ApiRequestVariable[];
  onRemove?: () => void;
  onRemoveCondition?: (conditionId: string) => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();
const { updateNodeInternals } = useVueFlow();

const getInitialData = (): ConditionalData => {
  const data = props.data as ConditionalData | undefined;
  return {
    conditionalOperand:
      data?.conditionalOperand === 'variable' ? 'variable' : 'message',
    conditionalVariable: data?.conditionalVariable || '',
    conditions: Array.isArray(data?.conditions)
      ? data.conditions.map((c) => ({
          id: c.id || crypto.randomUUID(),
          conditionType: c.conditionType || null,
          conditionTerm: c.conditionTerm || '',
          valueType: c.valueType || 'string',
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
    value: 'not_equals',
    title: t('chatbot_conditional_not_equals'),
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
  { value: 'exists', title: t('chatbot_conditional_exists') },
  { value: 'not_exists', title: t('chatbot_conditional_not_exists') },
  { value: 'greater_than', title: t('chatbot_conditional_greater_than') },
  {
    value: 'greater_or_equal',
    title: t('chatbot_conditional_greater_or_equal'),
  },
  { value: 'less_than', title: t('chatbot_conditional_less_than') },
  {
    value: 'less_or_equal',
    title: t('chatbot_conditional_less_or_equal'),
  },
]);

const valueTypeOptions = computed(() => [
  { value: 'string', title: t('chatbot_conditional_value_text') },
  { value: 'number', title: t('chatbot_conditional_value_number') },
  { value: 'boolean', title: t('chatbot_conditional_value_boolean') },
]);

const availableVariables = computed(
  () => (props.data as ConditionalData | undefined)?.availableVariables || []
);

const getNextConditionId = () => {
  return crypto.randomUUID();
};

const buildConditionHandleId = (conditionId: string) => {
  return `condition-${conditionId}-source`;
};

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as ConditionalData;
    data.conditionalOperand = conditionalData.value.conditionalOperand;
    data.conditionalVariable = conditionalData.value.conditionalVariable;
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
    valueType: 'string',
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

const updateConditionValueType = (
  index: number,
  valueType: Condition['valueType']
) => {
  conditionalData.value.conditions[index].valueType = valueType;
  updateNodeData();
};

const updateOperand = (value: 'message' | 'variable') => {
  conditionalData.value.conditionalOperand = value;
  updateNodeData();
};

const updateConditionalVariable = (value: string) => {
  conditionalData.value.conditionalVariable = value;
  updateNodeData();
};

const getConditionTermRules = (condition: Condition) => {
  return [
    (v: string | null | undefined) => {
      if (!condition.conditionType) return true;
      if (['exists', 'not_exists'].includes(condition.conditionType)) {
        return true;
      }
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
  <div class="chatbot-conditional-node chatbot-workbench-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />

    <VCard class="conditional-card chatbot-workbench-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle chatbot-workbench-header"
      >
        <div class="d-flex align-center ga-2 chatbot-workbench-identity">
          <VIcon
            icon="tabler-code"
            color="primary"
            size="20"
            class="chatbot-workbench-icon"
          />
          <span class="text-sm font-weight-medium chatbot-workbench-title">{{
            t('chatbot_conditional')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as ConditionalData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer chatbot-workbench-remove"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3 chatbot-workbench-body">
        <div class="conditional-operand mb-3 nodrag">
          <span class="conditional-section-label">
            {{ t('chatbot_conditional_operand') }}
          </span>
          <div
            class="conditional-operand-tabs"
            role="tablist"
            :aria-label="t('chatbot_conditional_operand')"
          >
            <button
              type="button"
              role="tab"
              class="conditional-operand-tab"
              :class="{
                'conditional-operand-tab--active':
                  conditionalData.conditionalOperand === 'message',
              }"
              :aria-selected="conditionalData.conditionalOperand === 'message'"
              @click="updateOperand('message')"
            >
              <VIcon icon="tabler-message" size="16" />
              <span>{{ t('chatbot_conditional_received_message') }}</span>
            </button>
            <button
              type="button"
              role="tab"
              class="conditional-operand-tab"
              :class="{
                'conditional-operand-tab--active':
                  conditionalData.conditionalOperand === 'variable',
              }"
              :aria-selected="conditionalData.conditionalOperand === 'variable'"
              @click="updateOperand('variable')"
            >
              <VIcon icon="tabler-braces" size="16" />
              <span>{{ t('chatbot_conditional_variable') }}</span>
            </button>
          </div>

          <div
            v-if="conditionalData.conditionalOperand === 'variable'"
            class="conditional-field conditional-variable-field"
          >
            <label
              :id="`conditional-variable-label-${props.id}`"
              :for="`conditional-variable-${props.id}`"
              class="conditional-field__label"
            >
              {{ t('chatbot_conditional_variable') }}
            </label>
            <ApiVariableField
              :id="`conditional-variable-${props.id}`"
              :model-value="conditionalData.conditionalVariable"
              :variables="availableVariables"
              :aria-labelledby="`conditional-variable-label-${props.id}`"
              class="conditional-control"
              placeholder="{{ api_1.data.status }}"
              monospace
              hide-details
              @update:model-value="updateConditionalVariable"
            />
          </div>
        </div>

        <div
          v-for="(condition, index) in conditionalData.conditions"
          :key="condition.id"
          class="condition-item mb-3 nodrag"
        >
          <div class="condition-item__header">
            <div class="conditional-field">
              <label
                :id="`condition-type-label-${condition.id}`"
                :for="`condition-type-${condition.id}`"
                class="conditional-field__label"
              >
                {{ t('chatbot_conditional_type') }}
              </label>
              <VSelect
                :id="`condition-type-${condition.id}`"
                :model-value="condition.conditionType"
                :items="conditionTypeOptions"
                :list-props="{ density: 'compact' }"
                :aria-labelledby="`condition-type-label-${condition.id}`"
                variant="outlined"
                density="compact"
                class="conditional-control"
                hide-details
                @update:model-value="updateConditionType(index, $event)"
              />
            </div>
            <VBtn
              icon
              variant="text"
              color="error"
              size="small"
              class="condition-remove"
              aria-label="Remover condição"
              @click="removeCondition(index)"
            >
              <VIcon icon="tabler-trash" size="18" />
            </VBtn>
          </div>

          <div
            v-if="
              !['exists', 'not_exists'].includes(condition.conditionType || '')
            "
            class="condition-term-grid"
          >
            <div class="conditional-field condition-value-type">
              <label
                :id="`condition-value-type-label-${condition.id}`"
                :for="`condition-value-type-${condition.id}`"
                class="conditional-field__label"
              >
                {{ t('chatbot_conditional_value_type') }}
              </label>
              <VSelect
                :id="`condition-value-type-${condition.id}`"
                :model-value="condition.valueType"
                :items="valueTypeOptions"
                :list-props="{ density: 'compact' }"
                :aria-labelledby="`condition-value-type-label-${condition.id}`"
                variant="outlined"
                density="compact"
                class="conditional-control"
                hide-details
                @update:model-value="updateConditionValueType(index, $event)"
              />
            </div>
            <div class="conditional-field condition-term-field">
              <label
                :id="`condition-term-label-${condition.id}`"
                :for="`condition-term-${condition.id}`"
                class="conditional-field__label"
              >
                {{ t('chatbot_conditional_term') }}
              </label>
              <ApiVariableField
                :id="`condition-term-${condition.id}`"
                :model-value="condition.conditionTerm"
                :variables="availableVariables"
                :aria-labelledby="`condition-term-label-${condition.id}`"
                :placeholder="t('chatbot_conditional_term_placeholder')"
                :rules="getConditionTermRules(condition)"
                class="conditional-control"
                hide-details="auto"
                @update:model-value="updateConditionTerm(index, $event)"
              />
            </div>
          </div>
          <div v-else class="condition-existence-hint">
            {{ t('chatbot_conditional_existence_hint') }}
          </div>
          <Handle
            :id="buildConditionHandleId(condition.id)"
            type="source"
            :position="Position.Right"
            class="condition-handle handle-source"
            @mousedown.stop
            @touchstart.stop
          />
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
  width: 410px;
  min-width: 410px;
  max-width: 410px;
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
  position: relative;
  padding: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background-color: rgba(var(--v-theme-surface), 0.5);
}

.conditional-operand {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.035);
}

.conditional-section-label,
.conditional-field__label {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.6875rem;
  font-weight: 750;
  letter-spacing: 0.025em;
  line-height: 1.2;
}

.conditional-operand-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  inline-size: 100%;
  padding: 3px;
  border: 1px solid rgba(var(--v-border-color), 0.86);
  border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.025);
}

.conditional-operand-tab {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-block-size: 40px;
  min-inline-size: 0;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.62);
  cursor: pointer;
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 650;
  line-height: 1.2;
  text-align: start;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.conditional-operand-tab > .v-icon {
  justify-self: center;
}

.conditional-operand-tab > span {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.conditional-operand-tab:hover {
  background: rgba(var(--v-theme-primary), 0.055);
  color: rgb(var(--v-theme-primary));
}

.conditional-operand-tab--active {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 4px rgba(13, 31, 54, 0.1);
  color: rgb(var(--v-theme-primary));
}

.conditional-operand-tab:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.5);
  outline-offset: 1px;
}

.conditional-field {
  display: grid;
  min-inline-size: 0;
  gap: 6px;
}

.conditional-variable-field {
  margin-block-start: 2px;
}

.condition-item__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  align-items: end;
  gap: 8px;
  margin-block-end: 10px;
}

.condition-remove {
  block-size: 42px !important;
  inline-size: 36px !important;
}

.condition-term-grid {
  display: grid;
  grid-template-columns: minmax(118px, 0.38fr) minmax(0, 1fr);
  align-items: start;
  gap: 10px;
}

.conditional-control {
  min-inline-size: 0;
}

.conditional-control :deep(.v-field) {
  block-size: 42px;
  min-block-size: 42px;
}

.conditional-control :deep(.v-field__input) {
  min-block-size: 42px;
  padding-block: 0;
}

.condition-existence-hint {
  min-block-size: 42px;
  padding: 11px 12px;
  border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
}

.condition-handle {
  position: absolute;
  right: -20px;
  top: 50%;
  transform: translateY(-50%);
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

@media (max-width: 440px) {
  .chatbot-conditional-node {
    width: calc(100vw - 32px);
    min-width: min(320px, calc(100vw - 32px));
  }

  .condition-term-grid {
    grid-template-columns: 1fr;
  }

  .conditional-operand-tab {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
}
</style>
