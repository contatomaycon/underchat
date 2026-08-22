<script setup lang="ts">
import './chatbot-node-workbench.css';
import { computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import ApiVariableField from '@/components/chatbot/api-request/ApiVariableField.vue';
import type { ApiRequestVariable } from '@/components/chatbot/api-request/types';
import {
  formatChatbotNodeOutputTag,
  getChatbotNodeOutputDefinition,
} from '@core/common/functions/chatbotNodeOutputs';
import type { UnderchatLookupConfig } from '@core/schema/chatbot/chatbotFlow.schema';
import CapturableOutputStrip from './CapturableOutputStrip.vue';

interface UnderchatNodeData {
  outputKey: string;
  underchatLookup?: Partial<UnderchatLookupConfig>;
  availableVariables?: ApiRequestVariable[];
  readOnly?: boolean;
  restricted?: boolean;
  onRemove?: () => void;
  onUpdate?: (lookup: UnderchatLookupConfig) => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const nodeData = computed(() => props.data as UnderchatNodeData);
const isRestricted = computed(() => nodeData.value.restricted === true);
const isReadOnly = computed(
  () => nodeData.value.readOnly === true || isRestricted.value
);
const availableVariables = computed<ApiRequestVariable[]>(() =>
  isReadOnly.value ? [] : nodeData.value.availableVariables || []
);

const currentLookup = computed<UnderchatLookupConfig>(() => ({
  version: 1,
  lookupType:
    nodeData.value.underchatLookup?.lookupType === 'document'
      ? 'document'
      : 'email',
  lookupExpression:
    typeof nodeData.value.underchatLookup?.lookupExpression === 'string'
      ? nodeData.value.underchatLookup.lookupExpression
      : '',
}));

const updateLookup = (patch: Partial<UnderchatLookupConfig>): void => {
  if (isReadOnly.value) return;
  nodeData.value.onUpdate?.({
    ...currentLookup.value,
    ...patch,
    version: 1,
  });
};

const lookupType = computed<UnderchatLookupConfig['lookupType']>({
  get: () => currentLookup.value.lookupType,
  set: (value) => updateLookup({ lookupType: value }),
});

const lookupExpression = computed<string>({
  get: () => currentLookup.value.lookupExpression,
  set: (value) => updateLookup({ lookupExpression: value }),
});

const lookupTypeOptions = computed(() => [
  { value: 'email', title: t('chatbot_underchat_lookup_type_email') },
  { value: 'document', title: t('chatbot_underchat_lookup_type_document') },
]);

const lookupPlaceholder = computed(() =>
  lookupType.value === 'email'
    ? t('chatbot_underchat_lookup_email_placeholder')
    : t('chatbot_underchat_lookup_document_placeholder')
);

const lookupHint = computed(() =>
  lookupType.value === 'email'
    ? t('chatbot_underchat_lookup_email_hint')
    : t('chatbot_underchat_lookup_document_hint')
);

const lookupInputId = computed(() => `underchat-${props.id}-lookup`);

const lookupRules = computed(() => [
  (value: string | null | undefined) =>
    Boolean(value?.trim()) || t('chatbot_underchat_lookup_required'),
]);

const outputTags = computed(() => {
  if (isRestricted.value) return [];
  const output = getChatbotNodeOutputDefinition({
    type: 'underchat',
    data: {
      outputKey: nodeData.value.outputKey,
      underchatLookup: currentLookup.value,
    },
  });
  return (
    output?.fields.map((field) =>
      formatChatbotNodeOutputTag(output.outputKey, field.path)
    ) ?? []
  );
});

const removeNode = (): void => {
  if (isReadOnly.value) return;
  nodeData.value.onRemove?.();
};
</script>

<template>
  <div
    class="underchat-node"
    :class="{
      'underchat-node--read-only': isReadOnly,
      'underchat-node--restricted': isRestricted,
    }"
  >
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      :connectable="!isReadOnly"
      class="underchat-node__handle underchat-node__handle--target handle-target"
    />

    <VCard class="underchat-node__card" elevation="0">
      <header class="underchat-node__header node-drag-handle">
        <div class="underchat-node__identity">
          <span class="underchat-node__icon" aria-hidden="true">
            <VIcon icon="tabler-user-search" size="19" />
          </span>
          <div>
            <span class="underchat-node__eyebrow">{{
              t('chatbot_underchat_eyebrow')
            }}</span>
            <h3 class="underchat-node__title">
              {{ t('chatbot_underchat') }}
            </h3>
          </div>
        </div>

        <div class="underchat-node__header-actions">
          <span v-if="isReadOnly" class="underchat-node__read-only-badge">
            <VIcon icon="tabler-lock" size="12" />
            {{ t('chatbot_underchat_read_only') }}
          </span>
          <VBtn
            v-if="nodeData.onRemove && !isReadOnly"
            class="nodrag"
            icon="tabler-x"
            color="error"
            variant="text"
            size="x-small"
            :aria-label="t('chatbot_underchat_remove')"
            @click.stop="removeNode"
          />
        </div>
      </header>

      <div v-if="isRestricted" class="underchat-node__restricted nodrag">
        <span class="underchat-node__restricted-icon" aria-hidden="true">
          <VIcon icon="tabler-shield-lock" size="22" />
        </span>
        <div>
          <strong>{{ t('chatbot_underchat_restricted_title') }}</strong>
          <p>{{ t('chatbot_underchat_restricted_description') }}</p>
        </div>
      </div>

      <div v-else class="underchat-node__body nodrag">
        <VSelect
          v-model="lookupType"
          :items="lookupTypeOptions"
          :label="t('chatbot_underchat_lookup_type')"
          :disabled="isReadOnly"
          variant="outlined"
          density="compact"
          hide-details
        />

        <div class="underchat-node__lookup-field">
          <label class="underchat-node__field-label" :for="lookupInputId">
            {{ t('chatbot_underchat_lookup_value') }}
          </label>
          <ApiVariableField
            :id="lookupInputId"
            v-model="lookupExpression"
            class="underchat-node__lookup-control"
            :variables="availableVariables"
            :placeholder="lookupPlaceholder"
            :hint="lookupHint"
            :rules="lookupRules"
            :readonly="isReadOnly"
            persistent-hint
            monospace
            hide-details="auto"
          />
        </div>

        <CapturableOutputStrip
          v-if="outputTags.length"
          :title="t('chatbot_underchat_output_title')"
          :description="t('chatbot_underchat_output_description')"
          :tags="outputTags"
          :copy-label="t('chatbot_captured_output_copy')"
          :copied-label="t('chatbot_captured_output_copied')"
        />
      </div>

      <footer
        class="underchat-node__routes"
        :aria-label="t('chatbot_underchat_routes')"
      >
        <span class="underchat-node__route underchat-node__route--found">
          <i />
          {{ t('chatbot_underchat_found') }}
        </span>
        <span class="underchat-node__route underchat-node__route--not-found">
          {{ t('chatbot_underchat_not_found') }}
          <i />
        </span>
      </footer>
    </VCard>

    <Handle
      id="found"
      type="source"
      :position="Position.Bottom"
      :connectable="!isReadOnly"
      class="underchat-node__handle underchat-node__handle--found handle-source"
    />
    <Handle
      id="not_found"
      type="source"
      :position="Position.Bottom"
      :connectable="!isReadOnly"
      class="underchat-node__handle underchat-node__handle--not-found handle-source"
    />
  </div>
</template>

<style scoped>
.underchat-node {
  position: relative;
  inline-size: 370px;
}

.underchat-node__card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-info), 0.24);
  border-radius: 13px;
  background: rgb(var(--v-theme-surface));
  box-shadow:
    0 12px 28px rgba(20, 46, 77, 0.11),
    0 2px 6px rgba(20, 46, 77, 0.06) !important;
}

