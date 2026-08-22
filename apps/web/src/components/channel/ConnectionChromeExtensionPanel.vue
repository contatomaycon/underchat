<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { WorkerSecureConnectionSessionResponse } from '@core/schema/worker/secureConnection/response.schema';

const props = defineProps<{
  disabled?: boolean;
  downloading?: boolean;
  downloadUrl?: string;
  extensionUrl?: string;
  loading?: boolean;
  session: WorkerSecureConnectionSessionResponse | null;
}>();

const emit = defineEmits<{
  back: [];
  cancel: [];
  download: [];
  start: [];
}>();

const copiedToken = shallowRef(false);
const copiedUrl = shallowRef(false);

const extensionUrl = computed(() => props.extensionUrl?.trim() ?? '');
const downloadUrl = computed(() => props.downloadUrl?.trim() ?? '');
const tokenValue = computed(() => props.session?.token ?? '');
const isTerminal = computed(() =>
  Boolean(
    props.session &&
    ['connected_confirmed', 'failed', 'expired', 'cancelled'].includes(
      props.session.status
    )
  )
);
const canRetry = computed(
  () =>
    !props.loading &&
    (!props.session ||
      ['failed', 'expired', 'cancelled'].includes(props.session.status))
);
const statusTone = computed(() => {
  if (!props.session) return 'waiting';
  if (props.session.status === 'connected_confirmed') return 'success';
  if (['failed', 'expired', 'cancelled'].includes(props.session.status)) {
    return 'error';
  }
  if (
    [
      'helper_opened',
      'wa_authenticated',
      'wa_syncing',
      'wa_ready',
      'uploading',
      'session_received',
      'importing',
      'validating_worker',
      'connected',
    ].includes(props.session.status)
  ) {
    return 'busy';
  }
  return 'ready';
});

const statusTitleKey = computed(() => {
  if (!props.session) return 'chrome_extension_panel_starting_title';

  const map: Record<string, string> = {
    created: 'chrome_extension_panel_created_title',
    helper_opened: 'chrome_extension_panel_waiting_title',
    wa_authenticated: 'secure_connection_whatsapp_ready_title',
    wa_syncing: 'secure_connection_whatsapp_syncing_title',
    wa_ready: 'secure_connection_whatsapp_stable_title',
    uploading: 'secure_connection_uploading_title',
    session_received: 'secure_connection_received_title',
    importing: 'secure_connection_importing_title',
    validating_worker: 'secure_connection_validating_title',
    connected: 'secure_connection_validating_title',
    connected_confirmed: 'secure_connection_connected_title',
    failed: 'chrome_extension_panel_failed_title',
    expired: 'secure_connection_expired_title',
    cancelled: 'secure_connection_cancelled_title',
  };

  return map[props.session.status] ?? 'chrome_extension_panel_starting_title';
});

const statusDescriptionKey = computed(() => {
  if (!props.session) return 'chrome_extension_panel_starting_description';

  const map: Record<string, string> = {
    created: 'chrome_extension_panel_created_description',
    helper_opened: 'chrome_extension_panel_waiting_description',
    wa_authenticated: 'chrome_extension_panel_authenticated_description',
    wa_syncing: 'secure_connection_whatsapp_syncing_description',
    wa_ready: 'chrome_extension_panel_ready_description',
    uploading: 'chrome_extension_panel_uploading_description',
    session_received: 'secure_connection_received_description',
    importing: 'secure_connection_importing_description',
    validating_worker: 'secure_connection_validating_description',
    connected: 'secure_connection_validating_description',
    connected_confirmed: 'chrome_extension_panel_connected_description',
    failed: 'chrome_extension_panel_failed_description',
    expired: 'secure_connection_expired_description',
    cancelled: 'secure_connection_cancelled_description',
  };

  return (
    map[props.session.status] ?? 'chrome_extension_panel_starting_description'
  );
});

