<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, shallowRef } from 'vue';
import type { Component } from 'vue';
import { publicApiOrigin } from '../apiPublicConfig';

type LoadStatus = 'loading' | 'ready' | 'error';

const ptBrScalarTranslations = {
  common: {
    additionalProperties: 'propriedades adicionais',
    const: 'constante',
    deprecated: 'obsoleto',
    description: 'Descrição',
    discriminator: 'Discriminador',
    enum: 'enum',
    format: 'Formato',
    greaterThan: 'maior que',
    httpMethod: 'Método HTTP',
    keys: 'chaves',
    lessThan: 'menor que',
    max: 'máximo',
    min: 'mínimo',
    maxLength: 'tamanho máximo',
    minLength: 'tamanho mínimo',
    multipleOf: 'múltiplo de',
    nullable: 'aceita nulo',
    path: 'Caminho',
    propertyNames: 'nomes das propriedades',
    pattern: 'Padrão',
    readOnly: 'somente leitura',
    required: 'obrigatório',
    hideValues: 'Ocultar valores',
    showAllValues: 'Mostrar todos os valores',
    type: 'Tipo',
    unique: 'único',
    values: 'valores',
    writeOnly: 'somente escrita',
  },
  search: {
    label: 'Buscar',
    inputLabel: 'Digite a busca',
    open: 'Abrir busca',
    placeholder: 'Buscar endpoints…',
    clear: 'Limpar busca',
    keyboardShortcut: 'Atalho:',
    command: 'Command',
    control: 'Control',
    results: 'Resultados da referência',
    navigate: 'Navegar',
    select: 'Selecionar',
    instructions:
      'Use as setas para navegar, Enter para selecionar e digite para filtrar',
    entryHeading: 'Título',
    entryOperation: 'Operação',
    entryTag: 'Tag',
    entryTagGroup: 'Grupo de tags',
    entryWebhook: 'Webhook',
  },
  navigation: {
    introduction: 'Introdução',
    closeGroup: 'Fechar grupo',
    closeMenu: 'Fechar menu',
    openGroup: 'Abrir grupo',
    openMenu: 'Abrir menu',
    operations: 'Operações',
    endpoints: 'Endpoints de {name}',
    showAllEndpoints: 'Mostrar todos os endpoints de {name}',
    sidebarFor: 'Navegação de {name}',
    mainContent: 'Documentação da API {name}',
    collapsed: 'Recolhido',
    webhooks: 'Webhooks',
  },
  server: {
    label: 'Servidor',
    select: 'Selecione um servidor',
  },
  info: { termsOfService: 'Termos de serviço' },
  asyncapi: {
    servers: 'Servidores',
    protocols: 'Protocolos',
  },
  clientLibraries: {
    heading: 'Bibliotecas de cliente',
    more: 'Mais',
    selectAll: 'Selecionar entre todos os clientes',
  },
  operation: {
    body: 'Corpo',
    cookies: 'Cookies',
    headers: 'Headers',
    pathParameters: 'Parâmetros de caminho',
    queryParameters: 'Parâmetros de query',
    requestBody: 'Corpo da requisição',
    responses: 'Respostas',
    testRequest: 'Testar requisição',
    webhook: 'Webhook',
    selectedContentType: 'Content-Type selecionado',
    hideHeaders: 'Ocultar headers',
    showHeaders: 'Mostrar headers',
    callbacks: 'Callbacks',
  },
  response: {
    exampleResponses: 'Exemplos de resposta',
    noBody: 'Sem corpo',
    showSchema: 'Mostrar schema',
    status: 'Status',
  },
  schema: {
    example: 'Exemplo',
    examples: 'Exemplos',
    default: 'Padrão',
    schema: 'Schema',
    emptyObject: 'Objeto vazio',
    showAdditionalProperties: 'Mostrar propriedades adicionais',
    childAttributes: 'Atributos filhos',
    hideChildAttributes: 'Ocultar {name}',
    showChildAttributes: 'Mostrar {name}',
    forName: 'para {name}',
    showSchemaDetails: 'Mostrar detalhes do schema',
    oneOf: 'Uma opção entre',
    anyOf: 'Qualquer opção entre',
    allOf: 'Todas as opções',
    not: 'Não',
    unknownType: 'tipo desconhecido',
  },
  download: {
    openapi: 'Baixar documento OpenAPI',
    asyncapi: 'Baixar documento AsyncAPI',
  },
  models: { label: 'Schemas' },
  actions: {
    copyLink: 'Copiar link',
    copyLinkTo: 'Copiar link de {name}',
    copyToClipboard: 'Copiar link',
    copyEndpointUrl: 'Copiar URL do endpoint',
    showMore: 'Mostrar mais',
  },
  footer: { poweredByScalar: 'Desenvolvido com Scalar' },
  authentication: {
    title: 'Autenticação',
    accepts: 'Aceita',
    allOf: 'todos:',
    authentication: 'autenticação',
    optional: 'Autenticação opcional',
    oneOf: 'uma opção entre:',
    required: 'Autenticação obrigatória',
    requires: 'Exige',
  },
};

