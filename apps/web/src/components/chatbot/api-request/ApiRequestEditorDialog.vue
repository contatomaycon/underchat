<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from 'vue';
import { getChatbotApiRequestTestVariablePaths } from '@core/common/functions/chatbotApiRequestSampleVariables';
import ApiAuthEditor from './ApiAuthEditor.vue';
import ApiBodyEditor from './ApiBodyEditor.vue';
import ApiKeyValueEditor from './ApiKeyValueEditor.vue';
import ApiResponseMappingPanel from './ApiResponseMappingPanel.vue';
import ApiVariableField from './ApiVariableField.vue';
import {
  API_REQUEST_METHODS,
  applyApiRequestTestResult,
  createApiRequestKeyValue,
  getApiRequestHost,
  getApiRequestTestSnapshot,
  isSideEffectMethod,
  markApiRequestChanged,
  normalizeApiRequestConfig,
  type ApiRequestConfig,
  type ApiRequestKeyValue,
  type ApiRequestMethod,
  type ApiRequestTestCallback,
  type ApiRequestTestResult,
  type ApiRequestVariable,
} from './types';

interface Props {
  config: ApiRequestConfig;
  nodeId: string;
  variables?: readonly ApiRequestVariable[];
  testRequest?: ApiRequestTestCallback;
  readOnly?: boolean;
}

interface Emits {
  save: [config: ApiRequestConfig];
}

type EditorTab = 'request' | 'execution' | 'test' | 'mapping';

const props = withDefaults(defineProps<Props>(), {
  variables: () => [],
  testRequest: undefined,
  readOnly: false,
});
const emit = defineEmits<Emits>();
const isOpen = defineModel<boolean>({ required: true });

const activeTab = shallowRef<EditorTab>('request');
const draft = shallowRef<ApiRequestConfig>(
  normalizeApiRequestConfig(props.config, {
    outputKey: props.config.outputKey,
  })
);
const sampleVariables = shallowRef<ApiRequestKeyValue[]>([]);
const confirmSideEffects = shallowRef(false);
const isTesting = shallowRef(false);
const testError = shallowRef<string | null>(null);
const testResult = shallowRef<ApiRequestTestResult | null>(null);
const suppressTestInvalidation = shallowRef(false);
const itemTag = '{{ item }}';
const itemFieldTag = '{{ item.campo }}';
const itemIndexTag = '{{ index }}';

const tabs: Array<{
  value: EditorTab;
  label: string;
  eyebrow: string;
  icon: string;
}> = [
  {
    value: 'request',
    label: 'Requisição',
    eyebrow: '01',
    icon: 'tabler-world-www',
  },
  {
    value: 'execution',
    label: 'Execução',
    eyebrow: '02',
    icon: 'tabler-adjustments-horizontal',
  },
  {
    value: 'test',
    label: 'Teste / resposta',
    eyebrow: '03',
    icon: 'tabler-test-pipe',
  },
  {
    value: 'mapping',
    label: 'De / para',
    eyebrow: '04',
    icon: 'tabler-route',
  },
];

const methodOptions = API_REQUEST_METHODS.map((method) => ({
  value: method,
  title: method,
}));

