<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import {
  formatApiVariableTag,
  type ApiRequestCaptureConfig,
  type ApiRequestValueType,
  type ApiResponseContractField,
} from './types';

interface Props {
  outputKey: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});
const model = defineModel<ApiRequestCaptureConfig>({ required: true });

const search = shallowRef('');
const copiedTag = shallowRef<string | null>(null);
let copyTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

const fullResponseTag = computed(() => formatApiVariableTag(props.outputKey));
const statusTag = computed(() =>
  formatApiVariableTag(props.outputKey, '_response.status')
);
const selectedCount = computed(
  () => model.value.paths.length + model.value.responseHeaders.length
);
const visibleFields = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return model.value.contract;
  return model.value.contract.filter((field) =>
    field.path.toLocaleLowerCase().includes(query)
  );
});

const typeIcons: Record<ApiRequestValueType, string> = {
  string: 'tabler-text-size',
  number: 'tabler-hash',
  boolean: 'tabler-toggle-left',
  object: 'tabler-braces',
  array: 'tabler-list',
  null: 'tabler-circle-off',
  binary: 'tabler-file-code',
  unknown: 'tabler-help-circle',
};

const updateCapture = (patch: Partial<ApiRequestCaptureConfig>): void => {
  model.value = { ...model.value, ...patch };
};

const togglePath = (path: string): void => {
  const paths = model.value.paths.includes(path)
    ? model.value.paths.filter((candidate) => candidate !== path)
    : [...model.value.paths, path];
  updateCapture({ paths });
};

const toggleHeader = (header: string): void => {
  const normalized = header.toLowerCase();
  const responseHeaders = model.value.responseHeaders.includes(normalized)
    ? model.value.responseHeaders.filter(
        (candidate) => candidate !== normalized
      )
    : [...model.value.responseHeaders, normalized];
  updateCapture({ responseHeaders });
};

const fieldTag = (field: ApiResponseContractField): string =>
  formatApiVariableTag(props.outputKey, field.path);

const headerTag = (header: string): string =>
  formatApiVariableTag(props.outputKey, `_response.headers.${header}`);

const fieldIndent = (
  field: ApiResponseContractField
): Record<string, string> => ({
  paddingInlineStart: `${Math.min(4, field.path.split('.').length - 1) * 13}px`,
});

const copyTag = async (tag: string): Promise<void> => {
  try {
    await globalThis.navigator.clipboard.writeText(tag);
    copiedTag.value = tag;
    if (copyTimer) globalThis.clearTimeout(copyTimer);
    copyTimer = globalThis.setTimeout(() => {
      copiedTag.value = null;
    }, 1_800);
  } catch {
    copiedTag.value = null;
  }
};

onBeforeUnmount(() => {
  if (copyTimer) globalThis.clearTimeout(copyTimer);
});
</script>

