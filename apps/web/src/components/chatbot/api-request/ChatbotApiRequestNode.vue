<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import ApiRequestEditorDialog from './ApiRequestEditorDialog.vue';
import {
  getApiRequestHost,
  normalizeApiRequestConfig,
  type ApiRequestConfig,
  type ApiRequestNodeData,
  type ApiRequestTestInput,
  type ApiRequestTestResult,
  type ApiRequestVariable,
} from './types';

const props = defineProps<NodeProps>();

const nodeData = computed(() => props.data as ApiRequestNodeData);
const initialOutputKey =
  typeof nodeData.value.apiRequest?.outputKey === 'string'
    ? nodeData.value.apiRequest.outputKey
    : 'api_1';
const config = shallowRef<ApiRequestConfig>(
  normalizeApiRequestConfig(nodeData.value.apiRequest, {
    outputKey: initialOutputKey,
  })
);
const isEditorOpen = shallowRef(false);

const host = computed(() => getApiRequestHost(config.value.url));
const statusLabel = computed(() => {
  if (config.value.test.state === 'tested') return 'Testado';
  if (config.value.test.state === 'changed') return 'Alterado';
  return 'Não testado';
});
const statusIcon = computed(() => {
  if (config.value.test.state === 'tested') return 'tabler-circle-check-filled';
  if (config.value.test.state === 'changed') return 'tabler-alert-circle';
  return 'tabler-circle-dashed';
});
const statusClass = computed(
  () => `api-request-node__status--${config.value.test.state}`
);
const methodClass = computed(
  () => `api-request-node__method--${config.value.method.toLowerCase()}`
);
const editorVariables = computed<ApiRequestVariable[]>(() => {
  const variables = [...(nodeData.value.availableVariables || [])];
  if (config.value.execution.mode === 'forEach') {
    variables.push(
      {
        tag: '{{ item }}',
        label: 'Item atual',
        description: 'Valor atual da coleção.',
        type: 'unknown',
      },
      {
        tag: '{{ item.campo }}',
        label: 'Campo do item',
        description: 'Caminho dentro do item atual.',
        type: 'unknown',
      },
      {
        tag: '{{ index }}',
        label: 'Índice',
        description: 'Índice do item atual, iniciando em zero.',
        type: 'number',
      }
    );
  }
  return variables;
});

const openEditor = (): void => {
  isEditorOpen.value = true;
};

const saveConfig = (nextConfig: ApiRequestConfig): void => {
  config.value = normalizeApiRequestConfig(nextConfig, {
    outputKey: config.value.outputKey,
  });
  nodeData.value.apiRequest = config.value;
  void nodeData.value.onUpdate?.(config.value);
};

const testRequest = async (
  input: ApiRequestTestInput
): Promise<ApiRequestTestResult> => {
  const callback = nodeData.value.onTest;
  if (!callback) {
    throw new Error('O teste de API ainda não está disponível.');
  }

  return callback({
    ...input,
    upstreamContracts: nodeData.value.upstreamContracts,
  });
};

const removeNode = (): void => {
  nodeData.value.onRemove?.();
};

watch(
  () => nodeData.value.apiRequest,
  (apiRequest) => {
    if (!apiRequest || isEditorOpen.value) return;
    config.value = normalizeApiRequestConfig(apiRequest, {
      outputKey: config.value.outputKey,
    });
  },
  { deep: true }
);
</script>

