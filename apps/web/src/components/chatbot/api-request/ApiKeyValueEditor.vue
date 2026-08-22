<script setup lang="ts">
import { computed } from 'vue';
import ApiVariableField from './ApiVariableField.vue';
import {
  createApiRequestKeyValue,
  type ApiRequestKeyValue,
  type ApiRequestVariable,
} from './types';

interface Props {
  title: string;
  description?: string;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  emptyLabel?: string;
  allowSensitive?: boolean;
  variables?: readonly ApiRequestVariable[];
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  description: '',
  keyLabel: 'Chave',
  valueLabel: 'Valor',
  addLabel: 'Adicionar campo',
  emptyLabel: 'Nenhum campo configurado.',
  allowSensitive: true,
  variables: () => [],
  disabled: false,
});
const model = defineModel<ApiRequestKeyValue[]>({ required: true });

const activeCount = computed(
  () => model.value.filter((entry) => entry.enabled && entry.key.trim()).length
);

const addRow = (): void => {
  model.value = [...model.value, createApiRequestKeyValue()];
};

const updateRow = (index: number, patch: Partial<ApiRequestKeyValue>): void => {
  model.value = model.value.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, ...patch } : entry
  );
};

const updateValue = (index: number, value: string): void => {
  updateRow(index, {
    value,
    hasValue: Boolean(value),
  });
};

const removeRow = (index: number): void => {
  model.value = model.value.filter((_, entryIndex) => entryIndex !== index);
};
</script>

<template>
  <section class="kv-editor">
    <header class="kv-editor__header">
      <div>
        <div class="kv-editor__title-line">
          <h4 class="kv-editor__title">{{ props.title }}</h4>
          <span v-if="activeCount" class="kv-editor__count">
            {{ activeCount }} ativo{{ activeCount === 1 ? '' : 's' }}
          </span>
        </div>
        <p v-if="props.description" class="kv-editor__description">
          {{ props.description }}
        </p>
      </div>

      <VBtn
        color="primary"
        variant="text"
        size="small"
        :disabled="props.disabled"
        @click="addRow"
      >
        <VIcon icon="tabler-plus" size="17" class="me-1" />
        {{ props.addLabel }}
      </VBtn>
    </header>

    <div v-if="model.length" class="kv-editor__rows">
      <div class="kv-editor__column-labels" aria-hidden="true">
        <span>Ativo</span>
        <span>{{ props.keyLabel }}</span>
        <span>{{ props.valueLabel }}</span>
        <span>Ações</span>
      </div>

      <div
        v-for="(entry, index) in model"
        :key="entry.id"
        class="kv-editor__row"
        :class="{ 'kv-editor__row--disabled': !entry.enabled }"
      >
        <div class="kv-editor__enabled">
          <VCheckboxBtn
            :model-value="entry.enabled"
            :disabled="props.disabled"
            density="compact"
            :aria-label="entry.enabled ? 'Desativar campo' : 'Ativar campo'"
            @update:model-value="updateRow(index, { enabled: Boolean($event) })"
          />
        </div>

        <VTextField
          :model-value="entry.key"
          class="kv-editor__key-field"
          :placeholder="props.keyLabel"
          :disabled="props.disabled"
          variant="outlined"
          density="compact"
          hide-details
          @update:model-value="updateRow(index, { key: $event ?? '' })"
        />

        <ApiVariableField
          :model-value="entry.value"
          class="kv-editor__value-field"
          :variables="props.variables"
          :placeholder="
            entry.hasValue && !entry.value ? '••••••••' : props.valueLabel
          "
          :type="entry.sensitive ? 'password' : 'text'"
          :disabled="props.disabled"
          monospace
          hide-details
          @update:model-value="updateValue(index, $event)"
        />

        <div class="kv-editor__actions">
          <VTooltip v-if="props.allowSensitive" location="top">
            <template #activator="{ props: tooltipProps }">
              <VBtn
                v-bind="tooltipProps"
                :icon="entry.sensitive ? 'tabler-lock' : 'tabler-lock-open'"
                :color="entry.sensitive ? 'warning' : 'secondary'"
                :disabled="props.disabled"
                variant="text"
                size="small"
                @click="updateRow(index, { sensitive: !entry.sensitive })"
              />
            </template>
            {{ entry.sensitive ? 'Valor protegido' : 'Marcar como protegido' }}
          </VTooltip>

          <VBtn
            icon="tabler-trash"
            color="error"
            :disabled="props.disabled"
            variant="text"
            size="small"
            aria-label="Remover campo"
            @click="removeRow(index)"
          />
        </div>
      </div>
    </div>

    <button
      v-else
      type="button"
      class="kv-editor__empty"
      :disabled="props.disabled"
      @click="addRow"
    >
      <span class="kv-editor__empty-icon" aria-hidden="true">
        <VIcon icon="tabler-list-details" size="19" />
      </span>
      <span>{{ props.emptyLabel }}</span>
      <span class="kv-editor__empty-action">Adicionar o primeiro</span>
    </button>
  </section>
</template>

<style scoped>
.kv-editor {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.kv-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-block-size: 58px;
  padding: 12px 14px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.kv-editor__title-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.kv-editor__title {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.015em;
  line-height: 1.35;
}

.kv-editor__count {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(var(--v-theme-info), 0.11);
  color: rgb(var(--v-theme-info));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.65rem;
  font-weight: 700;
}

.kv-editor__description {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.75rem;
  line-height: 1.4;
}

.kv-editor__rows {
  padding: 8px;
  overflow-x: auto;
}

.kv-editor__column-labels,
.kv-editor__row {
  display: grid;
  grid-template-columns:
    46px minmax(160px, 0.8fr) minmax(240px, 1.2fr)
    76px;
  align-items: center;
  gap: 8px;
  min-inline-size: 640px;
}

.kv-editor__column-labels {
  padding: 0 6px 5px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.kv-editor__column-labels > :first-child {
  text-align: center;
}

.kv-editor__column-labels > :last-child {
  text-align: end;
}

.kv-editor__row {
  padding: 5px 6px;
  border-radius: 8px;
  transition:
    background-color 160ms ease,
    opacity 160ms ease;
}

.kv-editor__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}

.kv-editor__row--disabled {
  opacity: 0.52;
}

.kv-editor__enabled {
  display: grid;
  block-size: 40px;
  place-items: center;
}

.kv-editor__key-field,
.kv-editor__value-field {
  min-inline-size: 0;
}

.kv-editor__key-field :deep(.v-field),
.kv-editor__value-field :deep(.v-field) {
  min-block-size: 40px;
}

.kv-editor__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  inline-size: 76px;
}

.kv-editor__empty {
  display: flex;
  align-items: center;
  gap: 10px;
  inline-size: 100%;
  padding: 16px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.56);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  text-align: start;
}

.kv-editor__empty:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.035);
}

.kv-editor__empty-icon {
  display: grid;
  block-size: 32px;
  inline-size: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}

.kv-editor__empty-action {
  margin-inline-start: auto;
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}

@media (max-width: 720px) {
  .kv-editor__header {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }

  .kv-editor__header .v-btn {
    align-self: flex-start;
  }

  .kv-editor__column-labels,
  .kv-editor__row {
    min-inline-size: 600px;
  }
}
</style>
