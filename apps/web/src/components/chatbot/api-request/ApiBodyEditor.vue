<script setup lang="ts">
import { computed } from 'vue';
import ApiKeyValueEditor from './ApiKeyValueEditor.vue';
import ApiVariableField from './ApiVariableField.vue';
import {
  createApiRequestMultipartPart,
  type ApiRequestBodyConfig,
  type ApiRequestBodyType,
  type ApiRequestMethod,
  type ApiRequestMultipartPart,
  type ApiRequestVariable,
} from './types';

interface Props {
  method: ApiRequestMethod;
  variables?: readonly ApiRequestVariable[];
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variables: () => [],
  disabled: false,
});
const model = defineModel<ApiRequestBodyConfig>({ required: true });

const bodyTypes: Array<{
  value: ApiRequestBodyType;
  label: string;
  icon: string;
}> = [
  { value: 'none', label: 'Sem body', icon: 'tabler-ban' },
  { value: 'json', label: 'JSON', icon: 'tabler-braces' },
  { value: 'raw', label: 'Raw', icon: 'tabler-code' },
  {
    value: 'formUrlEncoded',
    label: 'Form URL encoded',
    icon: 'tabler-list-details',
  },
  { value: 'multipart', label: 'Multipart', icon: 'tabler-paperclip' },
];

const methodAllowsBody = computed(() =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(props.method)
);

const jsonError = computed(() => {
  if (model.value.type !== 'json' || !model.value.json.trim()) return null;
  try {
    const withQuotedVariables = model.value.json
      .replaceAll(/"\s*\{\{[^{}]+\}\}\s*"/g, '"__VARIABLE__"')
      .replaceAll(/\{\{[^{}]+\}\}/g, '"__VARIABLE__"');
    JSON.parse(withQuotedVariables);
    return null;
  } catch {
    return 'O conteúdo precisa ser um JSON válido antes da execução.';
  }
});

const updateBody = (patch: Partial<ApiRequestBodyConfig>): void => {
  model.value = { ...model.value, ...patch };
};

const updateType = (value: ApiRequestBodyType): void => {
  updateBody({ type: value });
};

const updateTextContent = (key: 'json' | 'raw', value: string): void => {
  updateBody({
    [key]: value,
    hasValue: Boolean(value),
  });
};

const addMultipartPart = (): void => {
  updateBody({
    multipart: [...model.value.multipart, createApiRequestMultipartPart()],
  });
};

const updateMultipartPart = (
  index: number,
  patch: Partial<ApiRequestMultipartPart>
): void => {
  updateBody({
    multipart: model.value.multipart.map((part, partIndex) =>
      partIndex === index ? { ...part, ...patch } : part
    ),
  });
};

const updateMultipartValue = (index: number, value: string): void => {
  updateMultipartPart(index, { value, hasValue: Boolean(value) });
};

const removeMultipartPart = (index: number): void => {
  updateBody({
    multipart: model.value.multipart.filter(
      (_, partIndex) => partIndex !== index
    ),
  });
};
</script>