const requestHost = computed(() => getApiRequestHost(draft.value.url));
const hasSideEffects = computed(() => isSideEffectMethod(draft.value.method));
const testStatus = computed(() => draft.value.test.state);
const testStatusLabel = computed(() => {
  if (testStatus.value === 'tested') return 'Testado';
  if (testStatus.value === 'changed') return 'Alterado';
  return 'Não testado';
});
const testStatusColor = computed(() => {
  if (testStatus.value === 'tested') return 'success';
  if (testStatus.value === 'changed') return 'warning';
  return 'secondary';
});
const editorVariables = computed<ApiRequestVariable[]>(() => {
  const variables = [...props.variables];
  if (draft.value.execution.mode === 'forEach') {
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
  return variables.filter(
    (variable, index, catalog) =>
      catalog.findIndex((candidate) => candidate.tag === variable.tag) === index
  );
});

const requiredSampleVariablePaths = computed(() =>
  getChatbotApiRequestTestVariablePaths(draft.value)
);
const missingSampleVariablePaths = computed(() =>
  sampleVariables.value
    .filter((entry) => !entry.value.trim())
    .map((entry) => entry.key)
);
const sampleVariablesError = computed(() => {
  const missing = missingSampleVariablePaths.value;
  if (missing.length === 0) return null;
  if (missing.length === 1) {
    return `Informe um valor de amostra para {{ ${missing[0]} }}.`;
  }
  return `Informe valores de amostra para ${missing.length} variáveis usadas na requisição.`;
});

const appEnvironment = (import.meta.env.APP_ENVIRONMENT ?? '').toLowerCase();
const isProduction =
  import.meta.env.PROD || ['prod', 'production'].includes(appEnvironment);
const allowLocalhostHttp =
  ['local', 'dev'].includes(appEnvironment) &&
  import.meta.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP?.trim().toLowerCase() ===
    'true';

const urlError = computed(() => {
  const url = draft.value.url.trim();
  if (!url) return 'Informe a URL do endpoint.';
  if (url.length > 2_048) return 'A URL pode ter no máximo 2.048 caracteres.';

  const authorityMatch = /^([a-z][a-z\d+.-]*):\/\/([^/?#]+)/i.exec(url);
  if (!authorityMatch) return 'Informe uma URL absoluta.';
  if (authorityMatch[0].includes('{{')) {
    return 'Protocolo, host e porta precisam ser literais.';
  }

  try {
    const templateSafeUrl = url.replaceAll(/\{\{[^{}]+\}\}/g, 'value');
    const parsed = new URL(templateSafeUrl);
    if (parsed.username || parsed.password) {
      return 'Não inclua credenciais diretamente na URL.';
    }
    if (parsed.hash) return 'Fragmentos (#) não são enviados ao servidor.';

    const isAllowedLocalhost =
      allowLocalhostHttp &&
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isAllowedLocalhost) {
      return 'Use HTTPS. HTTP local só é permitido no ambiente de desenvolvimento.';
    }

    const effectivePort = Number(
      parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    );
    if (isProduction && effectivePort !== 443) {
      return 'Em produção, somente a porta HTTPS 443 é aceita.';
    }
  } catch {
    return 'A URL informada não é válida.';
  }

  return null;
});

const authError = computed(() => {
  const auth = draft.value.auth;
  if (
    auth.type === 'bearer' &&
    !auth.bearer.token.value.trim() &&
    !auth.bearer.token.hasValue
  ) {
    return 'Informe o token Bearer.';
  }
  if (auth.type === 'apiKey') {
    if (!auth.apiKey.name.trim()) return 'Informe o nome da API Key.';
    if (!auth.apiKey.value.value.trim() && !auth.apiKey.value.hasValue) {
      return 'Informe o valor da API Key.';
    }
  }
  if (auth.type === 'basic') {
    if (!auth.basic.username.value.trim() && !auth.basic.username.hasValue) {
      return 'Informe o usuário da autenticação Basic.';
    }
    if (!auth.basic.password.value.trim() && !auth.basic.password.hasValue) {
      return 'Informe a senha da autenticação Basic.';
    }
  }
  return null;
});

const bodyError = computed(() => {
  const body = draft.value.body;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(draft.value.method)) {
    return null;
  }
  if (body.type === 'json') {
    if (!body.json.trim() && !body.hasValue) return 'Informe o body JSON.';
    if (!body.json.trim() && body.hasValue) return null;
    try {
      const withQuotedVariables = body.json
        .replaceAll(/"\s*\{\{[^{}]+\}\}\s*"/g, '"__VARIABLE__"')
        .replaceAll(/\{\{[^{}]+\}\}/g, '"__VARIABLE__"');
      JSON.parse(withQuotedVariables);
    } catch {
      return 'Corrija o JSON antes de testar.';
    }
  }
  if (body.type === 'raw' && !body.raw.trim() && !body.hasValue) {
    return 'Informe o conteúdo raw.';
  }
  if (
    body.type === 'multipart' &&
    !body.multipart.some(
      (part) => part.enabled && part.name.trim() && part.value.trim()
    )
  ) {
    return 'Adicione ao menos uma parte multipart válida.';
  }
  return null;
});

const executionError = computed(() => {
  if (
    draft.value.execution.mode === 'forEach' &&
    !draft.value.execution.itemsExpression.trim()
  ) {
    return 'Informe o array usado na execução Para cada item.';
  }
  if (
    ['POST', 'PATCH'].includes(draft.value.method) &&
    draft.value.execution.retry.maxAttempts > 1 &&
    !draft.value.execution.idempotencyKey.trim()
  ) {
    return `Informe uma chave de idempotência para repetir ${draft.value.method}, ou use somente uma tentativa.`;
  }
  return null;
});

const mappingError = computed(() => {
  if (
    draft.value.capture.mode === 'fields' &&
    draft.value.capture.paths.length === 0 &&
    draft.value.capture.responseHeaders.length === 0
  ) {
    return 'Selecione ao menos um campo ou header no de/para.';
  }
  return null;
});

const requestErrors = computed(() =>
  [
    urlError.value,
    authError.value,
    bodyError.value,
    executionError.value,
  ].filter((error): error is string => Boolean(error))
);
const saveErrors = computed(() =>
  [...requestErrors.value, mappingError.value].filter(
    (error): error is string => Boolean(error)
  )
);
const canRunTest = computed(
  () =>
    requestErrors.value.length === 0 &&
    missingSampleVariablePaths.value.length === 0 &&
    Boolean(props.testRequest) &&
    !isTesting.value &&
    (!hasSideEffects.value || confirmSideEffects.value)
);
const canSave = computed(
  () =>
    !props.readOnly &&
    saveErrors.value.length === 0 &&
    draft.value.test.state === 'tested' &&
    Boolean(draft.value.test.evidence) &&
    !isTesting.value
);

const formattedPreview = computed(() => {
  if (!testResult.value) return '';
  const preview = testResult.value.preview;
  if (typeof preview === 'string') return preview;
  try {
    return JSON.stringify(preview, null, 2);
  } catch {
    return String(preview);
  }
});

const methodClass = computed(
  () => `api-request-dialog__method--${draft.value.method.toLowerCase()}`
);

const replaceDraft = (config: ApiRequestConfig): void => {
  draft.value = normalizeApiRequestConfig(config, {
    outputKey: config.outputKey,
  });
};

const resetEditor = (): void => {
  suppressTestInvalidation.value = true;
  replaceDraft(props.config);
  sampleVariables.value = [];
  reconcileSampleVariables(requiredSampleVariablePaths.value);
  confirmSideEffects.value = false;
  testError.value = null;
  testResult.value = null;
  activeTab.value = 'request';
  void nextTick(() => {
    suppressTestInvalidation.value = false;
  });
};

const close = (): void => {
  if (isTesting.value) return;
  isOpen.value = false;
};

const updateMethod = (method: ApiRequestMethod): void => {
  const methodAllowsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  replaceDraft({
    ...draft.value,
    method,
    body: methodAllowsBody
      ? draft.value.body
      : { ...draft.value.body, type: 'none' },
  });
  confirmSideEffects.value = false;
};

const updateUrl = (url: string): void => {
  replaceDraft({ ...draft.value, url });
};

const updateQueryParams = (queryParams: ApiRequestKeyValue[]): void => {
  replaceDraft({ ...draft.value, queryParams });
};

const updateHeaders = (headers: ApiRequestKeyValue[]): void => {
  replaceDraft({ ...draft.value, headers });
};

const updateExecution = (
  patch: Partial<ApiRequestConfig['execution']>
): void => {
  replaceDraft({
    ...draft.value,
    execution: { ...draft.value.execution, ...patch },
  });
};

const updateRetry = (
  patch: Partial<ApiRequestConfig['execution']['retry']>
): void => {
  updateExecution({
    retry: { ...draft.value.execution.retry, ...patch },
  });
};

const reconcileSampleVariables = (paths: readonly string[]): void => {
  const existingByPath = new Map(
    sampleVariables.value.map((entry) => [entry.key, entry] as const)
  );
  sampleVariables.value = paths.map((path) => {
    const existing = existingByPath.get(path);
    return (
      existing ?? {
        ...createApiRequestKeyValue(),
        enabled: true,
        key: path,
      }
    );
  });
};

const updateSampleVariableValue = (path: string, value: string): void => {
  sampleVariables.value = sampleVariables.value.map((entry) =>
    entry.key === path ? { ...entry, value } : entry
  );
};

const formatSampleVariableTag = (path: string): string => `{{ ${path} }}`;

const sampleVariableRecord = (): Record<string, string> =>
  Object.fromEntries(
    sampleVariables.value
      .filter((entry) => entry.enabled && entry.key.trim())
      .map((entry) => [entry.key.trim(), entry.value])
  );

const runTest = async (): Promise<void> => {
  if (!canRunTest.value || !props.testRequest) return;
  isTesting.value = true;
  testError.value = null;
  testResult.value = null;

  try {
    const result = await props.testRequest({
      nodeId: props.nodeId,
      config: normalizeApiRequestConfig(draft.value, {
        outputKey: draft.value.outputKey,
      }),
      sampleVariables: sampleVariableRecord(),
      confirmSideEffects: confirmSideEffects.value,
    });

    suppressTestInvalidation.value = true;
    draft.value = applyApiRequestTestResult(draft.value, result);
    testResult.value = result;
    activeTab.value = 'test';
    await nextTick();
    suppressTestInvalidation.value = false;
  } catch (error) {
    testError.value =
      error instanceof Error && error.message
        ? error.message
        : 'Não foi possível testar a requisição.';
  } finally {
    isTesting.value = false;
  }
};

const save = (): void => {
  if (!canSave.value) return;
  const normalized = normalizeApiRequestConfig(draft.value, {
    outputKey: draft.value.outputKey,
  });
  emit('save', normalized);
  isOpen.value = false;
};

watch(isOpen, (visible) => {
  if (visible) resetEditor();
});

watch(
  requiredSampleVariablePaths,
  (paths) => {
    reconcileSampleVariables(paths);
  },
  { immediate: true }
);

watch(
  () => props.config,
  () => {
    if (!isOpen.value) resetEditor();
  },
  { deep: true }
);

watch(
  () => getApiRequestTestSnapshot(draft.value),
  (currentSnapshot, previousSnapshot) => {
    if (
      !isOpen.value ||
      suppressTestInvalidation.value ||
      currentSnapshot === previousSnapshot ||
      !draft.value.test.evidence
    ) {
      return;
    }

    draft.value = markApiRequestChanged(draft.value);
    testResult.value = null;
  }
);
</script>

<template>
  <VDialog
    v-model="isOpen"
    class="api-request-dialog-shell"
    max-width="1240"
    scrollable
    :persistent="isTesting"
    :aria-label="`Configurar chamada ${draft.outputKey}`"
  >
    <VCard class="api-request-dialog">
      <header class="api-request-dialog__header">
        <div class="api-request-dialog__identity">
          <span class="api-request-dialog__icon" aria-hidden="true">
            <VIcon icon="tabler-api" size="23" />
          </span>
          <div>
            <div class="api-request-dialog__eyebrow-row">
              <span>INTEGRATION WORKBENCH</span>
              <span class="api-request-dialog__serial">{{
                draft.outputKey
              }}</span>
            </div>
            <h2 class="api-request-dialog__title">Chamada de API</h2>
            <p class="api-request-dialog__subtitle">
              Configure, valide e publique dados externos no contexto do fluxo.
            </p>
          </div>
        </div>

        <div class="api-request-dialog__header-meta">
          <span class="api-request-dialog__method" :class="methodClass">
            {{ draft.method }}
          </span>
          <span class="api-request-dialog__host" :title="requestHost">
            {{ requestHost }}
          </span>
          <VChip
            :color="testStatusColor"
            variant="tonal"
            size="small"
            :prepend-icon="
              testStatus === 'tested'
                ? 'tabler-circle-check'
                : 'tabler-clock-cog'
            "
          >
            {{ testStatusLabel }}
          </VChip>
          <VBtn
            icon="tabler-x"
            variant="text"
            size="small"
            :disabled="isTesting"
            aria-label="Fechar"
            @click="close"
          />
        </div>
      </header>

      <VDivider />

      <div class="api-request-dialog__workspace">
        <nav
          class="api-request-dialog__rail"
          aria-label="Etapas da configuração"
        >
          <button
            v-for="tab in tabs"
            :key="tab.value"
            type="button"
            class="api-request-dialog__rail-item"
            :class="{
              'api-request-dialog__rail-item--active': activeTab === tab.value,
            }"
            :aria-current="activeTab === tab.value ? 'step' : undefined"
            @click="activeTab = tab.value"
          >
            <span class="api-request-dialog__rail-index">{{
              tab.eyebrow
            }}</span>
            <VIcon
              :icon="tab.icon"
              size="18"
              class="api-request-dialog__rail-icon"
            />
            <span class="api-request-dialog__rail-label">{{ tab.label }}</span>
            <VIcon
              v-if="tab.value === 'test' && testStatus === 'tested'"
              icon="tabler-check"
              color="success"
              size="15"
              class="api-request-dialog__rail-state"
            />
          </button>

          <div class="api-request-dialog__rail-note">
            <VIcon icon="tabler-shield-check" size="17" />
            <span>
              Saída segura
              <small>
                {{
                  allowLocalhostHttp
                    ? 'HTTPS público + HTTP loopback · limites ativos'
                    : 'HTTPS público · limites ativos'
                }}
              </small>
            </span>
          </div>
        </nav>

        <VCardText class="api-request-dialog__content">
          <section
            v-if="activeTab === 'request'"
            class="api-request-dialog__panel"
          >
            <div class="api-request-dialog__panel-heading">
              <span>REQUEST BUILDER</span>
              <h3>Requisição</h3>
              <p>Defina o endpoint e os dados que serão enviados.</p>
            </div>

            <section class="api-request-dialog__endpoint">
              <div
                class="api-request-dialog__endpoint-control api-request-dialog__endpoint-control--method"
              >
                <label
                  id="api-request-method-label"
                  class="api-request-dialog__endpoint-label"
                  for="api-request-method"
                >
                  Método
                </label>
                <VSelect
                  id="api-request-method"
                  :model-value="draft.method"
                  class="api-request-dialog__method-select"
                  :items="methodOptions"
                  :list-props="{ density: 'compact' }"
                  :disabled="props.readOnly"
                  aria-labelledby="api-request-method-label"
                  variant="outlined"
                  density="compact"
                  hide-details
                  @update:model-value="updateMethod"
                />
              </div>

              <div class="api-request-dialog__endpoint-control">
                <label
                  id="api-request-url-label"
                  class="api-request-dialog__endpoint-label"
                  for="api-request-url"
                >
                  URL do endpoint
                </label>
                <ApiVariableField
                  id="api-request-url"
                  :model-value="draft.url"
                  class="api-request-dialog__url-field"
                  :variables="editorVariables"
                  :disabled="props.readOnly"
                  aria-labelledby="api-request-url-label"
                  placeholder="https://api.exemplo.com/v1/customers/{{ contact.id }}"
                  monospace
                  hide-details="auto"
                  :error-messages="urlError ? [urlError] : []"
                  @update:model-value="updateUrl"
                />
              </div>

              <p class="api-request-dialog__endpoint-hint">
                <VIcon icon="tabler-lock" size="14" />
                Host e protocolo são fixos; use variáveis somente no path ou na
                query.
              </p>
            </section>

            <div class="api-request-dialog__request-grid">
              <ApiKeyValueEditor
                :model-value="draft.queryParams"
                :variables="editorVariables"
                :disabled="props.readOnly"
                title="Query string"
                description="Parâmetros codificados automaticamente na URL."
                key-label="Parâmetro"
                empty-label="Nenhum parâmetro de query."
                @update:model-value="updateQueryParams"
              />
              <ApiKeyValueEditor
                :model-value="draft.headers"
                :variables="editorVariables"
                :disabled="props.readOnly"
                title="Headers"
                description="Headers reservados e inseguros serão bloqueados."
                key-label="Header"
                empty-label="Nenhum header personalizado."
                @update:model-value="updateHeaders"
              />
            </div>

            <ApiAuthEditor
              :model-value="draft.auth"
              :variables="editorVariables"
              :disabled="props.readOnly"
              @update:model-value="replaceDraft({ ...draft, auth: $event })"
            />

            <VAlert
              v-if="authError"
              color="error"
              variant="tonal"
              density="compact"
              icon="tabler-alert-circle"
            >
              {{ authError }}
            </VAlert>

            <ApiBodyEditor
              :model-value="draft.body"
              :method="draft.method"
              :variables="editorVariables"
              :disabled="props.readOnly"
              @update:model-value="replaceDraft({ ...draft, body: $event })"
            />

            <VAlert
              v-if="bodyError"
              color="error"
              variant="tonal"
              density="compact"
              icon="tabler-alert-circle"
            >
              {{ bodyError }}
            </VAlert>
          </section>

          <section
            v-else-if="activeTab === 'execution'"
            class="api-request-dialog__panel"
          >
            <div class="api-request-dialog__panel-heading">
              <span>RUNTIME POLICY</span>
              <h3>Execução e resiliência</h3>
              <p>
                Controle volume, timeout, repetição segura e política de falha.
              </p>
            </div>

            <div class="api-request-dialog__execution-modes">
              <button
                type="button"
                class="api-request-dialog__execution-mode"
                :class="{
                  'api-request-dialog__execution-mode--active':
                    draft.execution.mode === 'once',
                }"
                :disabled="props.readOnly"
                @click="updateExecution({ mode: 'once' })"
              >
                <span><VIcon icon="tabler-player-play" size="20" /></span>
                <strong>Executar uma vez</strong>
                <small>Uma chamada por passagem pelo node.</small>
                <VIcon
                  :icon="
                    draft.execution.mode === 'once'
                      ? 'tabler-circle-check-filled'
                      : 'tabler-circle'
                  "
                  :color="
                    draft.execution.mode === 'once' ? 'primary' : 'secondary'
                  "
                  size="18"
                />
              </button>
              <button
                type="button"
                class="api-request-dialog__execution-mode"
                :class="{
                  'api-request-dialog__execution-mode--active':
                    draft.execution.mode === 'forEach',
                }"
                :disabled="props.readOnly"
                @click="updateExecution({ mode: 'forEach' })"
              >
                <span><VIcon icon="tabler-reload" size="20" /></span>
                <strong>Para cada item</strong>
                <small>Até 20 itens, com a ordem preservada.</small>
                <VIcon
                  :icon="
                    draft.execution.mode === 'forEach'
                      ? 'tabler-circle-check-filled'
                      : 'tabler-circle'
                  "
                  :color="
                    draft.execution.mode === 'forEach' ? 'primary' : 'secondary'
                  "
                  size="18"
                />
              </button>
            </div>

            <section
              v-if="draft.execution.mode === 'forEach'"
              class="api-request-dialog__runtime-card"
            >
              <header>
                <span class="api-request-dialog__runtime-icon">
                  <VIcon icon="tabler-list" size="19" />
                </span>
                <div>
                  <h4>Coleção de entrada</h4>
                  <p>
                    Durante a iteração ficam disponíveis {{ itemTag }},
                    {{ itemFieldTag }} e {{ itemIndexTag }}.
                  </p>
                </div>
              </header>
              <div class="api-request-dialog__field">
                <label
                  :id="`execution-items-label-${props.nodeId}`"
                  :for="`execution-items-${props.nodeId}`"
                  class="api-request-dialog__field-label"
                >
                  Variável com array
                </label>
                <ApiVariableField
                  :id="`execution-items-${props.nodeId}`"
                  :model-value="draft.execution.itemsExpression"
                  :variables="editorVariables"
                  :disabled="props.readOnly"
                  :aria-labelledby="`execution-items-label-${props.nodeId}`"
                  class="api-request-dialog__field-control"
                  placeholder="{{ api_1.data.results }}"
                  monospace
                  :error-messages="executionError ? [executionError] : []"
                  @update:model-value="
                    updateExecution({ itemsExpression: $event })
                  "
                />
              </div>
              <div class="api-request-dialog__runtime-grid">
                <div class="api-request-dialog__field">
                  <label
                    :id="`execution-concurrency-label-${props.nodeId}`"
                    :for="`execution-concurrency-${props.nodeId}`"
                    class="api-request-dialog__field-label"
                  >
                    Concorrência
                  </label>
                  <VSelect
                    :id="`execution-concurrency-${props.nodeId}`"
                    :model-value="draft.execution.concurrency"
                    :items="[
                      { value: 1, title: '1 chamada por vez' },
                      { value: 2, title: '2 chamadas em paralelo' },
                      { value: 3, title: '3 chamadas em paralelo' },
                    ]"
                    :list-props="{ density: 'compact' }"
                    :disabled="props.readOnly"
                    :aria-labelledby="`execution-concurrency-label-${props.nodeId}`"
                    class="api-request-dialog__field-control"
                    variant="outlined"
                    density="compact"
                    hide-details
                    @update:model-value="
                      updateExecution({ concurrency: $event })
                    "
                  />
                </div>
                <div class="api-request-dialog__field">
                  <label
                    :id="`execution-failure-policy-label-${props.nodeId}`"
                    :for="`execution-failure-policy-${props.nodeId}`"
                    class="api-request-dialog__field-label"
                  >
                    Política de falha
                  </label>
                  <VSelect
                    :id="`execution-failure-policy-${props.nodeId}`"
                    :model-value="draft.execution.failurePolicy"
                    :items="[
                      { value: 'failFast', title: 'Parar no primeiro erro' },
                      {
                        value: 'collectErrors',
                        title: 'Concluir e agregar erros',
                      },
                    ]"
                    :list-props="{ density: 'compact' }"
                    :disabled="props.readOnly"
                    :aria-labelledby="`execution-failure-policy-label-${props.nodeId}`"
                    class="api-request-dialog__field-control"
                    variant="outlined"
                    density="compact"
                    hide-details
                    @update:model-value="
                      updateExecution({ failurePolicy: $event })
                    "
                  />
                </div>
              </div>
            </section>

            <section class="api-request-dialog__runtime-card">
              <header>
                <span
                  class="api-request-dialog__runtime-icon api-request-dialog__runtime-icon--amber"
                >
                  <VIcon icon="tabler-reload" size="19" />
                </span>
                <div>
                  <h4>Timeout e retry seguro</h4>
                  <p>
                    Retry apenas para falhas transitórias, com backoff e jitter
                    no servidor.
                  </p>
                </div>
              </header>

              <div
                class="api-request-dialog__runtime-grid api-request-dialog__runtime-grid--three"
              >
                <div class="api-request-dialog__field">
                  <label
                    :id="`execution-timeout-label-${props.nodeId}`"
                    :for="`execution-timeout-${props.nodeId}`"
                    class="api-request-dialog__field-label"
                  >
                    Timeout (ms)
                  </label>
                  <VTextField
                    :id="`execution-timeout-${props.nodeId}`"
                    :model-value="draft.execution.timeoutMs"
                    :disabled="props.readOnly"
                    :aria-labelledby="`execution-timeout-label-${props.nodeId}`"
                    class="api-request-dialog__field-control"
                    type="number"
                    min="1000"
                    max="60000"
                    step="1000"
                    variant="outlined"
                    density="compact"
                    hide-details
                    @update:model-value="
                      updateExecution({ timeoutMs: Number($event) })
                    "
                  />
                </div>
                <div class="api-request-dialog__field">
                  <label
                    :id="`execution-max-attempts-label-${props.nodeId}`"
                    :for="`execution-max-attempts-${props.nodeId}`"
                    class="api-request-dialog__field-label"
                  >
                    Máximo de tentativas
                  </label>
                  <VSelect
                    :id="`execution-max-attempts-${props.nodeId}`"
                    :model-value="draft.execution.retry.maxAttempts"
                    :items="[
                      { value: 1, title: '1 (sem retry)' },
                      { value: 2, title: '2 tentativas' },
                      { value: 3, title: '3 tentativas' },
                    ]"
                    :list-props="{ density: 'compact' }"
                    :disabled="props.readOnly"
                    :aria-labelledby="`execution-max-attempts-label-${props.nodeId}`"
                    class="api-request-dialog__field-control"
                    variant="outlined"
                    density="compact"
                    hide-details
                    @update:model-value="updateRetry({ maxAttempts: $event })"
                  />
                </div>
                <div class="api-request-dialog__field">
                  <label
                    :id="`execution-backoff-label-${props.nodeId}`"
                    :for="`execution-backoff-${props.nodeId}`"
                    class="api-request-dialog__field-label"
                  >
                    Backoff inicial (ms)
                  </label>
                  <VTextField
                    :id="`execution-backoff-${props.nodeId}`"
                    :model-value="draft.execution.retry.initialDelayMs"
                    :disabled="props.readOnly"
                    :aria-labelledby="`execution-backoff-label-${props.nodeId}`"
                    class="api-request-dialog__field-control"
                    type="number"
                    min="100"
                    max="5000"
                    step="100"
                    variant="outlined"
                    density="compact"
                    hide-details
                    @update:model-value="
                      updateRetry({ initialDelayMs: Number($event) })
                    "
                  />
                </div>
              </div>

              <div class="api-request-dialog__field">
                <label
                  :id="`execution-idempotency-label-${props.nodeId}`"
                  :for="`execution-idempotency-${props.nodeId}`"
                  class="api-request-dialog__field-label"
                >
                  Chave de idempotência (opcional)
                </label>
                <ApiVariableField
                  :id="`execution-idempotency-${props.nodeId}`"
                  :model-value="draft.execution.idempotencyKey"
                  :variables="editorVariables"
                  :disabled="props.readOnly"
                  :aria-labelledby="`execution-idempotency-label-${props.nodeId}`"
                  class="api-request-dialog__field-control"
                  placeholder="order-{{ contact.id }}-{{ index }}"
                  monospace
                  hide-details
                  @update:model-value="
                    updateExecution({ idempotencyKey: $event })
                  "
                />
                <p class="api-request-dialog__field-hint">
                  Obrigatória para repetir POST e PATCH; é mantida estável por
                  execução/item.
                </p>
              </div>
            </section>

            <VAlert
              v-if="executionError"
              color="error"
              variant="tonal"
              icon="tabler-alert-circle"
              density="compact"
            >
              {{ executionError }}
            </VAlert>

            <VAlert
              color="info"
              variant="tonal"
              icon="tabler-shield-lock"
              density="compact"
            >
              Cada evento é limitado a 10 nodes de API, 30 tentativas HTTP e 50
              transições automáticas.
            </VAlert>
          </section>

          <section
            v-else-if="activeTab === 'test'"
            class="api-request-dialog__panel"
          >
            <div class="api-request-dialog__panel-heading">
              <span>LIVE PROBE</span>
              <h3>Teste e contrato da resposta</h3>
              <p>Uma única chamada é feita. O preview não é salvo no fluxo.</p>
            </div>

            <section class="api-request-dialog__test-console">
              <header class="api-request-dialog__test-console-head">
                <div
                  class="api-request-dialog__traffic-lights"
                  aria-hidden="true"
                >
                  <span />
                  <span />
                  <span />
                </div>
                <code>{{ draft.method }} {{ draft.url || '/endpoint' }}</code>
                <VChip :color="testStatusColor" variant="tonal" size="x-small">
                  {{ testStatusLabel }}
                </VChip>
              </header>

              <div class="api-request-dialog__test-body">
                <div class="api-request-dialog__test-copy">
                  <span class="api-request-dialog__test-icon">
                    <VIcon icon="tabler-test-pipe" size="23" />
                  </span>
                  <div>
                    <h4>Executar teste obrigatório</h4>
                    <p>
                      Descobre caminhos, tipos e headers sem persistir conteúdo
                      real da resposta.
                    </p>
                  </div>
                </div>

                <VAlert
                  v-if="!props.testRequest"
                  color="warning"
                  variant="tonal"
                  density="compact"
                  icon="tabler-plug-connected-x"
                >
                  O callback de teste ainda não foi conectado a este node.
                </VAlert>

                <div class="api-request-dialog__sample-vars">
                  <header>
                    <div>
                      <h5>Valores de amostra</h5>
                      <p>
                        Detectados automaticamente e usados somente nesta
                        execução de teste.
                      </p>
                    </div>
                    <VChip
                      v-if="sampleVariables.length"
                      :color="sampleVariablesError ? 'warning' : 'success'"
                      variant="tonal"
                      size="x-small"
                    >
                      {{ sampleVariables.length }}
                      {{
                        sampleVariables.length === 1 ? 'variável' : 'variáveis'
                      }}
                    </VChip>
                  </header>
                  <div
                    v-if="sampleVariables.length"
                    class="api-request-dialog__sample-rows"
                  >
                    <div
                      v-for="entry in sampleVariables"
                      :key="entry.id"
                      class="api-request-dialog__sample-row"
                      :class="{
                        'api-request-dialog__sample-row--missing':
                          !entry.value.trim(),
                      }"
                    >
                      <div class="api-request-dialog__sample-variable">
                        <span aria-hidden="true">
                          <VIcon icon="tabler-braces" size="17" />
                        </span>
                        <div>
                          <small>Variável usada na requisição</small>
                          <code>{{ formatSampleVariableTag(entry.key) }}</code>
                        </div>
                      </div>
                      <div class="api-request-dialog__field">
                        <label
                          :id="`sample-variable-value-label-${entry.id}`"
                          :for="`sample-variable-value-${entry.id}`"
                          class="api-request-dialog__field-label"
                        >
                          Valor para este teste
                          <span v-if="!entry.value.trim()">Obrigatório</span>
                        </label>
                        <VTextField
                          :id="`sample-variable-value-${entry.id}`"
                          :model-value="entry.value"
                          :aria-labelledby="`sample-variable-value-label-${entry.id}`"
                          class="api-request-dialog__field-control"
                          placeholder="Informe um valor de exemplo"
                          variant="outlined"
                          density="compact"
                          hide-details
                          :disabled="isTesting"
                          :aria-invalid="!entry.value.trim()"
                          @update:model-value="
                            updateSampleVariableValue(entry.key, $event ?? '')
                          "
                        />
                      </div>
                    </div>
                  </div>
                  <div v-else class="api-request-dialog__sample-empty">
                    <span aria-hidden="true">
                      <VIcon icon="tabler-circle-check" size="18" />
                    </span>
                    <div>
                      <strong>Nenhuma amostra necessária</strong>
                      <p>
                        Esta requisição não usa variáveis e pode ser testada
                        diretamente.
                      </p>
                    </div>
                  </div>
                </div>

                <VAlert
                  v-if="sampleVariablesError"
                  color="warning"
                  variant="tonal"
                  density="compact"
                  icon="tabler-alert-triangle"
                >
                  {{ sampleVariablesError }}
                </VAlert>

                <VCheckbox
                  v-if="hasSideEffects"
                  v-model="confirmSideEffects"
                  color="warning"
                  density="compact"
                  hide-details
                  :disabled="isTesting"
                >
                  <template #label>
                    <span class="api-request-dialog__side-effect-label">
                      Confirmo que {{ draft.method }} pode criar, alterar ou
                      excluir dados reais no endpoint.
                    </span>
                  </template>
                </VCheckbox>

                <VAlert
                  v-if="requestErrors.length"
                  color="error"
                  variant="tonal"
                  density="compact"
                  icon="tabler-alert-circle"
                >
                  <p
                    v-for="error in requestErrors"
                    :key="error"
                    class="api-request-dialog__error-line"
                  >
                    {{ error }}
                  </p>
                </VAlert>

                <VAlert
                  v-if="testError"
                  color="error"
                  variant="tonal"
                  density="compact"
                  closable
                  @click:close="testError = null"
                >
                  {{ testError }}
                </VAlert>

                <VBtn
                  color="primary"
                  size="large"
                  :loading="isTesting"
                  :disabled="!canRunTest || props.readOnly"
                  @click="runTest"
                >
                  <VIcon icon="tabler-player-play" size="19" class="me-2" />
                  Testar requisição
                </VBtn>
              </div>
            </section>

            <section v-if="testResult" class="api-request-dialog__response">
              <header class="api-request-dialog__response-head">
                <div>
                  <span>ÚLTIMA RESPOSTA · NÃO SERÁ SALVA</span>
                  <h4>Preview limitado</h4>
                </div>
                <div class="api-request-dialog__response-stats">
                  <span :class="testResult.ok ? 'text-success' : 'text-error'">
                    HTTP {{ testResult.statusCode }}
                  </span>
                  <span>{{ testResult.durationMs }} ms</span>
                  <span>{{ testResult.bodyType }}</span>
                </div>
              </header>
              <pre class="api-request-dialog__preview">{{
                formattedPreview
              }}</pre>
              <footer>
                <span
                  >{{ testResult.contract.length }} caminhos descobertos</span
                >
                <VBtn
                  color="primary"
                  variant="tonal"
                  size="small"
                  @click="activeTab = 'mapping'"
                >
                  Configurar de/para
                  <VIcon icon="tabler-arrow-right" size="16" class="ms-1" />
                </VBtn>
              </footer>
            </section>

            <section
              v-else-if="draft.test.evidence"
              class="api-request-dialog__evidence"
            >
              <span class="api-request-dialog__evidence-icon">
                <VIcon icon="tabler-shield-check" size="20" />
              </span>
              <div>
                <strong>Configuração testada</strong>
                <p>
                  HTTP {{ draft.test.evidence.statusCode }} ·
                  {{ draft.test.evidence.bodyType }} ·
                  {{ new Date(draft.test.evidence.testedAt).toLocaleString() }}
                </p>
              </div>
            </section>
          </section>

          <section v-else class="api-request-dialog__panel">
            <ApiResponseMappingPanel
              :model-value="draft.capture"
              :output-key="draft.outputKey"
              :disabled="props.readOnly"
              @update:model-value="replaceDraft({ ...draft, capture: $event })"
            />
            <VAlert
              v-if="mappingError"
              color="error"
              variant="tonal"
              density="compact"
              icon="tabler-alert-circle"
            >
              {{ mappingError }}
            </VAlert>
          </section>
        </VCardText>
      </div>

      <VDivider />

      <footer class="api-request-dialog__footer">
        <div class="api-request-dialog__footer-state">
          <VIcon
            :icon="
              canSave ? 'tabler-shield-check' : 'tabler-shield-exclamation'
            "
            :color="canSave ? 'success' : 'warning'"
            size="18"
          />
          <span v-if="props.readOnly">Visualização somente leitura.</span>
          <span v-else-if="draft.test.state !== 'tested'">
            Teste a configuração atual para habilitar a aplicação.
          </span>
          <span v-else-if="saveErrors.length">{{ saveErrors[0] }}</span>
          <span v-else>Pronta para aplicar ao fluxo.</span>
        </div>
        <div class="api-request-dialog__footer-actions">
          <VBtn variant="text" :disabled="isTesting" @click="close">
            {{ props.readOnly ? 'Fechar' : 'Cancelar' }}
          </VBtn>
          <VBtn
            v-if="!props.readOnly"
            color="primary"
            :disabled="!canSave"
            @click="save"
          >
            <VIcon icon="tabler-check" size="18" class="me-1" />
            Aplicar configuração
          </VBtn>
        </div>
      </footer>
    </VCard>
  </VDialog>