const status = shallowRef<LoadStatus>('loading');
const errorMessage = shallowRef('');
const specification = shallowRef<Record<string, unknown> | null>(null);
const scalarComponent = shallowRef<Component | null>(null);
const isDark = shallowRef(false);

const openApiUrl = `${publicApiOrigin}/docs/openapi.json`;

let requestController: AbortController | undefined;
let colorModeObserver: MutationObserver | undefined;

const scalarConfiguration = computed(() => ({
  content: specification.value,
  title: 'Underchat Public API',
  theme: 'none' as const,
  layout: 'modern' as const,
  showSidebar: true,
  hideSearch: false,
  hideModels: false,
  modelsSectionLabel: 'Schemas',
  showOperationId: true,
  operationTitleSource: 'summary' as const,
  localization: {
    locale: 'pt-BR',
    direction: 'ltr' as const,
    translations: ptBrScalarTranslations,
  },
  documentDownloadType: 'both' as const,
  hideTestRequestButton: false,
  hideClientButton: true,
  hideDarkModeToggle: true,
  showDeveloperTools: 'never' as const,
  agent: {
    disabled: true,
    hideAddApi: true,
  },
  mcp: {
    disabled: true,
  },
  forceDarkModeState: isDark.value ? ('dark' as const) : ('light' as const),
  persistAuth: false,
  telemetry: false,
  defaultHttpClient: {
    targetKey: 'shell',
    clientKey: 'curl',
  },
  customCss: `
    .scalar-app {
      --scalar-font: 'Manrope', sans-serif;
      --scalar-font-code: 'IBM Plex Mono', monospace;
      --scalar-radius: 8px;
      --scalar-radius-lg: 12px;
      --scalar-radius-xl: 16px;
    }
  `,
}));

function isOpenApiDocument(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const document = value as Record<string, unknown>;
  return (
    typeof document.openapi === 'string' || typeof document.swagger === 'string'
  );
}

async function loadReference() {
  requestController?.abort();
  requestController = new AbortController();
  status.value = 'loading';
  errorMessage.value = '';

  try {
    const [response, scalarModule] = await Promise.all([
      fetch(openApiUrl, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: requestController.signal,
      }),
      import('@scalar/api-reference'),
    ]);

    if (!response.ok) {
      throw new Error(`A API respondeu com HTTP ${response.status}.`);
    }

    const document: unknown = await response.json();
    if (!isOpenApiDocument(document)) {
      throw new Error('A resposta não contém um documento OpenAPI válido.');
    }

    specification.value = document;
    scalarComponent.value = markRaw(scalarModule.ApiReference);
    status.value = 'ready';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;

    errorMessage.value =
      error instanceof Error
        ? error.message
        : 'Falha inesperada ao carregar o contrato.';
    status.value = 'error';
  }
}