<template>
  <section class="body-editor">
    <header class="body-editor__header">
      <div class="body-editor__heading">
        <h4 class="body-editor__title">Corpo da requisição</h4>
        <p class="body-editor__description">
          O body é serializado conforme o formato selecionado.
        </p>
      </div>
      <span class="body-editor__method">{{ props.method }}</span>
    </header>

    <div class="body-editor__body">
      <VAlert
        v-if="!methodAllowsBody"
        color="info"
        variant="tonal"
        density="compact"
        icon="tabler-info-circle"
      >
        O método {{ props.method }} será enviado sem corpo.
      </VAlert>

      <template v-else>
        <div
          class="body-editor__types"
          role="group"
          aria-label="Formato do corpo da requisição"
        >
          <button
            v-for="bodyType in bodyTypes"
            :key="bodyType.value"
            type="button"
            class="body-editor__type-button"
            :class="{
              'body-editor__type-button--active': model.type === bodyType.value,
            }"
            :aria-pressed="model.type === bodyType.value"
            :disabled="props.disabled"
            @click="updateType(bodyType.value)"
          >
            <span class="body-editor__type-icon" aria-hidden="true">
              <VIcon :icon="bodyType.icon" size="16" />
            </span>
            <span class="body-editor__type-label">{{ bodyType.label }}</span>
          </button>
        </div>

        <div v-if="model.type === 'none'" class="body-editor__empty">
          <VIcon icon="tabler-package-off" size="18" />
          Nenhum conteúdo será enviado nesta requisição.
        </div>

        <div v-else-if="model.type === 'json'" class="body-editor__content">
          <div class="body-editor__content-toolbar">
            <span class="body-editor__content-type">application/json</span>
            <VSwitch
              :model-value="model.sensitive"
              class="body-editor__sensitive-toggle"
              :disabled="props.disabled"
              label="Proteger conteúdo estático"
              color="warning"
              density="compact"
              hide-details
              @update:model-value="updateBody({ sensitive: Boolean($event) })"
            />
          </div>
          <ApiVariableField
            :model-value="model.json"
            :variables="props.variables"
            :disabled="props.disabled"
            :placeholder="
              model.hasValue && !model.json
                ? 'Conteúdo protegido já configurado'
                : '{\n  &quot;customer_id&quot;: &quot;{{ contact.id }}&quot;\n}'
            "
            multiline
            :rows="8"
            monospace
            hide-details
            @update:model-value="updateTextContent('json', $event)"
          />
          <p v-if="jsonError" class="body-editor__error">
            <VIcon icon="tabler-alert-triangle" size="15" />
            {{ jsonError }}
          </p>
        </div>

        <div v-else-if="model.type === 'raw'" class="body-editor__content">
          <div class="body-editor__raw-settings">
            <VTextField
              :model-value="model.contentType"
              class="body-editor__content-type-field"
              :disabled="props.disabled"
              label="Content-Type"
              placeholder="text/plain"
              variant="outlined"
              density="compact"
              hide-details
              @update:model-value="updateBody({ contentType: $event ?? '' })"
            />
            <VSwitch
              :model-value="model.sensitive"
              class="body-editor__sensitive-toggle"
              :disabled="props.disabled"
              label="Proteger conteúdo estático"
              color="warning"
              density="compact"
              hide-details
              @update:model-value="updateBody({ sensitive: Boolean($event) })"
            />
          </div>
          <ApiVariableField
            :model-value="model.raw"
            :variables="props.variables"
            :disabled="props.disabled"
            :placeholder="
              model.hasValue && !model.raw
                ? 'Conteúdo protegido já configurado'
                : 'Conteúdo raw ou {{ variavel }}'
            "
            multiline
            :rows="7"
            monospace
            hide-details
            @update:model-value="updateTextContent('raw', $event)"
          />
        </div>

        <ApiKeyValueEditor
          v-else-if="model.type === 'formUrlEncoded'"
          :model-value="model.formFields"
          :variables="props.variables"
          :disabled="props.disabled"
          title="Campos do formulário"
          description="Enviados como application/x-www-form-urlencoded."
          key-label="Nome"
          add-label="Adicionar campo"
          @update:model-value="updateBody({ formFields: $event })"
        />

        <section v-else class="multipart-editor">
          <header class="multipart-editor__header">
            <div class="multipart-editor__heading">
              <h5 class="multipart-editor__title">Partes multipart</h5>
              <p class="multipart-editor__description">
                Arquivos devem vir de uma variável upstream.
              </p>
            </div>
            <VBtn
              class="multipart-editor__add-button"
              color="primary"
              variant="text"
              size="small"
              :disabled="props.disabled"
              @click="addMultipartPart"
            >
              <VIcon icon="tabler-plus" size="17" class="me-1" />
              Adicionar parte
            </VBtn>
          </header>

          <div v-if="model.multipart.length" class="multipart-editor__rows">
            <div
              v-for="(part, index) in model.multipart"
              :key="part.id"
              class="multipart-editor__row"
              :class="{ 'multipart-editor__row--disabled': !part.enabled }"
            >
              <div class="multipart-editor__row-head">
                <VCheckboxBtn
                  :model-value="part.enabled"
                  class="multipart-editor__enabled"
                  :disabled="props.disabled"
                  :aria-label="
                    part.enabled ? 'Desativar parte' : 'Ativar parte'
                  "
                  @update:model-value="
                    updateMultipartPart(index, { enabled: Boolean($event) })
                  "
                />
                <VBtnToggle
                  :model-value="part.type"
                  class="multipart-editor__part-types"
                  color="primary"
                  variant="outlined"
                  density="compact"
                  mandatory
                  :disabled="props.disabled"
                  @update:model-value="
                    updateMultipartPart(index, { type: $event })
                  "
                >
                  <VBtn value="text" size="x-small">Texto</VBtn>
                  <VBtn value="file" size="x-small">Arquivo</VBtn>
                </VBtnToggle>
                <VBtn
                  class="multipart-editor__remove"
                  icon="tabler-trash"
                  color="error"
                  variant="text"
                  size="small"
                  :disabled="props.disabled"
                  aria-label="Remover parte"
                  @click="removeMultipartPart(index)"
                />
              </div>

              <div class="multipart-editor__grid">
                <VTextField
                  :model-value="part.name"
                  class="multipart-editor__field"
                  :disabled="props.disabled"
                  label="Nome do campo"
                  placeholder="file"
                  persistent-placeholder
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="
                    updateMultipartPart(index, { name: $event ?? '' })
                  "
                />
                <ApiVariableField
                  :model-value="part.value"
                  class="multipart-editor__field"
                  :variables="props.variables"
                  :disabled="props.disabled"
                  :type="part.sensitive ? 'password' : 'text'"
                  :label="
                    part.type === 'file' ? 'Variável do arquivo' : 'Valor'
                  "
                  :placeholder="
                    part.type === 'file'
                      ? '{{ api_1.data.document }}'
                      : 'Valor ou variável'
                  "
                  persistent-placeholder
                  monospace
                  hide-details
                  @update:model-value="updateMultipartValue(index, $event)"
                />
                <VTextField
                  v-if="part.type === 'file'"
                  :model-value="part.fileName"
                  class="multipart-editor__field"
                  :disabled="props.disabled"
                  label="Nome do arquivo (opcional)"
                  placeholder="documento.pdf"
                  persistent-placeholder
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="
                    updateMultipartPart(index, { fileName: $event ?? '' })
                  "
                />
                <VTextField
                  v-if="part.type === 'file'"
                  :model-value="part.contentType"
                  class="multipart-editor__field"
                  :disabled="props.disabled"
                  label="MIME (opcional)"
                  placeholder="application/pdf"
                  persistent-placeholder
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="
                    updateMultipartPart(index, { contentType: $event ?? '' })
                  "
                />
              </div>
            </div>
          </div>

          <button
            v-else
            type="button"
            class="multipart-editor__empty"
            :disabled="props.disabled"
            @click="addMultipartPart"
          >
            <VIcon icon="tabler-paperclip" size="18" />
            Adicione texto ou um arquivo vindo de variável.
          </button>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped>
