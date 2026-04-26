<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { isAxiosError } from 'axios';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import {
  normalizeWorkerConnectionModalState,
  type WorkerConnectionModalState,
} from '@core/common/functions/normalizeWorkerConnectionModalState';
import { WorkerExternalConnectionViewResponse } from '@core/schema/worker/externalConnection/response.schema';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { subscribeExternalConnection } from '@/@webcore/centrifugoExternalConnection';

definePage({
  meta: {
    layout: 'blank',
    public: true,
  },
});

const route = useRoute();
const channelStore = useChannelsStore();

const token = computed(() => {
  const value = route.params.token;
  return Array.isArray(value) ? value[0] : String(value ?? '');
});

const externalConnection =
  shallowRef<WorkerExternalConnectionViewResponse | null>(null);
const isLoading = shallowRef(true);
const isInvalid = shallowRef(false);
const isExpired = shallowRef(false);
const isRequestingQr = shallowRef(false);
const statusConnection = shallowRef<EBaileysConnectionStatus>(
  EBaileysConnectionStatus.connecting
);
const statusCode = shallowRef<ECodeMessage>(ECodeMessage.awaitConnection);
const qrcode = shallowRef<string | undefined>();
const qrAttempt = shallowRef(0);
const qrMaxAttempts = shallowRef(0);
const phoneNumber = shallowRef<string | null>(null);
const disconnectedByUser = shallowRef(false);
const expiryTimeout = shallowRef<number | null>(null);

let unsubscribeExternalConnection: (() => void) | null = null;

const connectionState = computed<Partial<IBaileysConnectionState>>(() => ({
  status: statusConnection.value,
  code: statusCode.value,
  worker_id: externalConnection.value?.worker_id ?? '',
  account_id: externalConnection.value?.account_id ?? '',
  qrcode: qrcode.value,
  attempt: qrAttempt.value || undefined,
  max_attempts: qrMaxAttempts.value || undefined,
  phone: phoneNumber.value ?? undefined,
  disconnected_user: disconnectedByUser.value,
}));

const modalState = computed<WorkerConnectionModalState>(() =>
  normalizeWorkerConnectionModalState(connectionState.value)
);

const isConnected = computed(() => modalState.value === 'connected');
const isQrAttemptsExpired = computed(
  () => qrMaxAttempts.value > 0 && qrAttempt.value > qrMaxAttempts.value
);
const canRetryQrCode = computed(
  () =>
    !isExpired.value &&
    !isInvalid.value &&
    !isConnected.value &&
    !isRequestingQr.value &&
    modalState.value === 'disconnected' &&
    isQrAttemptsExpired.value
);

