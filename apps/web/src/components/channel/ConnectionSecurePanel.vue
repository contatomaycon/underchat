<script setup lang="ts">
import { computed } from 'vue';
import { WorkerSecureConnectionSessionResponse } from '@core/schema/worker/secureConnection/response.schema';

const props = defineProps<{
  session: WorkerSecureConnectionSessionResponse | null;
  loading?: boolean;
  opening?: boolean;
}>();

const emit = defineEmits<{
  start: [];
  open: [];
  back: [];
  cancel: [];
}>();

const statusTone = computed(() => {
  if (!props.session) return 'waiting';
  if (props.session.status === 'connected') return 'success';
  if (
    props.session.status === 'failed' ||
    props.session.status === 'expired' ||
    props.session.status === 'cancelled'
  ) {
    return 'error';
  }
  if (
    props.session.status === 'importing' ||
    props.session.status === 'session_received' ||
    props.session.status === 'uploading'
  ) {
    return 'busy';
  }
  return 'ready';
});

const statusTitleKey = computed(() => {
  if (!props.session) return 'secure_connection_waiting_title';

  const map: Record<string, string> = {
    created: 'secure_connection_created_title',
    helper_opened: 'secure_connection_helper_opened_title',
    wa_authenticated: 'secure_connection_whatsapp_ready_title',
    uploading: 'secure_connection_uploading_title',
    session_received: 'secure_connection_received_title',
    importing: 'secure_connection_importing_title',
    connected: 'secure_connection_connected_title',
    failed: 'secure_connection_failed_title',
    expired: 'secure_connection_expired_title',
    cancelled: 'secure_connection_cancelled_title',
  };

  return map[props.session.status] ?? 'secure_connection_waiting_title';
});

const statusDescriptionKey = computed(() => {
  if (!props.session) return 'secure_connection_waiting_description';

  const map: Record<string, string> = {
    created: 'secure_connection_created_description',
    helper_opened: 'secure_connection_helper_opened_description',
    wa_authenticated: 'secure_connection_whatsapp_ready_description',
    uploading: 'secure_connection_uploading_description',
    session_received: 'secure_connection_received_description',
    importing: 'secure_connection_importing_description',
    connected: 'secure_connection_connected_description',
    failed: 'secure_connection_failed_description',
    expired: 'secure_connection_expired_description',
    cancelled: 'secure_connection_cancelled_description',
  };

  return map[props.session.status] ?? 'secure_connection_waiting_description';
});

const canOpenHelper = computed(
  () =>
    Boolean(props.session?.deep_link) &&
    props.session?.status !== 'connected' &&
    props.session?.status !== 'cancelled'
);
</script>

<template>
  <div class="secure-panel">
    <div class="secure-panel-hero">
      <div class="secure-panel-icon" :data-tone="statusTone">
        <VIcon icon="tabler-shield-lock" size="54" />
      </div>

      <div class="secure-panel-copy">
        <p class="text-overline text-primary mb-1">
          {{ $t('secure_connection_title') }}
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

    <div v-if="session" class="secure-status" :data-tone="statusTone">
      <span class="secure-status-dot" />
      <span>{{ $t(`secure_connection_status_${session.status}`) }}</span>
      <small v-if="session.token_hash">#{{ session.token_hash }}</small>
    </div>

    <VProgressLinear
      v-if="loading || opening || statusTone === 'busy'"
      indeterminate
      color="primary"
    />

    <div class="secure-actions">
      <VBtn
        v-if="!session"
        color="primary"
        :loading="loading"
        :disabled="loading"
        data-testid="secure-connection-start"
        @click="emit('start')"
      >
        <VIcon icon="tabler-device-desktop" start />
        {{ $t('secure_connection_open_helper') }}
      </VBtn>

      <VBtn
        v-else
        color="primary"
        :loading="opening"
        :disabled="!canOpenHelper || opening"
        data-testid="secure-connection-open-helper"
        @click="emit('open')"
      >
        <VIcon icon="tabler-external-link" start />
        {{ $t('secure_connection_open_helper') }}
      </VBtn>

      <VBtn variant="tonal" color="secondary" @click="emit('back')">
        <VIcon icon="tabler-arrow-left" start />
        {{ $t('back') }}
      </VBtn>

      <VBtn
        v-if="session && session.status !== 'connected'"
        variant="text"
        color="error"
        @click="emit('cancel')"
      >
        {{ $t('cancel') }}
      </VBtn>
    </div>

    <VAlert
      v-if="session?.helper_download_url"
      type="info"
      variant="tonal"
      density="compact"
    >
      <a :href="session.helper_download_url" target="_blank" rel="noopener">
        {{ $t('secure_connection_install_helper') }}
      </a>
    </VAlert>
  </div>
</template>

<style scoped lang="scss">
.secure-panel {
  display: grid;
  gap: 18px;
  padding: 28px;
}

.secure-panel-hero {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 18px;
}

.secure-panel-icon {
  display: grid;
  inline-size: 116px;
  block-size: 116px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
}

.secure-panel-icon[data-tone='success'] {
  border-color: rgba(var(--v-theme-success), 0.24);
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}

.secure-panel-icon[data-tone='error'] {
  border-color: rgba(var(--v-theme-error), 0.24);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.secure-panel-copy {
  min-inline-size: 0;
}

.secure-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-block-size: 38px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 13px;
}

.secure-status-dot {
  inline-size: 9px;
  block-size: 9px;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 4px rgba(var(--v-theme-primary), 0.12);
}

.secure-status[data-tone='success'] .secure-status-dot {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 4px rgba(var(--v-theme-success), 0.12);
}

.secure-status[data-tone='error'] .secure-status-dot {
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 4px rgba(var(--v-theme-error), 0.12);
}

.secure-status small {
  margin-inline-start: auto;
  color: rgba(var(--v-theme-on-surface), 0.52);
}

.secure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 680px) {
  .secure-panel {
    padding: 22px;
  }

  .secure-panel-hero {
    grid-template-columns: 1fr;
  }
}
</style>