<template>
  <section class="mapping-panel">
    <header class="mapping-panel__header">
      <div>
        <div class="mapping-panel__title-line">
          <span class="mapping-panel__eyebrow">DE / PARA AUTOMÁTICO</span>
          <span v-if="selectedCount" class="mapping-panel__count">
            {{ selectedCount }} selecionado{{ selectedCount === 1 ? '' : 's' }}
          </span>
        </div>
        <h3 class="mapping-panel__title">Saídas disponíveis no fluxo</h3>
        <p class="mapping-panel__description">
          Selecione dados testados e use as tags geradas nos próximos nodes.
        </p>
      </div>
      <span class="mapping-panel__key">{{ props.outputKey }}</span>
    </header>

    <div class="mapping-panel__body">
      <div class="mapping-panel__mode-grid">
        <button
          type="button"
          class="mapping-panel__mode"
          :class="{ 'mapping-panel__mode--active': model.mode === 'full' }"
          :disabled="props.disabled"
          @click="updateCapture({ mode: 'full' })"
        >
          <span class="mapping-panel__mode-icon">
            <VIcon icon="tabler-file-code" size="20" />
          </span>
          <span>
            <strong>Resposta inteira</strong>
            <small>Preserva o JSON, array ou binário completo.</small>
          </span>
          <VIcon
            :icon="
              model.mode === 'full'
                ? 'tabler-circle-check-filled'
                : 'tabler-circle'
            "
            :color="model.mode === 'full' ? 'primary' : 'secondary'"
            size="19"
          />
        </button>

        <button
          type="button"
          class="mapping-panel__mode"
          :class="{ 'mapping-panel__mode--active': model.mode === 'fields' }"
          :disabled="props.disabled"
          @click="updateCapture({ mode: 'fields' })"
        >
          <span class="mapping-panel__mode-icon">
            <VIcon icon="tabler-sitemap" size="20" />
          </span>
          <span>
            <strong>Campos selecionados</strong>
            <small>Expõe apenas os caminhos escolhidos.</small>
          </span>
          <VIcon
            :icon="
              model.mode === 'fields'
                ? 'tabler-circle-check-filled'
                : 'tabler-circle'
            "
            :color="model.mode === 'fields' ? 'primary' : 'secondary'"
            size="19"
          />
        </button>
      </div>

      <div class="mapping-panel__always-available">
        <div>
          <span>Resposta inteira</span>
          <code>{{ fullResponseTag }}</code>
        </div>
        <VBtn
          :icon="copiedTag === fullResponseTag ? 'tabler-check' : 'tabler-copy'"
          :color="copiedTag === fullResponseTag ? 'success' : 'secondary'"
          variant="text"
          size="small"
          :aria-label="`Copiar ${fullResponseTag}`"
          @click="copyTag(fullResponseTag)"
        />
        <VDivider vertical />
        <div>
          <span>Status HTTP</span>
          <code>{{ statusTag }}</code>
        </div>
        <VBtn
          :icon="copiedTag === statusTag ? 'tabler-check' : 'tabler-copy'"
          :color="copiedTag === statusTag ? 'success' : 'secondary'"
          variant="text"
          size="small"
          :aria-label="`Copiar ${statusTag}`"
          @click="copyTag(statusTag)"
        />
      </div>

      <template v-if="model.mode === 'fields'">
        <div class="mapping-panel__section-heading">
          <div>
            <h4>Corpo da resposta</h4>
            <p>Arrays projetam automaticamente o campo para todos os itens.</p>
          </div>
          <VTextField
            v-model="search"
            class="mapping-panel__search"
            prepend-inner-icon="tabler-search"
            placeholder="Buscar caminho"
            variant="outlined"
            density="compact"
            clearable
            hide-details
          />
        </div>

        <div
          v-if="visibleFields.length"
          class="mapping-panel__fields"
          role="list"
          aria-label="Campos do corpo da resposta"
        >
          <div
            v-for="field in visibleFields"
            :key="field.path"
            class="mapping-panel__field"
            role="listitem"
            :class="{
              'mapping-panel__field--selected': model.paths.includes(
                field.path
              ),
            }"
          >
            <VCheckboxBtn
              :model-value="model.paths.includes(field.path)"
              class="mapping-panel__field-select"
              :disabled="props.disabled"
              :aria-label="`Selecionar ${field.path}`"
              @update:model-value="togglePath(field.path)"
            />
            <div class="mapping-panel__field-name" :style="fieldIndent(field)">
              <VIcon
                class="mapping-panel__field-icon"
                :icon="typeIcons[field.type]"
                size="16"
              />
              <code class="mapping-panel__field-path" :title="field.path">
                {{ field.path }}
              </code>
            </div>
            <div class="mapping-panel__field-meta">
              <span class="mapping-panel__field-type">{{ field.type }}</span>
              <VIcon
                v-if="field.projectedFromArray"
                class="mapping-panel__field-projection"
                icon="tabler-stack-2"
                size="14"
                color="info"
                title="Projeção de array"
              />
            </div>
            <code class="mapping-panel__tag" :title="fieldTag(field)">
              {{ fieldTag(field) }}
            </code>
            <VBtn
              class="mapping-panel__field-copy"
              :icon="
                copiedTag === fieldTag(field) ? 'tabler-check' : 'tabler-copy'
              "
              :color="copiedTag === fieldTag(field) ? 'success' : 'secondary'"
              variant="text"
              size="small"
              :aria-label="`Copiar ${fieldTag(field)}`"
              @click="copyTag(fieldTag(field))"
            />
          </div>
        </div>

        <div v-else class="mapping-panel__empty">
          <span class="mapping-panel__empty-orbit" aria-hidden="true">
            <VIcon icon="tabler-test-pipe" size="21" />
          </span>
          <div>
            <strong>{{
              model.contract.length
                ? 'Nenhum caminho encontrado'
                : 'Teste a requisição primeiro'
            }}</strong>
            <p>
              {{
                model.contract.length
                  ? 'Ajuste a busca para encontrar o campo desejado.'
                  : 'O contrato descoberto aparecerá aqui sem persistir valores reais.'
              }}
            </p>
          </div>
        </div>
      </template>

      <section class="mapping-panel__headers">
        <div class="mapping-panel__section-heading">
          <div>
            <h4>Headers de resposta</h4>
            <p>Capture tokens, IDs de rastreio ou metadados necessários.</p>
          </div>
        </div>

        <div
          v-if="model.availableResponseHeaders.length"
          class="mapping-panel__header-list"
        >
          <button
            v-for="header in model.availableResponseHeaders"
            :key="header"
            type="button"
            class="mapping-panel__header-chip"
            :class="{
              'mapping-panel__header-chip--selected':
                model.responseHeaders.includes(header),
            }"
            :disabled="props.disabled"
            @click="toggleHeader(header)"
          >
            <VIcon
              :icon="
                model.responseHeaders.includes(header)
                  ? 'tabler-check'
                  : 'tabler-plus'
              "
              size="15"
            />
            {{ header }}
          </button>
        </div>
        <p v-else class="mapping-panel__header-empty">
          Headers serão listados depois de um teste válido.
        </p>

        <div
          v-if="model.responseHeaders.length"
          class="mapping-panel__selected-headers"
        >
          <div
            v-for="header in model.responseHeaders"
            :key="header"
            class="mapping-panel__selected-header"
          >
            <code>{{ headerTag(header) }}</code>
            <VBtn
              :icon="
                copiedTag === headerTag(header) ? 'tabler-check' : 'tabler-copy'
              "
              :color="copiedTag === headerTag(header) ? 'success' : 'secondary'"
              variant="text"
              size="x-small"
              @click="copyTag(headerTag(header))"
            />
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.mapping-panel {
  container-name: response-mapping;
  container-type: inline-size;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.mapping-panel__header {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 18px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.7);
  background:
    linear-gradient(
      115deg,
      rgba(var(--v-theme-primary), 0.08),
      transparent 52%
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 23px,
      rgba(var(--v-theme-primary), 0.025) 24px
    );
}

