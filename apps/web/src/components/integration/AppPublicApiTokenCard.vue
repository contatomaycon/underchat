<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { useAbility } from '@/plugins/0.casl/composables/useAbility';
import { normalizeBaseUrl } from '@/@webcore/utils/helpers';
import { usePublicApiToken } from '@/composables/integration/usePublicApiToken';
import VDialogHandler from '@/components/VDialogHandler.vue';

type ConfirmationAction = 'generate' | 'rotate' | 'revoke' | null;
type CopiedField = 'base-url' | 'token' | null;

const { t, locale } = useI18n();
const ability = useAbility();
const {
  token,
  isConfigured,
  isLoading,
  activeAction,
  isMutating,
  error,
  success,
  loadToken,
  generateToken,
  revokeToken,
  clearFeedback,
} = usePublicApiToken();

const permissionsGenerateKey = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
  EIntegrationPermissions.integration_generate_key,
];

const canManageToken = computed(() =>
  permissionsGenerateKey.some((permission) =>
    ability.can(permission, permission)
  )
);

const publicApiUrl = computed(() => {
  const baseUrl = normalizeBaseUrl(import.meta.env.VITE_API_PUBLIC_URL);
  return baseUrl ? `${baseUrl}/v1` : '/v1';
});

const documentationUrl = computed(() => {
  const configuredUrl = normalizeBaseUrl(import.meta.env.VITE_API_DOCS_URL);
  if (configuredUrl) return configuredUrl;

  if (import.meta.env.DEV && typeof globalThis.location !== 'undefined') {
    const { protocol, hostname } = globalThis.location;
    return `${protocol}//${hostname}:5174`;
  }

  return 'https://docs.underchat.com.br';
});

const isTokenVisible = shallowRef(false);
const pendingConfirmation = shallowRef<ConfirmationAction>(null);
const copiedField = shallowRef<CopiedField>(null);
const copyError = shallowRef<string | null>(null);
let copyFeedbackTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

const isConfirmationOpen = computed({
  get: () => pendingConfirmation.value !== null,
  set: (visible: boolean) => {
    if (!visible) pendingConfirmation.value = null;
  },
});

const tokenDisplayValue = computed(() => {
  if (!isConfigured.value) return '';
  if (isTokenVisible.value && token.value.token) return token.value.token;
  if (token.value.tokenPreview) return token.value.tokenPreview;
  if (!token.value.token) return '';

  const rawToken = token.value.token;
  return `${rawToken.slice(0, 12)}${'•'.repeat(16)}${rawToken.slice(-4)}`;
});

const statusLabel = computed(() => {
  if (!canManageToken.value) return t('public_api_token_status_restricted');
  return isConfigured.value
    ? t('public_api_token_status_active')
    : t('public_api_token_status_not_configured');
});
const statusColor = computed(() => {
  if (!canManageToken.value) return 'info';
  return isConfigured.value ? 'success' : 'secondary';
});
const statusIcon = computed(() => {
  if (!canManageToken.value) return 'tabler-lock';
  return isConfigured.value ? 'tabler-circle-check' : 'tabler-circle-dashed';
});

const confirmationTitle = computed(() => {
  if (pendingConfirmation.value === 'revoke') {
    return t('public_api_token_revoke_confirm_title');
  }
  if (pendingConfirmation.value === 'rotate') {
    return t('public_api_token_rotate_confirm_title');
  }
  return t('public_api_token_generate_confirm_title');
});

const confirmationMessage = computed(() => {
  if (pendingConfirmation.value === 'revoke') {
    return t('public_api_token_revoke_confirm_message');
  }
  if (pendingConfirmation.value === 'rotate') {
    return t('public_api_token_rotate_confirm_message');
  }
  return t('public_api_token_generate_confirm_message');
});

const confirmationButton = computed(() => {
  if (pendingConfirmation.value === 'revoke') {
    return t('public_api_token_revoke');
  }
  if (pendingConfirmation.value === 'rotate') {
    return t('public_api_token_rotate');
  }
  return t('public_api_token_generate');
});