.body-editor {
  container-name: api-body-editor;
  container-type: inline-size;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.body-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.7);
  background: linear-gradient(
    100deg,
    rgba(var(--v-theme-info), 0.04),
    transparent 55%
  );
}

.body-editor__heading,
.multipart-editor__heading {
  min-inline-size: 0;
}

.body-editor__title,
.multipart-editor__title {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.015em;
}

.body-editor__description,
.multipart-editor__description {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.75rem;
  line-height: 1.4;
}

.body-editor__method {
  padding: 4px 8px;
  border: 1px solid rgba(var(--v-theme-info), 0.22);
  border-radius: 6px;
  background: rgba(var(--v-theme-info), 0.08);
  color: rgb(var(--v-theme-info));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.body-editor__body {
  display: grid;
  gap: 14px;
  padding: 14px;
}

.body-editor__types {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
  inline-size: 100%;
  padding: 4px;
  border: 1px solid rgba(var(--v-border-color), 0.74);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.body-editor__type-button {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-block-size: 42px;
  min-inline-size: 0;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.62);
  cursor: pointer;
  font: inherit;
  text-align: start;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.body-editor__type-button:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.14);
  background: rgba(var(--v-theme-primary), 0.045);
  color: rgba(var(--v-theme-on-surface), 0.86);
}