</template>

<style scoped>
.api-request-dialog {
  --api-grid-color: rgba(var(--v-theme-primary), 0.035);
  block-size: min(890px, 92vh);
  border: 1px solid rgba(var(--v-border-color), 0.9);
  border-radius: 18px !important;
  box-shadow: 0 28px 80px rgba(13, 31, 54, 0.22) !important;
  overflow: hidden;
}

.api-request-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-block-size: 88px;
  padding: 16px 20px;
  background:
    linear-gradient(
      105deg,
      rgba(var(--v-theme-primary), 0.07),
      transparent 45%
    ),
    repeating-linear-gradient(
      90deg,
      transparent 0 31px,
      var(--api-grid-color) 32px
    ),
    rgb(var(--v-theme-surface));
}

.api-request-dialog__identity,
.api-request-dialog__header-meta {
  display: flex;
  align-items: center;
}

.api-request-dialog__identity {
  gap: 13px;
  min-inline-size: 0;
}

.api-request-dialog__icon {
  position: relative;
  display: grid;
  block-size: 46px;
  inline-size: 46px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.28);
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.api-request-dialog__icon::after {
  position: absolute;
  inset-block-end: -3px;
  inset-inline-end: -3px;
  block-size: 10px;
  inline-size: 10px;
  border: 2px solid rgb(var(--v-theme-surface));
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
  content: '';
}