<template>
  <div class="api-request-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="api-request-node__handle api-request-node__handle--target handle-target"
    />

    <VCard class="api-request-node__card" elevation="0">
      <header class="api-request-node__header node-drag-handle">
        <div class="api-request-node__identity">
          <span class="api-request-node__icon" aria-hidden="true">
            <VIcon icon="tabler-api" size="19" />
          </span>
          <div>
            <span class="api-request-node__eyebrow">INTEGRAÇÃO</span>
            <h3 class="api-request-node__title">Chamada de API</h3>
          </div>
        </div>

        <VBtn
          v-if="nodeData.onRemove && !nodeData.readOnly"
          class="nodrag"
          icon="tabler-x"
          color="error"
          variant="text"
          size="x-small"
          aria-label="Remover chamada de API"
          @click.stop="removeNode"
        />
      </header>

      <div class="api-request-node__body">
        <div class="api-request-node__endpoint">
          <span class="api-request-node__method" :class="methodClass">
            {{ config.method }}
          </span>
          <span class="api-request-node__host" :title="host">{{ host }}</span>
        </div>

        <div class="api-request-node__telemetry">
          <div class="api-request-node__output">
            <span>SAÍDA</span>
            <code>{{ config.outputKey }}</code>
          </div>
          <span class="api-request-node__status" :class="statusClass">
            <VIcon :icon="statusIcon" size="13" />
            {{ statusLabel }}
          </span>
        </div>

        <button
          type="button"
          class="api-request-node__configure nodrag"
          :aria-label="
            nodeData.readOnly
              ? 'Visualizar chamada de API'
              : 'Configurar chamada de API'
          "
          @click.stop="openEditor"
        >
          <span class="api-request-node__configure-icon" aria-hidden="true">
            <VIcon icon="tabler-adjustments-code" size="17" />
          </span>
          <span class="api-request-node__configure-copy">
            <span class="api-request-node__configure-eyebrow">{{
              nodeData.readOnly ? 'SOMENTE LEITURA' : 'ABRIR WORKBENCH'
            }}</span>
            <span class="api-request-node__configure-label">{{
              nodeData.readOnly ? 'Visualizar' : 'Configurar chamada'
            }}</span>
          </span>
          <span class="api-request-node__configure-arrow" aria-hidden="true">
            <VIcon icon="tabler-chevron-right" size="16" />
          </span>
        </button>
      </div>

      <footer class="api-request-node__routes" aria-label="Saídas obrigatórias">
        <span class="api-request-node__route api-request-node__route--success">
          <i />
          Sucesso
        </span>
        <span class="api-request-node__route api-request-node__route--failure">
          Falha
          <i />
        </span>
      </footer>
    </VCard>

    <Handle
      id="success"
      type="source"
      :position="Position.Bottom"
      class="api-request-node__handle api-request-node__handle--success handle-source"
    />
    <Handle
      id="failure"
      type="source"
      :position="Position.Bottom"
      class="api-request-node__handle api-request-node__handle--failure handle-source"
    />

    <ApiRequestEditorDialog
      v-model="isEditorOpen"
      :config="config"
      :node-id="props.id"
      :variables="editorVariables"
      :read-only="Boolean(nodeData.readOnly)"
      :test-request="nodeData.onTest ? testRequest : undefined"
      @save="saveConfig"
    />
  </div>
</template>

<style scoped>
.api-request-node {
  position: relative;
  inline-size: 318px;
}

.api-request-node__card {
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 13px;
  background: rgb(var(--v-theme-surface));
  box-shadow:
    0 12px 28px rgba(20, 46, 77, 0.11),
    0 2px 6px rgba(20, 46, 77, 0.06) !important;
  overflow: hidden;
}

.api-request-node__card::before {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  block-size: 3px;
  background: linear-gradient(
    90deg,
    rgb(var(--v-theme-primary)),
    rgb(var(--v-theme-info))
  );
  content: '';
}

.api-request-node__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-block-size: 54px;
  padding: 10px 11px 9px 12px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.64);
  background:
    linear-gradient(
      105deg,
      rgba(var(--v-theme-primary), 0.06),
      transparent 60%
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 19px,
      rgba(var(--v-theme-primary), 0.025) 20px
    );
  cursor: grab;
  user-select: none;
}

.api-request-node__header:active {
  cursor: grabbing;
}

.api-request-node__identity {
  display: flex;
  align-items: center;
  gap: 9px;
}

.api-request-node__icon {
  position: relative;
  display: grid;
  block-size: 34px;
  inline-size: 34px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}

.api-request-node__icon::after {
  position: absolute;
  inset-block-start: 5px;
  inset-inline-end: 5px;
  block-size: 4px;
  inline-size: 4px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-success), 0.15);
  content: '';
}

.api-request-node__eyebrow {
  display: block;
  color: rgb(var(--v-theme-primary));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.5rem;
  font-weight: 850;
  letter-spacing: 0.12em;
  line-height: 1.2;
}

.api-request-node__title {
  margin-block-start: 2px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.8125rem;
  font-weight: 760;
  line-height: 1.25;
}

.api-request-node__body {
  display: grid;
  gap: 8px;
  padding: 8px 12px;
}