const formatTimestamp = (value: string | null): string => {
  if (!value) return t('public_api_token_never');

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('public_api_token_never');

  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const requestGenerateOrRotate = () => {
  clearFeedback();
  pendingConfirmation.value = isConfigured.value ? 'rotate' : 'generate';
};

const requestRevoke = () => {
  clearFeedback();
  pendingConfirmation.value = 'revoke';
};

const confirmTokenAction = async () => {
  const action = pendingConfirmation.value;

  if (action === 'revoke') {
    const revoked = await revokeToken();
    if (revoked) isTokenVisible.value = false;
    return;
  }

  if (action === 'generate' || action === 'rotate') {
    const generated = await generateToken();
    if (generated) isTokenVisible.value = true;
  }
};

const resetCopyFeedbackSoon = () => {
  if (copyFeedbackTimer) globalThis.clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = globalThis.setTimeout(() => {
    copiedField.value = null;
    copyError.value = null;
  }, 2400);
};

const copyValue = async (
  value: string | null,
  field: Exclude<CopiedField, null>
) => {
  if (!value) return;

  copyError.value = null;
  try {
    await globalThis.navigator.clipboard.writeText(value);
    copiedField.value = field;
  } catch {
    copiedField.value = null;
    copyError.value = t('public_api_token_copy_error');
  }
  resetCopyFeedbackSoon();
};

watch(
  canManageToken,
  async (allowed) => {
    isTokenVisible.value = false;
    if (allowed) await loadToken();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (copyFeedbackTimer) globalThis.clearTimeout(copyFeedbackTimer);
});
</script>

<template>
  <VCard class="public-api-card" data-testid="public-api-token-card">
    <div class="public-api-card__accent" />

    <VCardText class="public-api-card__content">
      <div class="public-api-card__header">
        <div class="public-api-card__heading">
          <div class="public-api-card__icon" aria-hidden="true">
            <VIcon icon="tabler-braces" size="26" />
          </div>
          <div>
            <div class="d-flex align-center flex-wrap gap-2 mb-1">
              <h2 class="public-api-card__title">
                {{ $t('public_api_title') }}
              </h2>
              <VChip
                :color="statusColor"
                size="small"
                variant="tonal"
                :prepend-icon="statusIcon"
              >
                {{ statusLabel }}
              </VChip>
            </div>
            <p class="public-api-card__subtitle">
              {{ $t('public_api_description') }}
            </p>
          </div>
        </div>

        <VBtn
          tag="a"
          :href="documentationUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="public-api-card__docs-link"
          variant="tonal"
          color="primary"
          prepend-icon="tabler-book-2"
          :aria-label="$t('public_api_open_docs')"
          data-testid="public-api-open-docs"
        >
          {{ $t('public_api_open_docs') }}
          <VIcon icon="tabler-external-link" end size="17" />
        </VBtn>
      </div>

      <VAlert
        v-if="!canManageToken"
        class="mt-6"
        color="info"
        variant="tonal"
        icon="tabler-lock"
      >
        <div class="font-weight-medium">
          {{ $t('public_api_token_permission_title') }}
        </div>
        <div class="text-body-2 mt-1">
          {{ $t('public_api_token_permission_description') }}
        </div>
      </VAlert>

      <template v-else>
        <div v-if="isLoading" class="public-api-card__skeleton mt-6">
          <VSkeletonLoader type="heading, text" />
          <VSkeletonLoader type="text, text, actions" />
        </div>

        <template v-else>
          <VAlert
            v-if="error"
            class="mt-6"
            color="error"
            variant="tonal"
            closable
            @click:close="clearFeedback"
          >
            <div
              class="d-flex align-center justify-space-between flex-wrap gap-3"
            >
              <span>{{ error }}</span>
              <VBtn
                v-if="!isConfigured"
                size="small"
                variant="text"
                prepend-icon="tabler-refresh"
                @click="loadToken"
              >
                {{ $t('public_api_token_try_again') }}
              </VBtn>
            </div>
          </VAlert>

          <VAlert
            v-if="success"
            class="mt-6"
            color="success"
            variant="tonal"
            closable
            @click:close="clearFeedback"
          >
            {{ success }}
          </VAlert>

          <VAlert v-if="copyError" class="mt-4" color="error" variant="tonal">
            {{ copyError }}
          </VAlert>

          <div class="public-api-card__grid mt-6">
            <section class="public-api-panel public-api-panel--endpoint">
              <div class="public-api-panel__eyebrow">
                <VIcon icon="tabler-world-www" size="18" />
                {{ $t('public_api_base_url') }}
              </div>
              <div class="public-api-code-row">
                <code class="public-api-code-row__value">{{
                  publicApiUrl
                }}</code>
                <IconBtn
                  :aria-label="$t('public_api_copy_base_url')"
                  @click="copyValue(publicApiUrl, 'base-url')"
                >
                  <VIcon
                    :icon="
                      copiedField === 'base-url'
                        ? 'tabler-check'
                        : 'tabler-copy'
                    "
                    :color="copiedField === 'base-url' ? 'success' : undefined"
                  />
                  <VTooltip activator="parent" location="top">
                    {{
                      copiedField === 'base-url'
                        ? $t('public_api_copied')
                        : $t('copy')
                    }}
                  </VTooltip>
                </IconBtn>
              </div>
              <p class="public-api-panel__hint">
                {{ $t('public_api_base_url_hint') }}
              </p>

              <div class="public-api-auth-preview">
                <span class="public-api-auth-preview__label">
                  {{ $t('public_api_required_headers') }}
                </span>
                <code>
                  <strong>keyapi</strong>:
                  {{ $t('public_api_token_placeholder') }}
                </code>
                <code>
                  <strong>x-underchat-user-id</strong>:
                  {{ $t('public_api_executor_placeholder') }}
                </code>
                <span class="public-api-auth-preview__hint">
                  {{ $t('public_api_executor_hint') }}
                </span>
              </div>
            </section>

            <section class="public-api-panel public-api-panel--credential">
              <div class="d-flex align-center justify-space-between gap-3 mb-3">
                <div class="public-api-panel__eyebrow mb-0">
                  <VIcon icon="tabler-key" size="18" />
                  {{ $t('public_api_token_label') }}
                </div>
                <span v-if="isConfigured" class="public-api-live-indicator">
                  <span class="public-api-live-indicator__dot" />
                  {{ $t('public_api_token_ready') }}
                </span>
              </div>

              <template v-if="isConfigured">
                <VTextField
                  :model-value="tokenDisplayValue"
                  class="public-api-token-field"
                  variant="outlined"
                  density="comfortable"
                  readonly
                  hide-details
                  autocomplete="off"
                  data-testid="public-api-token-value"
                >
                  <template #append-inner>
                    <IconBtn
                      :aria-label="
                        isTokenVisible
                          ? $t('public_api_token_hide')
                          : $t('public_api_token_reveal')
                      "
                      @click="isTokenVisible = !isTokenVisible"
                    >
                      <VIcon
                        :icon="isTokenVisible ? 'tabler-eye-off' : 'tabler-eye'"
                        size="20"
                      />
                      <VTooltip activator="parent" location="top">
                        {{
                          isTokenVisible
                            ? $t('public_api_token_hide')
                            : $t('public_api_token_reveal')
                        }}
                      </VTooltip>
                    </IconBtn>
                    <IconBtn
                      :disabled="!token.token"
                      :aria-label="$t('public_api_token_copy')"
                      @click="copyValue(token.token, 'token')"
                    >
                      <VIcon
                        :icon="
                          copiedField === 'token'
                            ? 'tabler-check'
                            : 'tabler-copy'
                        "
                        :color="copiedField === 'token' ? 'success' : undefined"
                        size="20"
                      />
                      <VTooltip activator="parent" location="top">
                        {{
                          copiedField === 'token'
                            ? $t('public_api_copied')
                            : $t('public_api_token_copy')
                        }}
                      </VTooltip>
                    </IconBtn>
                  </template>
                </VTextField>

                <div class="public-api-token-meta">
                  <div class="public-api-token-meta__item">
                    <span>{{ $t('public_api_token_created_by') }}</span>
                    <strong>{{
                      token.actorUserName || $t('public_api_token_unknown_user')
                    }}</strong>
                  </div>
                  <div class="public-api-token-meta__item">
                    <span>{{ $t('public_api_token_created_at') }}</span>
                    <strong>{{ formatTimestamp(token.createdAt) }}</strong>
                  </div>
                  <div class="public-api-token-meta__item">
                    <span>{{ $t('public_api_token_last_used') }}</span>
                    <strong>{{ formatTimestamp(token.lastUsedAt) }}</strong>
                  </div>
                </div>
              </template>

              <div v-else class="public-api-empty-token">
                <div class="public-api-empty-token__icon">
                  <VIcon icon="tabler-key-off" size="25" />
                </div>
                <div>
                  <div class="font-weight-semibold text-high-emphasis">
                    {{ $t('public_api_token_empty_title') }}
                  </div>
                  <p class="text-body-2 text-medium-emphasis mb-0 mt-1">
                    {{ $t('public_api_token_empty_description') }}
                  </p>
                </div>
              </div>

              <div class="public-api-card__actions">
                <VBtn
                  color="primary"
                  :variant="isConfigured ? 'tonal' : 'flat'"
                  :prepend-icon="isConfigured ? 'tabler-refresh' : 'tabler-key'"
                  :loading="
                    activeAction === 'generate' || activeAction === 'rotate'
                  "
                  :disabled="isMutating"
                  data-testid="public-api-token-generate"
                  @click="requestGenerateOrRotate"
                >
                  {{
                    isConfigured
                      ? $t('public_api_token_rotate')
                      : $t('public_api_token_generate')
                  }}
                </VBtn>
                <VBtn
                  v-if="isConfigured"
                  color="error"
                  variant="tonal"
                  prepend-icon="tabler-trash"
                  :loading="activeAction === 'revoke'"
                  :disabled="isMutating"
                  data-testid="public-api-token-revoke"
                  @click="requestRevoke"
                >
                  {{ $t('public_api_token_revoke') }}
                </VBtn>
              </div>
            </section>
          </div>

          <div class="public-api-security-note mt-5">
            <VIcon icon="tabler-shield-lock" size="19" />
            <span>{{ $t('public_api_token_security_note') }}</span>
          </div>
        </template>
      </template>
    </VCardText>

    <VDialogHandler
      v-if="isConfirmationOpen"
      v-model="isConfirmationOpen"
      :title="confirmationTitle"
      :message="confirmationMessage"
      :confirm-text="confirmationButton"
      @confirm="confirmTokenAction"
    />
  </VCard>
</template>

<style scoped lang="scss">
/* stylelint-disable selector-pseudo-class-no-unknown -- Vue scoped-style deep selector */
.public-api-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-primary), 0.16);
  box-shadow: 0 10px 32px rgb(33, 58, 107, 7%);
}