.api-request-dialog__eyebrow-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgb(var(--v-theme-primary));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.59375rem;
  font-weight: 800;
  letter-spacing: 0.11em;
}

.api-request-dialog__serial {
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.1);
  letter-spacing: 0.04em;
}

.api-request-dialog__title {
  margin-block-start: 2px;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.125rem;
  font-weight: 760;
  line-height: 1.25;
}

.api-request-dialog__subtitle {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.75rem;
}

.api-request-dialog__header-meta {
  gap: 9px;
  min-inline-size: 0;
}

.api-request-dialog__method {
  padding: 5px 8px;
  border: 1px solid currentColor;
  border-radius: 6px;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  font-weight: 850;
  letter-spacing: 0.07em;
}

.api-request-dialog__method--get,
.api-request-dialog__method--head,
.api-request-dialog__method--options {
  background: rgba(var(--v-theme-info), 0.08);
  color: rgb(var(--v-theme-info));
}

.api-request-dialog__method--post {
  background: rgba(var(--v-theme-success), 0.08);
  color: rgb(var(--v-theme-success));
}

.api-request-dialog__method--put,
.api-request-dialog__method--patch {
  background: rgba(var(--v-theme-warning), 0.08);
  color: rgb(var(--v-theme-warning));
}

.api-request-dialog__method--delete {
  background: rgba(var(--v-theme-error), 0.08);
  color: rgb(var(--v-theme-error));
}