.underchat-node__card::before {
  position: absolute;
  block-size: 3px;
  background: linear-gradient(
    90deg,
    rgb(var(--v-theme-info)),
    rgb(var(--v-theme-primary))
  );
  content: '';
  inset-block-start: 0;
  inset-inline: 0;
}

.underchat-node__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-block-size: 56px;
  padding: 10px 11px 9px 12px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.64);
  background: linear-gradient(
    105deg,
    rgba(var(--v-theme-info), 0.08),
    transparent 62%
  );
  cursor: grab;
  user-select: none;
}

.underchat-node__header:active {
  cursor: grabbing;
}

.underchat-node__identity,
.underchat-node__header-actions,
.underchat-node__routes,
.underchat-node__route {
  display: flex;
  align-items: center;
}

.underchat-node__identity {
  gap: 9px;
  min-inline-size: 0;
}

.underchat-node__header-actions {
  gap: 4px;
}

.underchat-node__icon {
  display: grid;
  flex: 0 0 auto;
  block-size: 34px;
  inline-size: 34px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-info), 0.22);
  border-radius: 9px;
  background: rgba(var(--v-theme-info), 0.1);
  color: rgb(var(--v-theme-info));
}

.underchat-node__eyebrow {
  display: block;
  color: rgb(var(--v-theme-info));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.5rem;
  font-weight: 850;
  letter-spacing: 0.12em;
  line-height: 1.2;
}