.public-api-card::after {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgb(var(--v-theme-primary), 0.11),
    transparent 68%
  );
  block-size: 19rem;
  content: '';
  inline-size: 19rem;
  inset-block-start: -8rem;
  inset-inline-end: -6rem;
  pointer-events: none;
}

.public-api-card__accent {
  position: absolute;
  z-index: 2;
  background: linear-gradient(
    180deg,
    rgb(var(--v-theme-primary)),
    rgb(var(--v-theme-info))
  );
  inline-size: 4px;
  inset-block: 0;
  inset-inline-start: 0;
}

.public-api-card__content {
  position: relative;
  z-index: 1;
  padding: 1.75rem;
}

.public-api-card__header,
.public-api-card__heading,
.public-api-card__actions,
.public-api-code-row,
.public-api-panel__eyebrow,
.public-api-security-note {
  display: flex;
  align-items: center;
}

.public-api-card__header {
  justify-content: space-between;
  gap: 1.25rem;
}

.public-api-card__docs-link {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.public-api-card__heading {
  gap: 1rem;
  min-inline-size: 0;
}

.public-api-card__icon {
  display: grid;
  flex: 0 0 auto;
  border: 1px solid rgb(var(--v-theme-primary), 0.2);
  border-radius: 14px;
  background: linear-gradient(
    145deg,
    rgb(var(--v-theme-primary), 0.15),
    rgb(var(--v-theme-primary), 0.04)
  );
  block-size: 3.1rem;
  color: rgb(var(--v-theme-primary));
  inline-size: 3.1rem;
  place-items: center;
}

.public-api-card__title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.public-api-card__subtitle {
  margin: 0;
  color: rgb(var(--v-theme-on-surface), 0.67);
  font-size: 0.93rem;
  line-height: 1.55;
  max-inline-size: 52rem;
}

.public-api-card__skeleton {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.public-api-card__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(17rem, 0.8fr) minmax(22rem, 1.35fr);
}

.public-api-panel {
  padding: 1.25rem;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.1);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface), 0.74);
  min-inline-size: 0;
}

