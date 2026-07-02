<script setup lang="ts">
import type {
  IOfficialTemplateComponent,
  IOfficialTemplateVariable,
  IOfficialWhatsappTemplateMessage,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';
import type { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';
import {
  buildOfficialTemplateKey,
  buildOfficialTemplatePreview,
  buildOfficialTemplateVariablePayload,
  createManualOfficialTemplateVariable,
  createOfficialTemplateOptions,
  findOfficialTemplate,
  formatOfficialTemplateLanguage,
  refreshOfficialTemplateVariableKey,
  type OfficialTemplate,
  type OfficialTemplateVariableValue,
} from '@/utils/officialTemplate';

interface AvailableTag {
  tag: string;
  description: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: IOfficialWhatsappTemplateMessage | null;
    templates: OfficialTemplatesResponse;
    loading?: boolean;
    error?: string | null;
    availableTags: AvailableTag[];
  }>(),
  {
    loading: false,
    error: null,
  }
);

const emit = defineEmits<{
  (
    event: 'update:modelValue',
    value: IOfficialWhatsappTemplateMessage | null
  ): void;
  (event: 'valid-change', value: boolean): void;
}>();

const { locale, t } = useI18n();

const selectedTemplateKey = ref<string | null>(null);
const variableValues = ref<Record<string, string>>({});
const manualVariables = ref<OfficialTemplateVariableValue[]>([]);
const isHydratingFromModel = ref(false);
const skipNextTemplateKeyReset = ref(false);
const lastEmittedPayloadJson = ref<string | null>(null);

const collectVariablesFromComponents = (
  components?: IOfficialTemplateComponent[]
): IOfficialTemplateVariable[] => {
  const variables: IOfficialTemplateVariable[] = [];

  for (const component of components ?? []) {
    variables.push(...(component.variables ?? []));
    for (const button of component.buttons ?? []) {
      variables.push(...(button.variables ?? []));
    }
  }

  return variables;
};

const templateFromModel = computed<OfficialTemplate | null>(() => {
  const template = props.modelValue;
  if (!template?.name || !template.language) {
    return null;
  }

  const components = template.components ?? [];

  return {
    id: null,
    name: template.name,
    language: template.language,
    status: 'APPROVED',
    category: template.category ?? null,
    components,
    variables: collectVariablesFromComponents(components),
    preview: template.preview ?? {},
  };
});

const templateOptions = computed(() =>
  createOfficialTemplateOptions(props.templates, locale.value)
);

const selectedTemplate = computed<OfficialTemplate | null>(() => {
  const template = findOfficialTemplate(
    props.templates,
    selectedTemplateKey.value
  );
  return template ?? templateFromModel.value;
});

const selectedLanguageLabel = computed(() =>
  selectedTemplate.value
    ? formatOfficialTemplateLanguage(
        selectedTemplate.value.language,
        locale.value
      )
    : ''
);

const detectedVariableRows = computed(
  () => selectedTemplate.value?.variables ?? []
);
const hasDetectedVariables = computed(
  () => detectedVariableRows.value.length > 0
);
const variableRows = computed<IOfficialTemplateVariable[]>(() =>
  hasDetectedVariables.value
    ? detectedVariableRows.value
    : manualVariables.value
);
const formatVariableLabel = (
  variable: Pick<IOfficialTemplateVariable, 'component_type' | 'index'>
) => `${variable.component_type} {{${variable.index}}}`;
const areVariablesValid = computed(() =>
  variableRows.value.every((variable) =>
    variableValues.value[variable.key]?.trim()
  )
);
const selectedVariableValues = computed<OfficialTemplateVariableValue[]>(() =>
  hasDetectedVariables.value
    ? buildOfficialTemplateVariablePayload(
        detectedVariableRows.value,
        variableValues.value
      )
    : manualVariables.value.map((variable) => ({
        key: variable.key,
        component_type: variable.component_type,
        index: variable.index,
        button_index: variable.button_index ?? null,
        value: variableValues.value[variable.key]?.trim() ?? '',
      }))
);
const selectedPreview = computed(() =>
  buildOfficialTemplatePreview(
    selectedTemplate.value,
    variableValues.value,
    variableRows.value
  )
);
const isValid = computed(
  () => Boolean(selectedTemplate.value) && areVariablesValid.value
);

const hydrateFromModel = () => {
  isHydratingFromModel.value = true;
  const template = props.modelValue;
  const modelJson = JSON.stringify(template ?? null);
  if (modelJson === lastEmittedPayloadJson.value) {
    isHydratingFromModel.value = false;
    return;
  }

  if (!template?.name || !template.language) {
    skipNextTemplateKeyReset.value = true;
    selectedTemplateKey.value = null;
    variableValues.value = {};
    manualVariables.value = [];
    isHydratingFromModel.value = false;
    emit('valid-change', false);
    return;
  }

  skipNextTemplateKeyReset.value = true;
  selectedTemplateKey.value = buildOfficialTemplateKey(
    template as OfficialTemplate
  );
  const values = template.variables ?? [];
  variableValues.value = Object.fromEntries(
    values.map((variable) => [variable.key, variable.value ?? ''])
  );

  const detectedVariables = collectVariablesFromComponents(template.components);
  manualVariables.value =
    detectedVariables.length > 0
      ? []
      : values.map((variable) => ({
          ...variable,
          value: variable.value ?? '',
        }));

  isHydratingFromModel.value = false;
  emit('valid-change', isValid.value);
};

const emitCurrentPayload = () => {
  if (isHydratingFromModel.value) {
    return;
  }

  if (!selectedTemplate.value) {
    lastEmittedPayloadJson.value = JSON.stringify(null);
    emit('update:modelValue', null);
    emit('valid-change', false);
    return;
  }

  const template = selectedTemplate.value;
  const payload: IOfficialWhatsappTemplateMessage = {
    name: template.name,
    language: template.language,
    category: template.category ?? null,
    status: template.status,
    components: template.components,
    preview: template.preview,
    variables: selectedVariableValues.value,
  };

  lastEmittedPayloadJson.value = JSON.stringify(payload);
  emit('update:modelValue', payload);
  emit('valid-change', isValid.value);
};

const addManualVariable = () => {
  const variable = createManualOfficialTemplateVariable(
    manualVariables.value.length
  );
  manualVariables.value = [...manualVariables.value, variable];
  variableValues.value = {
    ...variableValues.value,
    [variable.key]: '',
  };
};

const removeManualVariable = (index: number) => {
  const variable = manualVariables.value[index];
  if (!variable) {
    return;
  }

  const nextValues = { ...variableValues.value };
  delete nextValues[variable.key];
  variableValues.value = nextValues;
  manualVariables.value = manualVariables.value.filter(
    (_, itemIndex) => itemIndex !== index
  );
};

const syncManualVariable = (index: number) => {
  const variable = manualVariables.value[index];
  if (!variable) {
    return;
  }

  const previousKey = variable.key;
  const refreshed = refreshOfficialTemplateVariableKey(variable);
  const previousValue =
    variableValues.value[previousKey] ?? variable.value ?? '';
  manualVariables.value[index] = {
    ...refreshed,
    value: previousValue,
  };

  if (previousKey === refreshed.key) {
    return;
  }

  const nextValues = { ...variableValues.value };
  delete nextValues[previousKey];
  nextValues[refreshed.key] = previousValue;
  variableValues.value = nextValues;
};

watch(
  () => props.modelValue,
  () => hydrateFromModel(),
  { immediate: true, deep: true }
);

watch(selectedTemplateKey, () => {
  if (skipNextTemplateKeyReset.value) {
    skipNextTemplateKeyReset.value = false;
    return;
  }

  if (isHydratingFromModel.value) {
    return;
  }

  variableValues.value = {};
  manualVariables.value = [];
});

watch(
  [selectedTemplate, variableValues, manualVariables],
  () => emitCurrentPayload(),
  { deep: true }
);
</script>

<template>
  <div class="schedule-official-template">
    <VAlert v-if="loading" color="primary" variant="tonal" density="compact">
      {{ t('official_templates_loading') }}
    </VAlert>

    <VAlert v-else-if="error" color="error" variant="tonal" density="compact">
      {{ error }}
    </VAlert>

    <VAlert
      v-else-if="!templates.length"
      color="warning"
      variant="tonal"
      density="compact"
    >
      {{ t('official_templates_empty') }}
    </VAlert>

    <div class="mt-3">
      <VLabel class="text-body-2 mb-1">
        {{ t('official_template_model') }} *
      </VLabel>
      <AppSelectSearch
        v-model="selectedTemplateKey"
        :items="templateOptions"
        :placeholder="t('select_official_template')"
        item-value="value"
        item-title="title"
        :clearable="false"
      />
    </div>

    <div v-if="selectedTemplate" class="mt-4">
      <div class="schedule-official-template__chips">
        <VChip size="small" color="success" variant="tonal">
          <VIcon size="15" class="me-1">tabler-circle-check</VIcon>
          {{ t('approved') }}
        </VChip>
        <VChip size="small" color="primary" variant="tonal">
          <VIcon size="15" class="me-1">tabler-language</VIcon>
          {{ selectedLanguageLabel }}
        </VChip>
        <VChip
          v-if="selectedTemplate.category"
          size="small"
          color="secondary"
          variant="tonal"
        >
          <VIcon size="15" class="me-1">tabler-tag</VIcon>
          {{ selectedTemplate.category }}
        </VChip>
      </div>

      <div class="schedule-official-template__variables">
        <template v-if="hasDetectedVariables">
          <div
            v-for="variable in variableRows"
            :key="variable.key"
            class="schedule-official-template__variable-field"
          >
            <span class="schedule-official-template__variable-label">
              {{ formatVariableLabel(variable) }}
            </span>
            <VTextField
              v-model="variableValues[variable.key]"
              :placeholder="variable.sample || t('template_variable_value')"
              density="compact"
              variant="outlined"
              hide-details="auto"
            />
          </div>
        </template>

        <template v-else>
          <div class="schedule-official-template__variables-header">
            <span>{{ t('chatbot_message_variables_legend') }}</span>
            <VBtn
              size="small"
              variant="outlined"
              color="primary"
              @click="addManualVariable"
            >
              <VIcon icon="tabler-plus" size="16" class="me-1" />
              {{ t('add') }}
            </VBtn>
          </div>

          <div
            v-for="(variable, variableIndex) in manualVariables"
            :key="`schedule-manual-variable-${variableIndex}`"
            class="schedule-official-template__variable-row"
          >
            <VSelect
              v-model="variable.component_type"
              :items="['HEADER', 'BODY', 'BUTTON']"
              density="compact"
              variant="outlined"
              hide-details
              @update:model-value="syncManualVariable(variableIndex)"
            />
            <VTextField
              v-model.number="variable.index"
              type="number"
              density="compact"
              variant="outlined"
              hide-details
              @update:model-value="syncManualVariable(variableIndex)"
            />
            <VTextField
              v-model="variableValues[variable.key]"
              :placeholder="t('template_variable_value')"
              density="compact"
              variant="outlined"
              hide-details
            />
            <VBtn
              icon
              size="small"
              variant="text"
              color="error"
              @click.stop="removeManualVariable(variableIndex)"
            >
              <VIcon icon="tabler-x" size="16" />
            </VBtn>
          </div>
        </template>
      </div>

      <div v-if="selectedPreview" class="schedule-official-template__preview">
        <div class="schedule-official-template__preview-title">
          <VIcon size="18">tabler-brand-whatsapp</VIcon>
          <span>{{ selectedTemplate.name }}</span>
        </div>
        <div class="schedule-official-template__bubble">
          <div v-if="selectedPreview.header" class="font-weight-medium">
            {{ selectedPreview.header }}
          </div>
          <div class="schedule-official-template__body">
            {{ selectedPreview.body }}
          </div>
          <div
            v-if="selectedPreview.footer"
            class="text-caption text-medium-emphasis"
          >
            {{ selectedPreview.footer }}
          </div>
          <div
            v-if="selectedPreview.buttons.length"
            class="schedule-official-template__buttons"
          >
            <div
              v-for="(button, index) in selectedPreview.buttons"
              :key="`${button}-${index}`"
              class="schedule-official-template__button"
            >
              <VIcon size="15">tabler-click</VIcon>
              <span>{{ button }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <VExpansionPanels variant="accordion" class="mt-3">
      <VExpansionPanel>
        <VExpansionPanelTitle>
          <span class="text-caption">{{ t('available_tags') }}</span>
        </VExpansionPanelTitle>
        <VExpansionPanelText>
          <div class="d-flex flex-column gap-1">
            <div
              v-for="tag in availableTags"
              :key="tag.tag"
              class="text-caption"
            >
              <code>{{ tag.tag }}</code
              >: {{ tag.description }}
            </div>
          </div>
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>
  </div>
</template>

<style scoped>
.schedule-official-template {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 12px;
}

.schedule-official-template__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.schedule-official-template__variables {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.schedule-official-template__variables-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.schedule-official-template__variable-field {
  display: grid;
  gap: 4px;
}

.schedule-official-template__variable-label {
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.1;
}

.schedule-official-template__variable-row {
  display: grid;
  grid-template-columns:
    minmax(92px, 0.6fr) minmax(72px, 0.4fr) minmax(0, 1.7fr)
    auto;
  gap: 8px;
  align-items: center;
}

.schedule-official-template__preview {
  margin-top: 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--v-theme-success), 0.22);
  background: rgba(var(--v-theme-success), 0.08);
  padding: 10px;
}

.schedule-official-template__preview-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--v-theme-success));
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 8px;
}

.schedule-official-template__bubble {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 430px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  padding: 12px;
  white-space: pre-line;
}

.schedule-official-template__body {
  color: rgba(var(--v-theme-on-surface), 0.92);
}

.schedule-official-template__buttons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-top: 6px;
}

.schedule-official-template__button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.85rem;
  font-weight: 600;
}

@media (max-width: 600px) {
  .schedule-official-template__variable-row {
    grid-template-columns: 1fr;
  }
}
</style>