.mapping-panel__title-line {
  display: flex;
  align-items: center;
  gap: 9px;
}

.mapping-panel__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.mapping-panel__count {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(var(--v-theme-success), 0.1);
  color: rgb(var(--v-theme-success));
  font-size: 0.625rem;
  font-weight: 700;
}

.mapping-panel__title {
  margin-block-start: 5px;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1rem;
  font-weight: 750;
}

.mapping-panel__description {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.75rem;
}

.mapping-panel__key {
  padding: 6px 9px;
  border: 1px solid rgba(var(--v-theme-primary), 0.25);
  border-radius: 7px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.75rem;
  font-weight: 800;
}

.mapping-panel__body {
  display: grid;
  gap: 18px;
  padding: 18px;
}

.mapping-panel__mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mapping-panel__mode {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 11px;
  padding: 12px;
  border: 1px solid rgba(var(--v-border-color), 0.82);
  border-radius: 10px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.82);
  cursor: pointer;
  font: inherit;
  text-align: start;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;
}

.mapping-panel__mode:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.42);
  transform: translateY(-1px);
}

.mapping-panel__mode--active {
  border-color: rgba(var(--v-theme-primary), 0.52);
  background: rgba(var(--v-theme-primary), 0.045);
}

.mapping-panel__mode-icon {
  display: grid;
  block-size: 36px;
  inline-size: 36px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}

.mapping-panel__mode strong,
.mapping-panel__mode small {
  display: block;
}

.mapping-panel__mode strong {
  font-size: 0.8125rem;
}

.mapping-panel__mode small {
  margin-block-start: 2px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.6875rem;
}

.mapping-panel__always-available {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-info), 0.18);
  border-radius: 10px;
  background: rgba(var(--v-theme-info), 0.045);
}