.public-api-panel--endpoint {
  background:
    linear-gradient(
      145deg,
      rgb(var(--v-theme-primary), 0.065),
      transparent 62%
    ),
    rgb(var(--v-theme-surface), 0.74);
}

.public-api-panel__eyebrow {
  color: rgb(var(--v-theme-on-surface), 0.7);
  font-size: 0.73rem;
  font-weight: 700;
  gap: 0.45rem;
  letter-spacing: 0.08em;
  margin-block-end: 0.7rem;
  text-transform: uppercase;
}

.public-api-code-row {
  justify-content: space-between;
  border: 1px solid rgb(var(--v-theme-primary), 0.17);
  border-radius: 10px;
  background: rgb(var(--v-theme-on-surface), 0.035);
  gap: 0.5rem;
  min-inline-size: 0;
  padding-block: 0.55rem;
  padding-inline: 0.8rem 0.55rem;
}

.public-api-code-row__value {
  overflow: hidden;
  color: rgb(var(--v-theme-primary));
  font-size: 0.86rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.public-api-panel__hint {
  color: rgb(var(--v-theme-on-surface), 0.57);
  font-size: 0.79rem;
  line-height: 1.45;
  margin-block: 0.65rem 1rem;
  margin-inline: 0;
}

.public-api-auth-preview {
  display: grid;
  padding: 0.8rem;
  border: 1px dashed rgb(var(--v-theme-on-surface), 0.18);
  border-radius: 10px;
  background: rgb(var(--v-theme-on-surface), 0.025);
  color: rgb(var(--v-theme-on-surface), 0.8);
  font-size: 0.8rem;
  gap: 0.4rem;
}

.public-api-auth-preview code {
  overflow-wrap: anywhere;
}

.public-api-auth-preview__hint {
  padding-block-start: 0.35rem;
  border-block-start: 1px solid rgb(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface), 0.57);
  font-size: 0.72rem;
  line-height: 1.45;
  margin-block-start: 0.2rem;
}

