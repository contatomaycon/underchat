<script setup lang="ts">
import ApiVariableField from './ApiVariableField.vue';
import type {
  ApiRequestAuthConfig,
  ApiRequestAuthType,
  ApiRequestProtectedValue,
  ApiRequestVariable,
} from './types';

interface Props {
  variables?: readonly ApiRequestVariable[];
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variables: () => [],
  disabled: false,
});
const model = defineModel<ApiRequestAuthConfig>({ required: true });

const authTypes: Array<{
  value: ApiRequestAuthType;
  label: string;
  icon: string;
}> = [
  { value: 'none', label: 'Sem autenticação', icon: 'tabler-lock-off' },
  { value: 'bearer', label: 'Bearer', icon: 'tabler-key' },
  { value: 'apiKey', label: 'API Key', icon: 'tabler-key' },
  { value: 'basic', label: 'Basic', icon: 'tabler-shield-lock' },
];

const updateType = (value: ApiRequestAuthType): void => {
  model.value = { ...model.value, type: value };
};

const updateProtectedValue = (
  section: 'bearer' | 'apiKey' | 'basic',
  key: 'token' | 'value' | 'username' | 'password',
  value: string
): void => {
  const currentSection = model.value[section] as Record<
    string,
    string | ApiRequestProtectedValue
  >;
  const currentValue = currentSection[key] as ApiRequestProtectedValue;

  model.value = {
    ...model.value,
    [section]: {
      ...currentSection,
      [key]: {
        ...currentValue,
        value,
        hasValue: Boolean(value),
      },
    },
  };
};

const updateApiKey = (patch: Partial<ApiRequestAuthConfig['apiKey']>): void => {
  model.value = {
    ...model.value,
    apiKey: { ...model.value.apiKey, ...patch },
  };
};

const protectedPlaceholder = (value: ApiRequestProtectedValue): string =>
  value.hasValue && !value.value ? 'Valor protegido já configurado' : '';
</script>

<template>
  <section class="auth-editor">
    <header class="auth-editor__header">
      <div>
        <h4 class="auth-editor__title">Autenticação</h4>
        <p class="auth-editor__description">
          Credenciais estáticas são protegidas; variáveis são resolvidas durante
          o fluxo.
        </p>
      </div>
      <span class="auth-editor__shield" aria-hidden="true">
        <VIcon icon="tabler-shield-lock" size="19" />
      </span>
    </header>

    <div class="auth-editor__body">
      <div
        class="auth-editor__types"
        role="tablist"
        aria-label="Tipo de autenticação"
      >
        <button
          v-for="authType in authTypes"
          :key="authType.value"
          type="button"
          role="tab"
          class="auth-editor__type"
          :class="{
            'auth-editor__type--active': model.type === authType.value,
          }"
          :aria-selected="model.type === authType.value"
          :disabled="props.disabled"
          @click="updateType(authType.value)"
        >
          <VIcon :icon="authType.icon" size="16" />
          <span>{{ authType.label }}</span>
        </button>
      </div>

      <div v-if="model.type === 'none'" class="auth-editor__empty">
        <VIcon icon="tabler-circle-dashed" size="18" />
        A requisição será enviada sem credenciais de autenticação.
      </div>

      <div v-else-if="model.type === 'bearer'" class="auth-editor__fields">
        <div class="auth-editor__field">
          <span class="auth-editor__field-label">Token Bearer</span>
          <ApiVariableField
            :model-value="model.bearer.token.value"
            :variables="props.variables"
            :placeholder="
              protectedPlaceholder(model.bearer.token) ||
              '{{ api_1.data.access_token }}'
            "
            :disabled="props.disabled"
            type="password"
            aria-label="Token Bearer"
            monospace
            hide-details
            @update:model-value="
              updateProtectedValue('bearer', 'token', $event)
            "
          />
          <small class="auth-editor__field-hint">
            O prefixo Bearer é adicionado automaticamente.
          </small>
        </div>
      </div>

      <div
        v-else-if="model.type === 'apiKey'"
        class="auth-editor__fields auth-editor__fields--api-key"
      >
        <div class="auth-editor__field">
          <span class="auth-editor__field-label">Enviar em</span>
          <VSelect
            :model-value="model.apiKey.placement"
            :items="[
              { value: 'header', title: 'Header' },
              { value: 'query', title: 'Query string' },
            ]"
            :disabled="props.disabled"
            aria-label="Local da API Key"
            variant="outlined"
            density="compact"
            hide-details
            @update:model-value="updateApiKey({ placement: $event })"
          />
        </div>

        <div class="auth-editor__field">
          <span class="auth-editor__field-label">Nome da chave</span>
          <VTextField
            :model-value="model.apiKey.name"
            :disabled="props.disabled"
            aria-label="Nome da API Key"
            placeholder="X-API-Key"
            variant="outlined"
            density="compact"
            hide-details
            @update:model-value="updateApiKey({ name: $event ?? '' })"
          />
        </div>

        <div class="auth-editor__field">
          <span class="auth-editor__field-label">Valor</span>
          <ApiVariableField
            :model-value="model.apiKey.value.value"
            :variables="props.variables"
            :placeholder="
              protectedPlaceholder(model.apiKey.value) || 'Valor ou variável'
            "
            :disabled="props.disabled"
            type="password"
            aria-label="Valor da API Key"
            monospace
            hide-details
            @update:model-value="
              updateProtectedValue('apiKey', 'value', $event)
            "
          />
        </div>
      </div>

      <div v-else class="auth-editor__fields auth-editor__fields--basic">
        <div class="auth-editor__field">
          <span class="auth-editor__field-label">Usuário</span>
          <ApiVariableField
            :model-value="model.basic.username.value"
            :variables="props.variables"
            :placeholder="
              protectedPlaceholder(model.basic.username) ||
              'Usuário ou variável'
            "
            :disabled="props.disabled"
            aria-label="Usuário da autenticação Basic"
            monospace
            hide-details
            @update:model-value="
              updateProtectedValue('basic', 'username', $event)
            "
          />
        </div>

        <div class="auth-editor__field">
          <span class="auth-editor__field-label">Senha</span>
          <ApiVariableField
            :model-value="model.basic.password.value"
            :variables="props.variables"
            :placeholder="
              protectedPlaceholder(model.basic.password) || 'Senha ou variável'
            "
            :disabled="props.disabled"
            type="password"
            aria-label="Senha da autenticação Basic"
            monospace
            hide-details
            @update:model-value="
              updateProtectedValue('basic', 'password', $event)
            "
          />
        </div>
      </div>

      <p v-if="model.type !== 'none'" class="auth-editor__footnote">
        <VIcon icon="tabler-info-circle" size="15" />
        Para esquemas personalizados, adicione o valor diretamente na seção
        Headers.
      </p>
    </div>
  </section>