const expiresAtFormatted = computed(() => {
  if (!externalConnection.value?.expires_at) {
    return '';
  }

  const expiresAt = new Date(externalConnection.value.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(expiresAt);
});

const stageMeta = computed(() => {
  if (isExpired.value) {
    return {
      title: 'external_connection_expired_title',
      description: 'external_connection_expired_description',
      icon: 'tabler-clock-exclamation',
      color: 'warning',
      loading: false,
    };
  }

  if (isInvalid.value) {
    return {
      title: 'external_connection_invalid_title',
      description: 'external_connection_invalid_description',
      icon: 'tabler-link-off',
      color: 'error',
      loading: false,
    };
  }

  const meta: Record<
    WorkerConnectionModalState,
    {
      title: string;
      description: string;
      icon: string;
      color: string;
      loading?: boolean;
    }
  > = {
    starting: {
      title: 'connection_starting_title',
      description: 'connection_starting_description',
      icon: 'tabler-brand-whatsapp',
      color: 'primary',
      loading: true,
    },
    qrPreparing: {
      title: 'connection_qr_preparing_title',
      description: 'connection_qr_preparing_description',
      icon: 'tabler-qrcode',
      color: 'primary',
      loading: true,
    },
    qrReady: {
      title: 'awaiting_qr_code',
      description: 'connection_qr_ready_description',
      icon: 'tabler-qrcode',
      color: 'primary',
    },
    pairingInProgress: {
      title: 'connection_pairing_title',
      description: 'connection_pairing_description',
      icon: 'tabler-link',
      color: 'primary',
      loading: true,
    },
    connected: {
      title: 'connection_success',
      description: 'connection_success_description',
      icon: 'tabler-brand-whatsapp',
      color: 'success',
    },
    loggingOut: {
      title: 'connection_logout_title',
      description: 'connection_logout_description',
      icon: 'tabler-logout',
      color: 'warning',
      loading: true,
    },
    resetting: {
      title: 'connection_resetting_title',
      description: 'connection_resetting_description',
      icon: 'tabler-refresh',
      color: 'info',
      loading: true,
    },
    disconnected: {
      title: isQrAttemptsExpired.value
        ? 'qrcode_attempts_expired_title'
        : 'connection_disconnected_title',
      description: isQrAttemptsExpired.value
        ? 'qrcode_attempts_expired_description'
        : 'connection_disconnected_description',
      icon: 'tabler-plug-connected-x',
      color: 'error',
    },
    phoneUnavailable: {
      title: 'phone_not_available',
      description: 'wait_until_next_attempt',
      icon: 'tabler-device-mobile-off',
      color: 'warning',
    },
    phoneInput: {
      title: 'connection_qr_preparing_title',
      description: 'connection_qr_preparing_description',
      icon: 'tabler-qrcode',
      color: 'primary',
      loading: true,
    },
    pairing: {
      title: 'connection_pairing_title',
      description: 'connection_pairing_description',
      icon: 'tabler-link',
      color: 'primary',
      loading: true,
    },
  };

  return meta[modalState.value];
});

function clearExpiryTimeout() {
  if (expiryTimeout.value !== null) {
    window.clearTimeout(expiryTimeout.value);
    expiryTimeout.value = null;
  }
}

function markExpired() {
  isExpired.value = true;
  qrcode.value = undefined;
  isRequestingQr.value = false;

  if (unsubscribeExternalConnection) {
    unsubscribeExternalConnection();
    unsubscribeExternalConnection = null;
  }
}

function scheduleExpiry(expiresAt: string) {
  clearExpiryTimeout();

  const expiresAtDate = new Date(expiresAt);
  const delay = expiresAtDate.getTime() - Date.now();

  if (!Number.isFinite(delay) || delay <= 0) {
    markExpired();
    return;
  }

  expiryTimeout.value = window.setTimeout(markExpired, delay);
}

function resetQrAttempts() {
  qrAttempt.value = 0;
  qrMaxAttempts.value = 0;
}

function hasExceededQrAttempts(data: Partial<IBaileysConnectionState>) {
  return (
    typeof data.attempt === 'number' &&
    typeof data.max_attempts === 'number' &&
    data.max_attempts > 0 &&
    data.attempt > data.max_attempts
  );
}

function applyQrAttempts(data: Partial<IBaileysConnectionState>) {
  if (typeof data.attempt === 'number') {
    qrAttempt.value = data.attempt;
  }

  if (typeof data.max_attempts === 'number') {
    qrMaxAttempts.value = data.max_attempts;
  }
}

function setInitialStateFromWorker(data: WorkerExternalConnectionViewResponse) {
  phoneNumber.value = data.number ? formatPhoneBR(data.number) : null;
  resetQrAttempts();

  if (data.status?.id === EWorkerStatus.online) {
    statusConnection.value = EBaileysConnectionStatus.connected;
    statusCode.value = ECodeMessage.connectionEstablished;
    qrcode.value = undefined;
    return;
  }

  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
  qrcode.value = undefined;
}

function applyConnectedState(data: IBaileysConnectionState) {
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  qrcode.value = undefined;
  phoneNumber.value = data.phone
    ? formatPhoneBR(data.phone)
    : phoneNumber.value;
  disconnectedByUser.value = false;
  isRequestingQr.value = false;
  resetQrAttempts();
}

function handleWorkerConnectionMessage(data: IBaileysConnectionState) {
  if (
    isExpired.value ||
    !externalConnection.value ||
    data.worker_id !== externalConnection.value.worker_id
  ) {
    return;
  }

  const incomingStatus = data.status as EBaileysConnectionStatus | undefined;
  const incomingCode = data.code as ECodeMessage | undefined;
  const isConnectedEvent =
    incomingStatus === EBaileysConnectionStatus.connected ||
    incomingCode === ECodeMessage.connectionEstablished;

  if (isConnectedEvent) {
    applyConnectedState(data);
    return;
  }

  applyQrAttempts(data);

  if (data.disconnected_user !== undefined) {
    disconnectedByUser.value = data.disconnected_user;
  }

  if (hasExceededQrAttempts(data)) {
    qrcode.value = undefined;
    isRequestingQr.value = false;
  } else if (data.qrcode) {
    qrcode.value = data.qrcode;
    isRequestingQr.value = false;
  } else if (
    incomingCode === ECodeMessage.awaitConnection ||
    incomingCode === ECodeMessage.logoutInProgress ||
    incomingCode === ECodeMessage.pairingInProgress ||
    incomingCode === ECodeMessage.newLoginAttempt ||
    incomingStatus === EBaileysConnectionStatus.disconnected
  ) {
    qrcode.value = undefined;
  }

  if (incomingStatus === EBaileysConnectionStatus.disconnected) {
    isRequestingQr.value = false;
  }

  if (incomingStatus) {
    statusConnection.value = incomingStatus;
  }

  if (incomingCode && incomingCode !== ECodeMessage.info) {
    statusCode.value = incomingCode;
  }

  if (data.phone) {
    phoneNumber.value = formatPhoneBR(data.phone);
  }
}

async function requestQrCode() {
  if (isExpired.value || isConnected.value || !token.value) {
    return;
  }

  isRequestingQr.value = true;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
  qrcode.value = undefined;
  resetQrAttempts();

  const requested = await channelStore.requestExternalConnectionQrCode(
    token.value
  );

  if (!requested) {
    isRequestingQr.value = false;
    await loadExternalConnection(false);
  }
}

async function subscribeToExternalConnection(
  data: WorkerExternalConnectionViewResponse
) {
  if (unsubscribeExternalConnection) {
    unsubscribeExternalConnection();
    unsubscribeExternalConnection = null;
  }

  try {
    unsubscribeExternalConnection = await subscribeExternalConnection(
      {
        url: data.centrifugo_url,
        connectionToken: data.centrifugo_connection_token,
        subscriptionToken: data.centrifugo_subscription_token,
        channel: data.centrifugo_channel,
      },
      handleWorkerConnectionMessage
    );
  } catch (error) {
    console.error('Failed to subscribe to external connection events', error);
  }
}

async function loadExternalConnection(requestQr = true) {
  let viewData: WorkerExternalConnectionViewResponse | null = null;

  try {
    isInvalid.value = false;
    isExpired.value = false;
    const response = await axios.get<
      IApiResponse<WorkerExternalConnectionViewResponse>
    >(`/worker/external-connection/${encodeURIComponent(token.value)}`);
    const data = response?.data;

    if (!data?.status || !data?.data) {
      isInvalid.value = true;
      return;
    }

    externalConnection.value = data.data;
    viewData = data.data;
    scheduleExpiry(data.data.expires_at);
    setInitialStateFromWorker(data.data);
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 410) {
      isExpired.value = true;
      return;
    }

    isInvalid.value = true;
  } finally {
    isLoading.value = false;
  }

  if (!viewData || isInvalid.value || isExpired.value) {
    return;
  }

  await subscribeToExternalConnection(viewData);

  if (requestQr && !isConnected.value && !isExpired.value) {
    await requestQrCode();
  }
}