.api-request-dialog__host {
  max-inline-size: 180px;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-request-dialog__workspace {
  display: grid;
  grid-template-columns: 204px minmax(0, 1fr);
  min-block-size: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.api-request-dialog__rail {
  display: flex;
  min-block-size: 0;
  flex-direction: column;
  gap: 5px;
  padding: 12px 9px;
  border-inline-end: 1px solid rgba(var(--v-border-color), 0.72);
  background:
    linear-gradient(
      rgba(var(--v-theme-on-surface), 0.018),
      rgba(var(--v-theme-on-surface), 0.006)
    ),
    repeating-linear-gradient(
      0deg,
      transparent 0 23px,
      rgba(var(--v-theme-on-surface), 0.018) 24px
    );
}

.api-request-dialog__rail-item {
  position: relative;
  display: grid;
  grid-template-columns: 28px 20px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 6px;
  min-block-size: 44px;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 650;
  text-align: start;
  transition:
    color 150ms ease,
    background-color 150ms ease,
    border-color 150ms ease;
}

.api-request-dialog__rail-item:hover {
  background: rgba(var(--v-theme-primary), 0.04);
  color: rgba(var(--v-theme-on-surface), 0.82);
}

.api-request-dialog__rail-item--active {
  border-color: rgba(var(--v-theme-primary), 0.16);
  background: rgba(var(--v-theme-primary), 0.075);
  color: rgb(var(--v-theme-primary));
}

.api-request-dialog__rail-item--active::before {
  position: absolute;
  inset-block: 8px;
  inset-inline-start: -10px;
  inline-size: 3px;
  border-radius: 0 3px 3px 0;
  background: rgb(var(--v-theme-primary));
  content: '';
}

.api-request-dialog__rail-index {
  display: grid;
  block-size: 24px;
  inline-size: 24px;
  place-items: center;
  border: 1px solid rgba(var(--v-border-color), 0.7);
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.025);
  color: rgba(var(--v-theme-on-surface), 0.34);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.5625rem;
  font-weight: 800;
}

.api-request-dialog__rail-item--active .api-request-dialog__rail-index {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.api-request-dialog__rail-icon {
  justify-self: center;
}

.api-request-dialog__rail-label {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-request-dialog__rail-state {
  justify-self: end;
}

.api-request-dialog__rail-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-block-start: auto;
  padding: 10px;
  border: 1px solid rgba(var(--v-theme-success), 0.14);
  border-radius: 9px;
  background: rgba(var(--v-theme-success), 0.045);
  color: rgb(var(--v-theme-success));
  font-size: 0.6875rem;
  font-weight: 700;
}

.api-request-dialog__rail-note small {
  display: block;
  margin-block-start: 2px;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.5625rem;
  font-weight: 500;
}

.api-request-dialog__content {
  min-block-size: 0;
  padding: 0 !important;
  overflow-y: auto;
}

.api-request-dialog__panel {
  display: grid;
  gap: 16px;
  max-inline-size: 1020px;
  margin-inline: auto;
  padding: 22px;
}

.api-request-dialog__panel-heading > span {
  color: rgb(var(--v-theme-primary));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.59375rem;
  font-weight: 850;
  letter-spacing: 0.12em;
}

.api-request-dialog__panel-heading h3 {
  margin-block-start: 4px;
  color: rgba(var(--v-theme-on-surface), 0.94);
  font-size: 1.0625rem;
  font-weight: 760;
}

.api-request-dialog__panel-heading p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.75rem;
}

.api-request-dialog__endpoint {
  display: grid;
  grid-template-columns: 144px minmax(0, 1fr);
  align-items: start;
  gap: 8px 12px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-primary), 0.17);
  border-radius: 12px;
  background: linear-gradient(
    105deg,
    rgba(var(--v-theme-primary), 0.045),
    transparent 60%
  );
}