async function copyText(value: string, target: 'token' | 'url') {
  if (!value) return;

  await globalThis.navigator.clipboard.writeText(value);
  const copied = target === 'token' ? copiedToken : copiedUrl;
  copied.value = true;
  globalThis.setTimeout(() => {
    copied.value = false;
  }, 1800);
}
</script>

<template>
  <div class="chrome-extension-panel">
    <div class="chrome-extension-hero">
      <div class="chrome-extension-mark" :data-tone="statusTone">
        <VIcon icon="tabler-brand-chrome" size="44" />
      </div>

      <div class="chrome-extension-copy">
        <p class="text-overline text-primary mb-1">
          {{ $t('chrome_extension_panel_label') }}
        </p>
        <h3 class="text-h5 mb-2">
          {{ $t(statusTitleKey) }}
        </h3>
        <p class="text-body-2 text-medium-emphasis mb-0">
          {{ $t(statusDescriptionKey) }}
        </p>
      </div>
    </div>

    <VAlert
      v-if="session?.error"
      type="error"
      variant="tonal"
      density="compact"
    >
      {{ session.error }}
    </VAlert>

    <div class="chrome-extension-progress" :data-tone="statusTone">
      <span class="chrome-extension-progress-step" data-step="1">
        {{ $t('chrome_extension_step_token') }}
      </span>
      <span class="chrome-extension-progress-line" />
      <span class="chrome-extension-progress-step" data-step="2">
        {{ $t('chrome_extension_step_install') }}
      </span>
      <span class="chrome-extension-progress-line" />
      <span class="chrome-extension-progress-step" data-step="3">
        {{ $t('chrome_extension_step_connect') }}
      </span>
    </div>

    <VProgressLinear
      v-if="loading || statusTone === 'busy'"
      indeterminate
      color="primary"
    />

    <section class="chrome-extension-token-card">
      <div class="chrome-extension-token-header">
        <span>{{ $t('chrome_extension_token_label') }}</span>
        <small v-if="session?.token_hash">#{{ session.token_hash }}</small>
      </div>

      <div class="chrome-extension-token-value">
        <code>{{ tokenValue || $t('chrome_extension_token_loading') }}</code>
        <VBtn
          icon
          variant="tonal"
          color="primary"
          size="small"
          :disabled="!tokenValue || loading"
          :aria-label="$t('chrome_extension_copy_token')"
          @click="copyText(tokenValue, 'token')"
        >
          <VIcon :icon="copiedToken ? 'tabler-check' : 'tabler-copy'" />
        </VBtn>
      </div>
    </section>

    <section class="chrome-extension-store-card">
      <div class="chrome-extension-store-icon">
        <VIcon icon="tabler-puzzle" size="24" />
      </div>
      <div class="chrome-extension-store-copy">
        <strong>{{ $t('chrome_extension_store_title') }}</strong>
        <span>{{ $t('chrome_extension_store_description') }}</span>
        <code v-if="extensionUrl">{{ extensionUrl }}</code>
        <small v-else>{{ $t('chrome_extension_store_missing_url') }}</small>
      </div>
      <div class="chrome-extension-store-actions">
        <VBtn
          color="primary"
          variant="flat"
          :loading="downloading"
          :disabled="disabled || downloading || !downloadUrl"
          @click="emit('download')"
        >
          <VIcon icon="tabler-download" start />
          {{ $t('chrome_extension_download_action') }}
        </VBtn>

        <VBtn
          v-if="extensionUrl"
          color="secondary"
          variant="tonal"
          :href="extensionUrl"
          target="_blank"
          rel="noopener"
        >
          <VIcon icon="tabler-external-link" start />
          {{ $t('chrome_extension_open_store') }}
        </VBtn>
        <VBtn
          v-if="extensionUrl"
          icon
          variant="tonal"
          color="secondary"
          size="small"
          :aria-label="$t('chrome_extension_copy_store_url')"
          @click="copyText(extensionUrl, 'url')"
        >
          <VIcon :icon="copiedUrl ? 'tabler-check' : 'tabler-copy'" />
        </VBtn>
      </div>
    </section>

    <div class="chrome-extension-actions">
      <div class="chrome-extension-secondary-actions">
        <VBtn variant="tonal" color="secondary" @click="emit('back')">
          <VIcon icon="tabler-arrow-left" start />
          {{ $t('back') }}
        </VBtn>

        <VBtn
          v-if="session && !isTerminal"
          variant="tonal"
          color="error"
          :disabled="disabled || loading"
          @click="emit('cancel')"
        >
          <VIcon icon="tabler-x" start />
          {{ $t('cancel') }}
        </VBtn>
      </div>

      <VBtn
        color="primary"
        :loading="loading"
        :disabled="disabled || !canRetry"
        @click="emit('start')"
      >
        <VIcon icon="tabler-refresh" start />
        {{
          session
            ? $t('chrome_extension_generate_new_token')
            : $t('chrome_extension_generate_token')
        }}
      </VBtn>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chrome-extension-panel {
  display: grid;
  gap: 20px;
  padding: 30px;
}

