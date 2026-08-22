<script setup lang="ts">
import { computed, nextTick, useAttrs, useTemplateRef } from 'vue';
import type { ApiRequestVariable } from './types';
import { insertVariableAtSelection } from './variableInsertion';

defineOptions({ inheritAttrs: false });

interface Props {
  label?: string;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  readonly?: boolean;
  clearable?: boolean;
  hint?: string;
  persistentHint?: boolean;
  variables?: readonly ApiRequestVariable[];
  monospace?: boolean;
  insertVariableTitle?: string;
  variablesLabel?: string;
}

interface Emits {
  variableInserted: [tag: string];
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  placeholder: '',
  type: 'text',
  multiline: false,
  rows: 4,
  disabled: false,
  readonly: false,
  clearable: false,
  hint: '',
  persistentHint: false,
  variables: () => [],
  monospace: false,
  insertVariableTitle: 'Inserir variável',
  variablesLabel: 'Variáveis disponíveis',
});
const emit = defineEmits<Emits>();
const model = defineModel<string>({ required: true });
const attrs = useAttrs();
const fieldRef = useTemplateRef<{ $el?: HTMLElement }>('fieldRef');

const sortedVariables = computed(() =>
  [...props.variables].sort((left, right) =>
    (left.label ?? left.tag).localeCompare(right.label ?? right.tag)
  )
);

const fieldClasses = computed(() => ({
  'api-variable-field': true,
  'api-variable-field--code': props.monospace,
}));

const updateValue = (value: string | null): void => {
  model.value = value ?? '';
};

const insertVariable = (tag: string): void => {
  const input = fieldRef.value?.$el?.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >('input, textarea');
  const insertion = insertVariableAtSelection({
    value: model.value,
    tag,
    selectionStart: input?.selectionStart,
    selectionEnd: input?.selectionEnd,
    withSpacing: !props.monospace,
  });
  model.value = insertion.value;
  void nextTick(() => {
    const currentInput = fieldRef.value?.$el?.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >('input, textarea');
    currentInput?.focus();
    currentInput?.setSelectionRange(insertion.cursor, insertion.cursor);
  });
  emit('variableInserted', tag);
};
</script>

<template>
  <VTextarea
    v-if="props.multiline"
    ref="fieldRef"
    v-bind="attrs"
    :model-value="model"
    :class="fieldClasses"
    :label="props.label"
    :placeholder="props.placeholder"
    :rows="props.rows"
    :disabled="props.disabled"
    :readonly="props.readonly"
    :clearable="props.clearable"
    :hint="props.hint"
    :persistent-hint="props.persistentHint"
    variant="outlined"
    density="compact"
    auto-grow
    @update:model-value="updateValue"
  >
    <template v-if="sortedVariables.length" #append-inner>
      <VMenu :close-on-content-click="true" location="bottom end">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            class="api-variable-field__trigger nodrag nopan"
            icon="tabler-braces"
            variant="text"
            size="small"
            :title="props.insertVariableTitle"
            :aria-label="props.insertVariableTitle"
            @click.stop
          />
        </template>
        <VList class="api-variable-field__menu" density="compact">
          <VListSubheader>{{ props.variablesLabel }}</VListSubheader>
          <VListItem
            v-for="variable in sortedVariables"
            :key="variable.tag"
            :title="variable.label || variable.tag"
            :subtitle="variable.description || variable.tag"
            @mousedown.prevent
            @click="insertVariable(variable.tag)"
          >
            <template #prepend>
              <VIcon icon="tabler-braces" size="17" color="info" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
    </template>
  </VTextarea>

  <VTextField
    v-else
    ref="fieldRef"
    v-bind="attrs"
    :model-value="model"
    :class="fieldClasses"
    :label="props.label"
    :placeholder="props.placeholder"
    :type="props.type"
    :disabled="props.disabled"
    :readonly="props.readonly"
    :clearable="props.clearable"
    :hint="props.hint"
    :persistent-hint="props.persistentHint"
    variant="outlined"
    density="compact"
    @update:model-value="updateValue"
  >
    <template v-if="sortedVariables.length" #append-inner>
      <VMenu :close-on-content-click="true" location="bottom end">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            class="api-variable-field__trigger nodrag nopan"
            icon="tabler-braces"
            variant="text"
            size="small"
            :title="props.insertVariableTitle"
            :aria-label="props.insertVariableTitle"
            @click.stop
          />
        </template>
        <VList class="api-variable-field__menu" density="compact">
          <VListSubheader>{{ props.variablesLabel }}</VListSubheader>
          <VListItem
            v-for="variable in sortedVariables"
            :key="variable.tag"
            :title="variable.label || variable.tag"
            :subtitle="variable.description || variable.tag"
            @mousedown.prevent
            @click="insertVariable(variable.tag)"
          >
            <template #prepend>
              <VIcon icon="tabler-braces" size="17" color="info" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
    </template>
  </VTextField>
</template>

<style scoped>
.api-variable-field {
  min-width: 0;
}

.api-variable-field--code :deep(input),
.api-variable-field--code :deep(textarea) {
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.8125rem;
}

.api-variable-field__trigger {
  color: rgb(var(--v-theme-info));
  opacity: 0.82;
}

.api-variable-field__menu {
  max-block-size: 320px;
  max-inline-size: 360px;
  min-inline-size: 280px;
  overflow-y: auto;
}
</style>