.api-request-dialog__endpoint-control {
  display: grid;
  min-inline-size: 0;
  gap: 6px;
}

.api-request-dialog__endpoint-label {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.6875rem;
  font-weight: 750;
  letter-spacing: 0.025em;
  line-height: 1.2;
}

.api-request-dialog__method-select,
.api-request-dialog__url-field {
  min-inline-size: 0;
}

.api-request-dialog__method-select :deep(.v-field),
.api-request-dialog__url-field :deep(.v-field) {
  block-size: 44px;
  min-block-size: 44px;
}

.api-request-dialog__method-select :deep(.v-field__input),
.api-request-dialog__url-field :deep(.v-field__input) {
  min-block-size: 44px;
  padding-block: 0;
}

.api-request-dialog__method-select :deep(input) {
  color: rgb(var(--v-theme-primary));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-weight: 800;
}

.api-request-dialog__url-field :deep(input) {
  text-overflow: ellipsis;
}

.api-request-dialog__endpoint-hint {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
  line-height: 1.35;
}

.api-request-dialog__request-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

.api-request-dialog__execution-modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.api-request-dialog__execution-mode {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(var(--v-border-color), 0.86);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.8);
  cursor: pointer;
  font: inherit;
  text-align: start;
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;
}

.api-request-dialog__execution-mode:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.42);
  transform: translateY(-1px);
}