.mapping-panel__always-available > div > span {
  display: block;
  margin-block-end: 3px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.mapping-panel__always-available code,
.mapping-panel__tag,
.mapping-panel__selected-header code {
  color: rgb(var(--v-theme-info));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
}

.mapping-panel__section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
}

.mapping-panel__section-heading h4 {
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.8125rem;
  font-weight: 750;
}

.mapping-panel__section-heading p,
.mapping-panel__header-empty {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.6875rem;
}

.mapping-panel__search {
  max-inline-size: 260px;
}

.mapping-panel__fields {
  border: 1px solid rgba(var(--v-border-color), 0.74);
  border-radius: 10px;
  overflow: hidden;
}

.mapping-panel__field {
  display: grid;
  grid-template-areas: 'select path type tag copy';
  grid-template-columns:
    40px minmax(0, 1.1fr) auto minmax(0, 0.9fr)
    40px;
  align-items: center;
  gap: 5px 8px;
  min-block-size: 48px;
  padding: 6px 8px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.58);
  transition: background-color 140ms ease;
}

.mapping-panel__field:last-child {
  border-block-end: 0;
}

.mapping-panel__field:hover,
.mapping-panel__field--selected {
  background: rgba(var(--v-theme-primary), 0.035);
}

.mapping-panel__field-name {
  display: grid;
  grid-area: path;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-inline-size: 0;
}

.mapping-panel__field-select {
  grid-area: select;
  justify-self: center;
}

.mapping-panel__field-icon {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.mapping-panel__field-path {
  display: block;
  min-inline-size: 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.8);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.71875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-panel__field-meta {
  display: inline-flex;
  grid-area: type;
  align-items: center;
  gap: 4px;
  min-inline-size: 0;
}

.mapping-panel__field-type {
  flex: 0 0 auto;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.5625rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.mapping-panel__field-projection {
  flex: 0 0 auto;
}

.mapping-panel__tag {
  display: block;
  grid-area: tag;
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-panel__field-copy {
  grid-area: copy;
  justify-self: center;
}

.mapping-panel__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 22px;
  border: 1px dashed rgba(var(--v-border-color), 0.9);
  border-radius: 10px;
}

.mapping-panel__empty-orbit {
  display: grid;
  block-size: 42px;
  inline-size: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: rgba(var(--v-theme-info), 0.08);
  color: rgb(var(--v-theme-info));
}

.mapping-panel__empty strong {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.8125rem;
}

.mapping-panel__empty p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
}

.mapping-panel__headers {
  display: grid;
  gap: 10px;
  padding-block-start: 2px;
}

.mapping-panel__header-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.mapping-panel__header-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid rgba(var(--v-border-color), 0.85);
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.65);
  cursor: pointer;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.625rem;
}

.mapping-panel__header-chip--selected {
  border-color: rgba(var(--v-theme-success), 0.4);
  background: rgba(var(--v-theme-success), 0.07);
  color: rgb(var(--v-theme-success));
}

.mapping-panel__selected-headers {
  display: grid;
  gap: 5px;
}

.mapping-panel__selected-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-block-size: 34px;
  padding: 3px 5px 3px 10px;
  border-radius: 7px;
  background: rgba(var(--v-theme-info), 0.045);
}

@media (max-width: 760px) {
  .mapping-panel__mode-grid {
    grid-template-columns: 1fr;
  }

  .mapping-panel__always-available {
    grid-template-columns: 1fr auto;
  }

  .mapping-panel__always-available :deep(.v-divider) {
    display: none;
  }

  .mapping-panel__section-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .mapping-panel__search {
    max-inline-size: none;
  }
}

@container response-mapping (max-width: 760px) {
  .mapping-panel__field {
    grid-template-areas:
      'select path type copy'
      '. tag tag copy';
    grid-template-columns: 40px minmax(0, 1fr) auto 40px;
    align-items: center;
  }
}

@container response-mapping (max-width: 420px) {
  .mapping-panel__field {
    grid-template-areas:
      'select path copy'
      '. type copy'
      '. tag copy';
    grid-template-columns: 40px minmax(0, 1fr) 40px;
  }

  .mapping-panel__field-meta {
    justify-self: start;
  }
}
</style>