onMounted(() => {
  const documentElement = document.documentElement;
  const syncColorMode = () => {
    isDark.value = documentElement.classList.contains('dark');
  };

  syncColorMode();
  colorModeObserver = new MutationObserver(syncColorMode);
  colorModeObserver.observe(documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  void loadReference();
});

onBeforeUnmount(() => {
  requestController?.abort();
  colorModeObserver?.disconnect();
});
</script>

<template>
  <section class="scalar-reference-shell">
    <header class="scalar-reference-shell__header">
      <div>
        <span class="scalar-reference-shell__eyebrow"
          >Contrato OpenAPI ao vivo</span
        >
        <h1>Referência da API</h1>
        <p>
          Explore parâmetros, corpos, respostas e exemplos. O token digitado no
          “Test Request” permanece apenas na sessão atual desta página.
        </p>
      </div>
      <div class="scalar-reference-shell__source">
        <span>Fonte</span>
        <code>{{ openApiUrl }}</code>
      </div>
    </header>

    <div
      v-if="status === 'loading'"
      class="scalar-reference-state scalar-reference-state--loading"
      role="status"
      aria-live="polite"
    >
      <div class="scalar-reference-state__rail" aria-hidden="true">
        <span v-for="index in 7" :key="index" />
      </div>
      <div class="scalar-reference-state__content" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <p>Carregando o contrato OpenAPI mais recente…</p>
    </div>

    <div
      v-else-if="status === 'error'"
      class="scalar-reference-state scalar-reference-state--error"
      role="alert"
    >
      <span class="scalar-reference-state__error-code">SPEC / OFFLINE</span>
      <h2>Não foi possível abrir a referência.</h2>
      <p>{{ errorMessage }}</p>
      <p class="scalar-reference-state__hint">
        Confirme se a API está acessível e se o CORS permite a origem deste
        portal.
      </p>
      <button type="button" @click="loadReference">Tentar novamente</button>
    </div>

    <component
      :is="scalarComponent"
      v-else-if="scalarComponent && specification"
      :configuration="scalarConfiguration"
      class="scalar-reference-shell__application"
    />
  </section>
</template>

<style scoped>
.scalar-reference-shell {
  min-height: calc(100vh - var(--vp-nav-height));
  background: var(--vp-c-bg);
}

.scalar-reference-shell__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.6fr);
  gap: 40px;
  align-items: end;
  padding: 56px max(32px, calc((100vw - 1440px) / 2));
  border-bottom: 1px solid var(--uc-border);
  background:
    linear-gradient(
      110deg,
      color-mix(in srgb, var(--uc-mint) 8%, transparent),
      transparent 52%
    ),
    var(--vp-c-bg-soft);
}

.scalar-reference-shell__eyebrow,
.scalar-reference-shell__source span {
  color: var(--uc-accent-text);
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.scalar-reference-shell__header h1 {
  margin: 12px 0 10px;
  font-family: var(--uc-font-display);
  font-size: clamp(42px, 5vw, 68px);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1;
}

.scalar-reference-shell__header p {
  max-width: 720px;
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.7;
}

.scalar-reference-shell__source {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--uc-border-strong);
  border-radius: 10px;
  background: var(--uc-code-panel);
}

.scalar-reference-shell__source span {
  display: block;
  margin-bottom: 8px;
}