.api-request-node__endpoint {
  display: flex;
  align-items: center;
  gap: 8px;
  min-block-size: 34px;
  padding: 6px 8px;
  border: 1px solid rgba(var(--v-border-color), 0.72);
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.api-request-node__method {
  padding: 3px 5px;
  border-radius: 4px;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.5625rem;
  font-weight: 850;
  letter-spacing: 0.06em;
}

.api-request-node__method--get,
.api-request-node__method--head,
.api-request-node__method--options {
  background: rgba(var(--v-theme-info), 0.1);
  color: rgb(var(--v-theme-info));
}

.api-request-node__method--post {
  background: rgba(var(--v-theme-success), 0.1);
  color: rgb(var(--v-theme-success));
}

.api-request-node__method--put,
.api-request-node__method--patch {
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}

.api-request-node__method--delete {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.api-request-node__host {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.625rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-request-node__telemetry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.api-request-node__output > span {
  display: block;
  margin-block-end: 1px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-size: 0.46875rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.api-request-node__output > code {
  color: rgb(var(--v-theme-primary));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  font-weight: 800;
}

.api-request-node__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 5px;
  font-size: 0.5625rem;
  font-weight: 720;
}

.api-request-node__status--untested {
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.api-request-node__status--tested {
  background: rgba(var(--v-theme-success), 0.09);
  color: rgb(var(--v-theme-success));
}

.api-request-node__status--changed {
  background: rgba(var(--v-theme-warning), 0.11);
  color: rgb(var(--v-theme-warning));
}

.api-request-node__configure {
  position: relative;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 26px;
  align-items: center;
  gap: 8px;
  min-block-size: 42px;
  inline-size: 100%;
  padding: 5px 6px;
  appearance: none;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.26);
  border-radius: 9px;
  background:
    linear-gradient(
      105deg,
      rgba(var(--v-theme-primary), 0.11),
      rgba(var(--v-theme-info), 0.045) 72%
    ),
    rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  isolation: isolate;
  text-align: start;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.api-request-node__configure::before {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent 0 17px,
    rgba(var(--v-theme-primary), 0.035) 18px
  );
  content: '';
  opacity: 0.6;
  pointer-events: none;
}

.api-request-node__configure:hover {
  border-color: rgba(var(--v-theme-primary), 0.48);
  box-shadow: 0 5px 12px rgba(var(--v-theme-primary), 0.13);
  transform: translateY(-1px);
}

.api-request-node__configure:active {
  box-shadow: 0 2px 6px rgba(var(--v-theme-primary), 0.1);
  transform: translateY(0);
}

.api-request-node__configure:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.62);
  outline-offset: 2px;
}

.api-request-node__configure-icon,
.api-request-node__configure-arrow {
  display: grid;
  place-items: center;
}

.api-request-node__configure-icon {
  block-size: 30px;
  inline-size: 30px;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 7px;
  background: rgba(var(--v-theme-primary), 0.12);
}

.api-request-node__configure-copy {
  display: grid;
  min-inline-size: 0;
  gap: 1px;
}

.api-request-node__configure-eyebrow {
  color: rgba(var(--v-theme-primary), 0.68);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.4375rem;
  font-weight: 850;
  letter-spacing: 0.1em;
  line-height: 1.1;
}

.api-request-node__configure-label {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.6875rem;
  font-weight: 760;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-request-node__configure-arrow {
  block-size: 26px;
  inline-size: 26px;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 7px;
  background: rgba(var(--v-theme-surface), 0.62);
  transition:
    background-color 160ms ease,
    transform 160ms ease;
}

.api-request-node__configure:hover .api-request-node__configure-arrow {
  background: rgba(var(--v-theme-primary), 0.11);
  transform: translateX(2px);
}

.api-request-node__routes {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-block-size: 33px;
  padding: 5px 50px 7px;
  border-block-start: 1px solid rgba(var(--v-border-color), 0.6);
  background: rgba(var(--v-theme-on-surface), 0.014);
}

.api-request-node__route {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.api-request-node__route i {
  block-size: 5px;
  inline-size: 5px;
  border-radius: 50%;
  background: currentColor;
}

.api-request-node__route--success {
  color: rgb(var(--v-theme-success));
}

.api-request-node__route--failure {
  color: rgb(var(--v-theme-error));
}

.api-request-node__handle {
  box-sizing: border-box;
  block-size: 20px;
  inline-size: 20px;
  border: 3px solid rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 1px rgba(22, 43, 69, 0.17);
}

.api-request-node__handle--target {
  inset-block-start: 0;
  background: rgb(var(--v-theme-success)) !important;
}

.api-request-node__handle--success {
  inset-block-end: 0;
  inset-inline-start: 31%;
  background: rgb(var(--v-theme-error)) !important;
}

.api-request-node__handle--failure {
  inset-block-end: 0;
  inset-inline-start: 69%;
  background: rgb(var(--v-theme-error)) !important;
}
</style>