</template>

<style scoped>
.auth-editor {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}

.auth-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.7);
  background: linear-gradient(
    100deg,
    rgba(var(--v-theme-primary), 0.045),
    transparent 55%
  );
}

.auth-editor__title {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.015em;
}

.auth-editor__description {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.75rem;
  line-height: 1.4;
}

.auth-editor__shield {
  display: grid;
  block-size: 34px;
  inline-size: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-success), 0.18);
  border-radius: 9px;
  background: rgba(var(--v-theme-success), 0.08);
  color: rgb(var(--v-theme-success));
}

.auth-editor__body {
  display: grid;
  gap: 16px;
  padding: 14px;
}

.auth-editor__types {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  inline-size: 100%;
  padding: 3px;
  border: 1px solid rgba(var(--v-border-color), 0.86);
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.025);
}

.auth-editor__type {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-block-size: 38px;
  min-inline-size: 0;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.62);
  cursor: pointer;
  font: inherit;
  font-size: 0.71875rem;
  font-weight: 650;
  line-height: 1.2;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.auth-editor__type span {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auth-editor__type:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.055);
  color: rgb(var(--v-theme-primary));
}

.auth-editor__type--active {
  border-color: rgba(var(--v-theme-primary), 0.2);
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 4px rgba(13, 31, 54, 0.1);
  color: rgb(var(--v-theme-primary));
}

.auth-editor__type:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.5);
  outline-offset: 1px;
}

.auth-editor__type:disabled {
  cursor: default;
  opacity: 0.52;
}

.auth-editor__fields {
  display: grid;
  gap: 12px;
}

.auth-editor__field {
  display: grid;
  min-inline-size: 0;
  gap: 6px;
}

.auth-editor__field-label {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.6875rem;
  font-weight: 750;
  letter-spacing: 0.025em;
  line-height: 1.2;
}

.auth-editor__field :deep(.v-field) {
  block-size: 44px;
  min-block-size: 44px;
}

.auth-editor__field :deep(.v-field__input) {
  min-block-size: 44px;
  padding-block: 0;
}

.auth-editor__field-hint {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
  line-height: 1.35;
}

.auth-editor__fields--api-key {
  grid-template-columns: minmax(130px, 0.55fr) minmax(160px, 0.8fr) minmax(
      220px,
      1.4fr
    );
  align-items: start;
}

.auth-editor__fields--basic {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.auth-editor__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  min-block-size: 44px;
  padding: 10px 12px;
  border: 1px dashed rgba(var(--v-border-color), 0.9);
  border-radius: 9px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.75rem;
}

.auth-editor__footnote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.6875rem;
}

@media (max-width: 760px) {
  .auth-editor__types {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .auth-editor__fields--api-key,
  .auth-editor__fields--basic {
    grid-template-columns: 1fr;
  }
}
</style>