.chrome-extension-hero {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 18px;
}

.chrome-extension-mark {
  display: grid;
  inline-size: 92px;
  block-size: 92px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-warning), 0.28);
  border-radius: 8px;
  background:
    linear-gradient(
      145deg,
      rgba(var(--v-theme-warning), 0.16),
      rgba(var(--v-theme-primary), 0.06)
    ),
    rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-warning));
}

.chrome-extension-mark[data-tone='success'] {
  border-color: rgba(var(--v-theme-success), 0.28);
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}

.chrome-extension-mark[data-tone='error'] {
  border-color: rgba(var(--v-theme-error), 0.28);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.chrome-extension-copy {
  min-inline-size: 0;
}

.chrome-extension-progress {
  display: grid;
  grid-template-columns: max-content 1fr max-content 1fr max-content;
  align-items: center;
  gap: 10px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 12px;
}

.chrome-extension-progress-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.chrome-extension-progress-step::before {
  display: grid;
  inline-size: 24px;
  block-size: 24px;
  place-items: center;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
  content: attr(data-step);
  font-size: 12px;
  font-weight: 700;
}

.chrome-extension-progress-line {
  block-size: 1px;
  background: rgba(var(--v-border-color), 0.24);
}

.chrome-extension-progress[data-tone='success']
  .chrome-extension-progress-step::before {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}

.chrome-extension-token-card,
.chrome-extension-store-card {
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.96);
}

.chrome-extension-token-card {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.chrome-extension-token-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 12px;
}

.chrome-extension-token-value {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px;
}

.chrome-extension-token-value code,
.chrome-extension-store-copy code {
  overflow: hidden;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: rgb(var(--v-theme-on-surface));
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    monospace;
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
}

.chrome-extension-store-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 16px;
}

.chrome-extension-store-icon {
  display: grid;
  inline-size: 46px;
  block-size: 46px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.chrome-extension-store-copy {
  display: grid;
  min-inline-size: 0;
  gap: 5px;
}

.chrome-extension-store-copy strong {
  font-size: 14px;
  line-height: 1.3;
}

.chrome-extension-store-copy span,
.chrome-extension-store-copy small {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 12px;
  line-height: 1.45;
}

.chrome-extension-store-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.chrome-extension-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.chrome-extension-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 680px) {
  .chrome-extension-panel {
    padding: 22px;
  }

  .chrome-extension-hero,
  .chrome-extension-store-card {
    grid-template-columns: 1fr;
  }

  .chrome-extension-progress {
    grid-template-columns: 1fr;
  }

  .chrome-extension-progress-line {
    display: none;
  }

  .chrome-extension-actions,
  .chrome-extension-secondary-actions,
  .chrome-extension-store-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .chrome-extension-actions :deep(.v-btn),
  .chrome-extension-secondary-actions :deep(.v-btn),
  .chrome-extension-store-actions :deep(.v-btn) {
    inline-size: 100%;
  }
}
</style>