.public-api-auth-preview__label {
  color: rgb(var(--v-theme-on-surface), 0.5);
  font-size: 0.67rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.public-api-live-indicator {
  display: inline-flex;
  align-items: center;
  color: rgb(var(--v-theme-success));
  font-size: 0.75rem;
  font-weight: 600;
  gap: 0.4rem;
  white-space: nowrap;
}

.public-api-live-indicator__dot {
  border-radius: 50%;
  background: currentcolor;
  block-size: 0.48rem;
  box-shadow: 0 0 0 4px rgb(var(--v-theme-success), 0.12);
  inline-size: 0.48rem;
}

.public-api-token-field :deep(input) {
  font-family: 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
}

.public-api-token-meta {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-block-start: 0.9rem;
}

.public-api-token-meta__item {
  display: grid;
  gap: 0.18rem;
  min-inline-size: 0;
}

.public-api-token-meta__item span {
  color: rgb(var(--v-theme-on-surface), 0.53);
  font-size: 0.72rem;
}

.public-api-token-meta__item strong {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface), 0.82);
  font-size: 0.79rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.public-api-empty-token {
  display: flex;
  align-items: center;
  padding: 1rem;
  border: 1px dashed rgb(var(--v-theme-primary), 0.24);
  border-radius: 12px;
  background: rgb(var(--v-theme-primary), 0.035);
  gap: 0.85rem;
  min-block-size: 5rem;
}

.public-api-empty-token__icon {
  display: grid;
  flex: 0 0 auto;
  border-radius: 12px;
  background: rgb(var(--v-theme-primary), 0.1);
  block-size: 2.8rem;
  color: rgb(var(--v-theme-primary));
  inline-size: 2.8rem;
  place-items: center;
}

.public-api-card__actions {
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-block-start: 1rem;
}

.public-api-security-note {
  color: rgb(var(--v-theme-on-surface), 0.57);
  font-size: 0.79rem;
  gap: 0.55rem;
}

.public-api-security-note :deep(.v-icon) {
  color: rgb(var(--v-theme-primary));
}

@media (max-width: 959px) {
  .public-api-card__grid,
  .public-api-card__skeleton {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 599px) {
  .public-api-card__content {
    padding: 1.2rem;
  }

  .public-api-card__header,
  .public-api-card__heading {
    align-items: flex-start;
  }

  .public-api-card__header {
    flex-direction: column;
  }

  .public-api-card__header :deep(.v-btn) {
    inline-size: 100%;
  }

  .public-api-card__icon {
    border-radius: 12px;
    block-size: 2.75rem;
    inline-size: 2.75rem;
  }

  .public-api-card__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .public-api-panel {
    padding: 1rem;
  }

  .public-api-token-meta {
    grid-template-columns: 1fr;
  }

  .public-api-card__actions :deep(.v-btn) {
    flex: 1 1 100%;
  }
}
/* stylelint-enable selector-pseudo-class-no-unknown */
</style>