.underchat-node__title {
  margin-block-start: 2px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.8125rem;
  font-weight: 760;
  line-height: 1.25;
}

.underchat-node__read-only-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  border: 1px solid rgba(var(--v-theme-warning), 0.24);
  border-radius: 999px;
  background: rgba(var(--v-theme-warning), 0.09);
  color: rgb(var(--v-theme-warning));
  font-size: 0.5rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.underchat-node__body {
  display: grid;
  gap: 11px;
  padding: 12px;
}

.underchat-node__lookup-field {
  display: grid;
  gap: 5px;
  min-inline-size: 0;
}

.underchat-node__field-label {
  margin-inline: 3px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.625rem;
  font-weight: 650;
  line-height: 1.2;
}

.underchat-node__lookup-control {
  min-inline-size: 0;
}

.underchat-node__lookup-control :deep(.v-field__input) {
  min-inline-size: 0;
  padding-inline-start: 12px;
}

.underchat-node__lookup-control :deep(input) {
  min-inline-size: 0;
  text-overflow: ellipsis;
}

.underchat-node__restricted {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 10px;
  margin: 12px;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-warning), 0.22);
  border-radius: 10px;
  background: rgba(var(--v-theme-warning), 0.07);
}

.underchat-node__restricted-icon {
  display: grid;
  block-size: 38px;
  inline-size: 38px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}

.underchat-node__restricted strong {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-size: 0.75rem;
}

.underchat-node__restricted p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.65625rem;
  line-height: 1.4;
}

.underchat-node__routes {
  justify-content: space-between;
  min-block-size: 35px;
  padding: 7px 24px 8px;
  border-block-start: 1px solid rgba(var(--v-border-color), 0.6);
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.underchat-node__route {
  gap: 5px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.5625rem;
  font-weight: 750;
  letter-spacing: 0.025em;
  text-transform: uppercase;
}

.underchat-node__route i {
  display: block;
  block-size: 6px;
  inline-size: 6px;
  border-radius: 50%;
}

.underchat-node__route--found i {
  background: rgb(var(--v-theme-success));
}

.underchat-node__route--not-found i {
  background: rgb(var(--v-theme-error));
}

.underchat-node__handle {
  block-size: 12px;
  inline-size: 12px;
  border: 2px solid rgb(var(--v-theme-surface));
}

.underchat-node__handle--target {
  background: rgb(var(--v-theme-success));
}

.underchat-node__handle--found {
  left: 25%;
  background: rgb(var(--v-theme-success));
}

.underchat-node__handle--not-found {
  left: 75%;
  background: rgb(var(--v-theme-error));
}

.underchat-node--read-only .underchat-node__header {
  cursor: default;
}

.underchat-node--restricted .underchat-node__card {
  border-color: rgba(var(--v-theme-warning), 0.24);
}
</style>