.body-editor__type-button:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.72);
  outline-offset: 2px;
}

.body-editor__type-button:disabled {
  cursor: default;
  opacity: 0.52;
}

.body-editor__type-button--active {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 1px 4px rgba(var(--v-theme-primary), 0.08);
}

.body-editor__type-icon {
  display: grid;
  block-size: 26px;
  inline-size: 26px;
  place-items: center;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.045);
}

.body-editor__type-button--active .body-editor__type-icon {
  background: rgba(var(--v-theme-primary), 0.12);
}

.body-editor__type-label {
  min-inline-size: 0;
  font-size: 0.6875rem;
  font-weight: 720;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.body-editor__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  min-block-size: 44px;
  padding: 10px 12px;
  border: 1px dashed rgba(var(--v-border-color), 0.9);
  border-radius: 9px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.75rem;
  line-height: 1.4;
}

.body-editor__content {
  display: grid;
  gap: 10px;
}

.body-editor__content-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
}

.body-editor__raw-settings {
  display: grid;
  grid-template-columns: minmax(180px, 360px) minmax(220px, 1fr);
  align-items: center;
  gap: 16px;
}

.body-editor__content-type {
  min-inline-size: 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.body-editor__content-type-field,
.body-editor__sensitive-toggle {
  min-inline-size: 0;
}

.body-editor__sensitive-toggle {
  justify-self: end;
  max-inline-size: 100%;
}

.body-editor__sensitive-toggle :deep(.v-selection-control) {
  min-block-size: 40px;
}

.body-editor__sensitive-toggle :deep(.v-label) {
  line-height: 1.25;
  white-space: normal;
}

.body-editor__error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: rgb(var(--v-theme-error));
  font-size: 0.6875rem;
}

.multipart-editor {
  border: 1px solid rgba(var(--v-border-color), 0.72);
  border-radius: 10px;
  overflow: hidden;
}

.multipart-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.65);
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.multipart-editor__add-button {
  flex: 0 0 auto;
}

.multipart-editor__rows {
  display: grid;
  gap: 8px;
  padding: 8px;
}

.multipart-editor__row {
  padding: 10px;
  border: 1px solid rgba(var(--v-border-color), 0.7);
  border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.012);
}

.multipart-editor__row--disabled {
  opacity: 0.52;
}

.multipart-editor__row-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-block-end: 10px;
}

.multipart-editor__part-types {
  margin-inline-end: auto;
  max-inline-size: calc(100% - 80px);
  overflow-x: auto;
}

.multipart-editor
  .multipart-editor__part-types
  :deep(.v-btn.v-btn--density-compact) {
  inline-size: auto !important;
  min-inline-size: 72px;
  padding-inline: 10px;
}

.multipart-editor__enabled,
.multipart-editor__remove {
  flex: 0 0 auto;
}

.multipart-editor__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.multipart-editor__field {
  min-inline-size: 0;
}

.multipart-editor__field :deep(.v-label) {
  max-inline-size: calc(100% - 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.multipart-editor__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  inline-size: 100%;
  padding: 18px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
}

.multipart-editor__empty:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.035);
  color: rgb(var(--v-theme-primary));
}

@container api-body-editor (max-width: 720px) {
  .body-editor__types {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .body-editor__type-button {
    grid-column: span 2;
  }

  .body-editor__type-button:nth-child(4),
  .body-editor__type-button:nth-child(5) {
    grid-column: span 3;
  }

  .body-editor__raw-settings,
  .body-editor__content-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .body-editor__sensitive-toggle {
    justify-self: start;
  }

  .multipart-editor__header {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }

  .multipart-editor__add-button {
    align-self: flex-start;
  }

  .multipart-editor__grid {
    grid-template-columns: 1fr;
  }
}

@container api-body-editor (max-width: 480px) {
  .body-editor__types {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .body-editor__type-button {
    grid-column: auto;
  }

  .body-editor__type-button:last-child {
    grid-column: 1 / -1;
  }
}
</style>