.api-request-dialog__execution-mode--active {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.045);
}

.api-request-dialog__execution-mode > span {
  display: grid;
  block-size: 38px;
  inline-size: 38px;
  grid-row: span 2;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}

.api-request-dialog__execution-mode strong,
.api-request-dialog__execution-mode small {
  display: block;
  grid-column: 2;
}

.api-request-dialog__execution-mode strong {
  font-size: 0.8125rem;
}

.api-request-dialog__execution-mode small {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
}

.api-request-dialog__execution-mode > :last-child {
  grid-column: 3;
  grid-row: 1 / span 2;
}

.api-request-dialog__runtime-card {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgba(var(--v-border-color), 0.82);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.api-request-dialog__runtime-card > header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.api-request-dialog__runtime-icon {
  display: grid;
  block-size: 36px;
  inline-size: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-info), 0.09);
  color: rgb(var(--v-theme-info));
}

.api-request-dialog__runtime-icon--amber {
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
}

.api-request-dialog__runtime-card h4 {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.8125rem;
  font-weight: 750;
}

.api-request-dialog__runtime-card header p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
}

.api-request-dialog__field {
  display: grid;
  min-inline-size: 0;
  gap: 6px;
}

.api-request-dialog__field-label {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.6875rem;
  font-weight: 750;
  letter-spacing: 0.025em;
  line-height: 1.2;
}

.api-request-dialog__field-control {
  min-inline-size: 0;
}

.api-request-dialog__field-control :deep(.v-field) {
  block-size: 44px;
  min-block-size: 44px;
}

.api-request-dialog__field-control :deep(.v-field__input) {
  min-block-size: 44px;
  padding-block: 0;
}

.api-request-dialog__field-hint {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.api-request-dialog__runtime-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 10px;
}