onMounted(async () => {
  if (!token.value) {
    isInvalid.value = true;
    isLoading.value = false;
    return;
  }

  await loadExternalConnection();
});

onUnmounted(() => {
  clearExpiryTimeout();

  if (unsubscribeExternalConnection) {
    unsubscribeExternalConnection();
    unsubscribeExternalConnection = null;
  }
});
</script>

<template>
  <main class="external-connection-page bg-surface">
    <VCard class="external-connection-card" elevation="8">
      <VRow no-gutters>
        <VCol cols="12" lg="7" order="2" order-lg="1">
          <VCardItem>
            <VCardTitle>{{ $t('external_connection_page_title') }}</VCardTitle>
          </VCardItem>

          <VCardText class="public-connection-stage">
            <div class="connection-visual">
              <VImg
                v-if="modalState === 'qrReady' && qrcode && !isExpired"
                :src="qrcode"
                max-width="240"
                width="240"
              />
              <VProgressCircular
                v-else-if="isLoading || stageMeta.loading || isRequestingQr"
                indeterminate
                :color="stageMeta.color"
                size="112"
                width="4"
              >
                <VIcon
                  :icon="stageMeta.icon"
                  :color="stageMeta.color"
                  size="52"
                />
              </VProgressCircular>
              <VIcon
                v-else
                :icon="stageMeta.icon"
                :color="stageMeta.color"
                size="124"
              />
            </div>

            <div class="connection-copy text-center">
              <h4 class="text-h6 mb-2">{{ $t(stageMeta.title) }}</h4>
              <p class="text-body-2 mb-0">
                {{ $t(stageMeta.description) }}
              </p>
              <small v-if="isConnected && phoneNumber" class="d-block mt-1">
                {{ phoneNumber }}
              </small>
              <small
                v-if="!isExpired && expiresAtFormatted"
                class="d-block mt-3 text-medium-emphasis"
              >
                {{ $t('external_connection_link_validity') }} -
                {{ expiresAtFormatted }}
              </small>
            </div>

            <VProgressLinear
              v-if="modalState === 'qrReady' && !isExpired"
              indeterminate
              color="primary"
              class="connection-progress"
            />

            <VBtn
              v-if="canRetryQrCode"
              color="primary"
              :loading="isRequestingQr"
              :disabled="isRequestingQr"
              @click="requestQrCode"
            >
              <VIcon icon="tabler-refresh" start />
              {{ $t('retry_qrcode') }}
            </VBtn>
          </VCardText>
        </VCol>

        <VCol cols="12" lg="5" order="1" order-lg="2" class="connection-side">
          <VCardText class="d-flex">
            <VTimeline
              side="end"
              align="start"
              line-inset="8"
              truncate-line="start"
              density="compact"
              class="v-timeline--variant-outlined"
            >
              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="primary" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">
                    {{ $t('open_whatsapp') }}
                  </span>
                  <span class="app-timeline-meta">
                    {{ $t('certify_latest_version') }}
                  </span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="warning" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">
                    {{ $t('tap_settings') }}
                  </span>
                  <span class="app-timeline-meta">
                    {{ $t('you_top_right_corner') }}
                  </span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="info" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">
                    {{ $t('select_connected_devices') }}
                  </span>
                  <span class="app-timeline-meta">
                    {{ $t('access_connect_device') }}
                  </span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="success" size="16" />
                </template>
                <div class="connection-step">
                  <span class="app-timeline-title">
                    {{ $t('point_camera_screen') }}
                  </span>
                  <span class="app-timeline-meta">
                    {{ $t('scan_qr_code') }}
                  </span>
                </div>
              </VTimelineItem>
            </VTimeline>
          </VCardText>
        </VCol>
      </VRow>
    </VCard>
  </main>
</template>

<style lang="scss" scoped>
.external-connection-page {
  display: grid;
  min-block-size: 100vh;
  padding: 24px;
  place-items: center;
}

.external-connection-card {
  inline-size: min(100%, 920px);
  overflow: hidden;
  border-radius: 8px;
}

.public-connection-stage {
  display: flex;
  min-block-size: 420px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.connection-visual {
  display: grid;
  min-inline-size: 172px;
  min-block-size: 172px;
  place-items: center;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background-color: rgb(var(--v-theme-surface));
  box-shadow: inset 0 0 0 12px rgba(var(--v-theme-primary), 0.05);
}

.connection-copy {
  max-inline-size: 320px;
  margin-inline: auto;
}

.connection-progress {
  max-inline-size: 240px;
}

.connection-side {
  position: relative;
  background-color: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.connection-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.v-btn {
  transform: none;
}
</style>