.scalar-reference-shell__source code {
  display: block;
  overflow: hidden;
  color: var(--uc-code-text);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scalar-reference-shell__application {
  min-height: 900px;
  --scalar-color-1: var(--vp-c-text-1);
  --scalar-color-2: var(--vp-c-text-2);
  --scalar-color-3: var(--vp-c-text-3);
  --scalar-color-accent: var(--uc-accent-text);
  --scalar-link-color: var(--uc-accent-text);
  --scalar-link-color-hover: var(--vp-c-brand-2);
  --scalar-link-color-visited: var(--uc-accent-text);
  --scalar-background-1: var(--vp-c-bg);
  --scalar-background-2: var(--vp-c-bg-soft);
  --scalar-background-3: var(--vp-c-bg-alt);
  --scalar-background-4: var(--vp-c-bg-elv);
  --scalar-background-accent: color-mix(
    in srgb,
    var(--uc-mint) 10%,
    transparent
  );
  --scalar-border-color: var(--uc-border);
  --scalar-sidebar-background-1: var(--vp-c-bg-soft);
  --scalar-sidebar-color-1: var(--vp-c-text-1);
  --scalar-sidebar-color-2: var(--vp-c-text-2);
  --scalar-sidebar-color-active: var(--uc-accent-text);
  --scalar-sidebar-border-color: var(--uc-border);
  --scalar-sidebar-item-active-background: color-mix(
    in srgb,
    var(--uc-mint) 10%,
    transparent
  );
  --scalar-sidebar-item-hover-background: color-mix(
    in srgb,
    var(--uc-mint) 7%,
    transparent
  );
  --scalar-sidebar-search-background: var(--vp-c-bg-elv);
  --scalar-sidebar-search-border-color: var(--uc-border-strong);
  --scalar-sidebar-search-color: var(--vp-c-text-1);
  --scalar-header-background-1: var(--vp-c-bg);
  --scalar-header-background-2: var(--vp-c-bg-soft);
  --scalar-header-border-color: var(--uc-border);
  --scalar-header-color-1: var(--vp-c-text-1);
  --scalar-header-color-2: var(--vp-c-text-2);
}

.scalar-reference-state {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 650px;
  padding: 60px 24px;
}

.scalar-reference-state--loading {
  grid-template-columns: 240px 1fr;
  grid-template-rows: 1fr auto;
  gap: 0;
  max-width: 1280px;
  margin: 0 auto;
}

.scalar-reference-state__rail {
  display: flex;
  align-self: stretch;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  padding: 46px 32px;
  border-right: 1px solid var(--uc-border);
}

.scalar-reference-state__rail span,
.scalar-reference-state__content i {
  display: block;
  border-radius: 5px;
  background: linear-gradient(
    90deg,
    var(--vp-c-bg-soft),
    color-mix(in srgb, var(--uc-mint) 9%, var(--vp-c-bg-soft)),
    var(--vp-c-bg-soft)
  );
  background-size: 220% 100%;
  animation: skeleton 1.8s ease-in-out infinite;
}

.scalar-reference-state__rail span {
  width: 80%;
  height: 10px;
}

.scalar-reference-state__rail span:nth-child(3n) {
  width: 58%;
}

.scalar-reference-state__content {
  align-self: stretch;
  width: 100%;
  padding: 48px 7vw;
}

.scalar-reference-state__content i {
  width: 68%;
  height: 18px;
  margin-bottom: 28px;
}

.scalar-reference-state__content i:first-child {
  width: 42%;
  height: 44px;
}

.scalar-reference-state__content i:last-child {
  width: 100%;
  height: 230px;
}

.scalar-reference-state--loading p {
  grid-column: 1 / -1;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}

.scalar-reference-state--error {
  align-content: center;
  text-align: center;
}

.scalar-reference-state__error-code {
  color: #db6d72;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.15em;
}

.scalar-reference-state--error h2 {
  margin: 20px 0 12px;
  font-family: var(--uc-font-display);
  font-size: 40px;
}

.scalar-reference-state--error p {
  max-width: 620px;
  margin: 0 0 8px;
  color: var(--vp-c-text-2);
}

.scalar-reference-state__hint {
  font-size: 13px;
}

.scalar-reference-state--error button {
  margin-top: 22px;
  padding: 11px 17px;
  border: 1px solid var(--uc-mint);
  border-radius: 8px;
  background: var(--uc-mint);
  color: #062019;
  font-family: var(--vp-font-family-base);
  font-weight: 800;
  cursor: pointer;
}

@keyframes skeleton {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -120% 0;
  }
}

@media (max-width: 800px) {
  .scalar-reference-shell__header {
    grid-template-columns: 1fr;
    padding: 40px 20px;
  }

  .scalar-reference-state--loading {
    grid-template-columns: 1fr;
  }

  .scalar-reference-state__rail {
    display: none;
  }

  .scalar-reference-state__content {
    padding-inline: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scalar-reference-state__rail span,
  .scalar-reference-state__content i {
    animation: none;
  }
}
</style>