.api-request-dialog__runtime-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.api-request-dialog__test-console,
.api-request-dialog__response {
  border: 1px solid rgba(var(--v-border-color), 0.85);
  border-radius: 13px;
  overflow: hidden;
}

.api-request-dialog__test-console-head {
  display: flex;
  align-items: center;
  gap: 11px;
  min-block-size: 42px;
  padding: 7px 12px;
  border-block-end: 1px solid rgba(255, 255, 255, 0.08);
  background: #172131;
  color: #dbe7f5;
}

.api-request-dialog__test-console-head > code {
  overflow: hidden;
  flex: 1;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-request-dialog__traffic-lights {
  display: flex;
  gap: 5px;
}

.api-request-dialog__traffic-lights span {
  block-size: 7px;
  inline-size: 7px;
  border-radius: 50%;
  background: #fa5f57;
}

.api-request-dialog__traffic-lights span:nth-child(2) {
  background: #f6bd4f;
}

.api-request-dialog__traffic-lights span:nth-child(3) {
  background: #52c977;
}

.api-request-dialog__test-body {
  display: grid;
  gap: 14px;
  padding: 18px;
  background: rgb(var(--v-theme-surface));
}

.api-request-dialog__test-copy {
  display: flex;
  align-items: center;
  gap: 11px;
}

.api-request-dialog__test-icon {
  display: grid;
  block-size: 44px;
  inline-size: 44px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}

.api-request-dialog__test-copy h4 {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.875rem;
  font-weight: 760;
}

.api-request-dialog__test-copy p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.53);
  font-size: 0.71875rem;
}

.api-request-dialog__sample-vars {
  border: 1px solid rgba(var(--v-border-color), 0.75);
  border-radius: 10px;
  overflow: hidden;
}

.api-request-dialog__sample-vars > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.62);
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.api-request-dialog__sample-vars h5 {
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.75rem;
  font-weight: 740;
}

.api-request-dialog__sample-vars p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.625rem;
}

.api-request-dialog__sample-rows {
  display: grid;
  gap: 7px;
  padding: 8px;
}

.api-request-dialog__sample-row {
  display: grid;
  grid-template-columns: minmax(210px, 0.8fr) minmax(260px, 1.2fr);
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border: 1px solid rgba(var(--v-border-color), 0.62);
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.012);
}

.api-request-dialog__sample-row--missing {
  border-color: rgba(var(--v-theme-warning), 0.3);
  background: rgba(var(--v-theme-warning), 0.035);
}

.api-request-dialog__sample-variable {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: 9px;
}

.api-request-dialog__sample-variable > span,
.api-request-dialog__sample-empty > span {
  display: grid;
  block-size: 32px;
  inline-size: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}

.api-request-dialog__sample-variable > div {
  display: grid;
  min-inline-size: 0;
  gap: 3px;
}

.api-request-dialog__sample-variable small {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.59375rem;
  font-weight: 650;
}

.api-request-dialog__sample-variable code {
  overflow: hidden;
  color: rgb(var(--v-theme-info));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-request-dialog__sample-row .api-request-dialog__field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.api-request-dialog__sample-row .api-request-dialog__field-label span {
  color: rgb(var(--v-theme-warning));
  font-size: 0.5625rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.api-request-dialog__sample-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px;
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.api-request-dialog__sample-empty > span {
  background: rgba(var(--v-theme-success), 0.1);
  color: rgb(var(--v-theme-success));
}

.api-request-dialog__sample-empty strong {
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.6875rem;
}

.api-request-dialog__sample-empty p {
  margin: 2px 0 0;
}

.api-request-dialog__side-effect-label {
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.75rem;
  font-weight: 600;
}

.api-request-dialog__error-line {
  margin: 0;
}

.api-request-dialog__error-line + .api-request-dialog__error-line {
  margin-block-start: 3px;
}

.api-request-dialog__response-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.68);
}

.api-request-dialog__response-head > div:first-child > span {
  color: rgb(var(--v-theme-info));
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.5625rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.api-request-dialog__response-head h4 {
  margin-block-start: 2px;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.8125rem;
}

.api-request-dialog__response-stats {
  display: flex;
  gap: 7px;
}

.api-request-dialog__response-stats span {
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.045);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.625rem;
  font-weight: 700;
}

.api-request-dialog__preview {
  max-block-size: 300px;
  min-block-size: 120px;
  margin: 0;
  padding: 16px;
  overflow: auto;
  background: #111927;
  color: #d8e4f2;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.6875rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.api-request-dialog__response > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
}

.api-request-dialog__evidence {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px;
  border: 1px solid rgba(var(--v-theme-success), 0.2);
  border-radius: 10px;
  background: rgba(var(--v-theme-success), 0.05);
}

.api-request-dialog__evidence-icon {
  display: grid;
  block-size: 36px;
  inline-size: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-success), 0.1);
  color: rgb(var(--v-theme-success));
}

.api-request-dialog__evidence strong {
  color: rgb(var(--v-theme-success));
  font-size: 0.78125rem;
}

.api-request-dialog__evidence p {
  margin: 2px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.625rem;
}

.api-request-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-block-size: 66px;
  padding: 11px 18px;
  background: rgba(var(--v-theme-on-surface), 0.014);
}

.api-request-dialog__footer-state,
.api-request-dialog__footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.api-request-dialog__footer-state {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.71875rem;
}

@media (max-width: 960px) {
  .api-request-dialog__workspace {
    grid-template-columns: 1fr;
  }

  .api-request-dialog__rail {
    display: flex;
    flex-direction: row;
    gap: 6px;
    padding: 8px;
    border-block-end: 1px solid rgba(var(--v-border-color), 0.72);
    border-inline-end: 0;
    overflow-x: auto;
  }

  .api-request-dialog__rail-item {
    min-inline-size: 170px;
    flex: 1 0 170px;
  }

  .api-request-dialog__rail-item--active::before,
  .api-request-dialog__rail-note {
    display: none;
  }
}

@media (max-width: 720px) {
  .api-request-dialog {
    block-size: 100vh;
    border-radius: 0 !important;
  }

  .api-request-dialog__header {
    align-items: flex-start;
    padding: 13px;
  }

  .api-request-dialog__subtitle,
  .api-request-dialog__host,
  .api-request-dialog__header-meta > :nth-child(3) {
    display: none;
  }

  .api-request-dialog__header-meta {
    margin-inline-start: auto;
  }

  .api-request-dialog__rail {
    overflow-x: auto;
  }

  .api-request-dialog__rail-item {
    min-inline-size: 164px;
    flex-basis: 164px;
  }

  .api-request-dialog__panel {
    padding: 14px;
  }

  .api-request-dialog__endpoint,
  .api-request-dialog__execution-modes,
  .api-request-dialog__runtime-grid,
  .api-request-dialog__runtime-grid--three {
    grid-template-columns: 1fr;
  }

  .api-request-dialog__sample-row {
    grid-template-columns: 1fr;
  }

  .api-request-dialog__response-head,
  .api-request-dialog__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .api-request-dialog__footer-actions {
    justify-content: flex-end;
    inline-size: 100%;
  }
}
</style>
