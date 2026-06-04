<script lang="ts" setup>
import {
  computed,
  onMounted,
  onUnmounted,
  shallowRef,
  toRef,
  watch,
} from 'vue';
import {
  fetchHistoryAndProcess,
  fetchRecentHistoryAndProcess,
  onMessage,
  unsubscribe,
} from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useQrPendingRecovery } from '@/composables/useQrPendingRecovery';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import {
  normalizeWorkerConnectionModalState,
  type WorkerConnectionModalState,
} from '@core/common/functions/normalizeWorkerConnectionModalState';
import { reduceWorkerConnectionState } from '@core/common/functions/reduceWorkerConnectionState';

const channelStore = useChannelsStore();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
  channelType: string | null;
  accountId: string | null;
  initialStatusId?: string | null;
  initialPhone?: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', v: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');
const accountId = toRef(props, 'accountId');
const workerConnectionChannel = computed(() =>
  accountId.value ? workerCentrifugoQueue(accountId.value) : ''
);

const MIN_PAIRING_STAGE_MS = 900;

const statusConnection = shallowRef<EBaileysConnectionStatus>(
  EBaileysConnectionStatus.connecting
);
const statusCode = shallowRef<ECodeMessage>(ECodeMessage.awaitConnection);
const qrcode = shallowRef<string | undefined>();
const connectionAttemptId = shallowRef<string | undefined>();
const qrPending = shallowRef(false);
const qrAttempt = shallowRef(0);
const qrMaxAttempts = shallowRef(0);
const phoneNumber = shallowRef<string | null>(null);
const disconnectedByUser = shallowRef(false);
const isResetting = shallowRef(false);
const pairingCodePrimary = shallowRef('');
const pairingCodeSecondary = shallowRef('');
const externalConnectionUrl = shallowRef('');
const externalConnectionExpiresAt = shallowRef<string | null>(null);
const isExternalConnectionLinkLoading = shallowRef(false);
const isExternalConnectionCopied = shallowRef(false);

const secondsNextAttempt = shallowRef(0);
const intervalIdNextAttempt = shallowRef<number | null>(null);
const pairingStartedAt = shallowRef<number | null>(null);
const connectedStateDelayTimeout = shallowRef<number | null>(null);

const connectionState = computed<Partial<IBaileysConnectionState>>(() => ({
  status: statusConnection.value,
  code: statusCode.value,
  worker_id: channelId.value ?? '',
  account_id: accountId.value ?? '',
  qrcode: qrcode.value,
  connection_attempt_id: connectionAttemptId.value,
  qr_pending: qrPending.value,
  attempt: qrAttempt.value || undefined,
  max_attempts: qrMaxAttempts.value || undefined,
  phone: phoneNumber.value ?? undefined,
  disconnected_user: disconnectedByUser.value,
}));

const modalState = computed<WorkerConnectionModalState>(() =>
  normalizeWorkerConnectionModalState(connectionState.value, {
    isResetting: isResetting.value,
  })
);

const isConnected = computed(() => modalState.value === 'connected');
const isQrAttemptsExpired = computed(
  () => qrMaxAttempts.value > 0 && qrAttempt.value > qrMaxAttempts.value
);
const isBlockingOperation = computed(
  () =>
    modalState.value === 'loggingOut' ||
    modalState.value === 'resetting' ||
    modalState.value === 'pairingInProgress'
);
const isConnectionPreparing = computed(
  () => modalState.value === 'starting' || modalState.value === 'qrPreparing'
);
const isActionLocked = computed(
  () =>
    channelStore.loading ||
    isBlockingOperation.value ||
    isConnectionPreparing.value
);
const shouldRecoverPendingQr = () =>
  Boolean(
    isVisible.value &&
    channelId.value &&
    qrPending.value &&
    !qrcode.value &&
    !isConnected.value &&
    !isBlockingOperation.value
  );
const qrPendingRecovery = useQrPendingRecovery({
  shouldContinue: shouldRecoverPendingQr,
  requestState: async () =>
    channelId.value
      ? channelStore.requestConnectionQrCode(channelId.value, { silent: true })
      : null,
  applyState: (state) => applyDirectConnectionResponse(state),
  onError: (error) => {
    if (import.meta.env.DEV) {
      console.warn('QR pending recovery failed', error);
    }
  },
});

const formattedTime = computed(() => {
  const m = Math.floor(secondsNextAttempt.value / 60)
    .toString()
    .padStart(2, '0');
  const s = (secondsNextAttempt.value % 60).toString().padStart(2, '0');

  return `${m}:${s}`;
});

const stageMeta = computed(() => {
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
        : disconnectedByUser.value
          ? 'connection_removed'
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
      title: 'for_phone',
      description: 'request_phone_number',
      icon: 'tabler-device-mobile-message',
      color: 'primary',
    },
    pairing: {
      title: 'for_phone',
      description: 'for_phone_description',
      icon: 'tabler-device-mobile-code',
      color: 'primary',
      loading: !pairingCodePrimary.value || !pairingCodeSecondary.value,
    },
  };

  return meta[modalState.value];
});

const showPrimaryActions = computed(() => modalState.value !== 'pairing');
const showQrRetryOnly = computed(
  () => modalState.value === 'disconnected' && isQrAttemptsExpired.value
);
const showReconnectAction = computed(
  () =>
    !isConnected.value &&
    !showQrRetryOnly.value &&
    !isBlockingOperation.value &&
    modalState.value !== 'pairing'
);

const externalConnectionExpiresAtFormatted = computed(() => {
  if (!externalConnectionExpiresAt.value) {
    return '';
  }

  const expiresAt = new Date(externalConnectionExpiresAt.value);
  if (Number.isNaN(expiresAt.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(expiresAt);
});

async function loadExternalConnectionLink() {
  if (!channelId.value) {
    externalConnectionUrl.value = '';
    externalConnectionExpiresAt.value = null;
    return;
  }

  isExternalConnectionLinkLoading.value = true;
  isExternalConnectionCopied.value = false;

  try {
    const link = await channelStore.createExternalConnectionLink(
      channelId.value
    );

    externalConnectionUrl.value = link?.url ?? '';
    externalConnectionExpiresAt.value = link?.expires_at ?? null;
  } finally {
    isExternalConnectionLinkLoading.value = false;
  }
}

async function copyExternalConnectionLink() {
  if (!externalConnectionUrl.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(externalConnectionUrl.value);
    isExternalConnectionCopied.value = true;
  } catch {
    return;
  }

  window.setTimeout(() => {
    isExternalConnectionCopied.value = false;
  }, 2000);
}

function resetPairingCodes() {
  pairingCodePrimary.value = '';
  pairingCodeSecondary.value = '';
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

function splitCode(code: string): [string, string] {
  return [code.slice(0, 4), code.slice(4)];
}

function clearNextAttemptCountdown() {
  if (intervalIdNextAttempt.value !== null) {
    clearInterval(intervalIdNextAttempt.value);
    intervalIdNextAttempt.value = null;
  }
}

function clearConnectedStateDelay() {
  if (connectedStateDelayTimeout.value !== null) {
    clearTimeout(connectedStateDelayTimeout.value);
    connectedStateDelayTimeout.value = null;
  }
}

function startNextAttemptCountdown() {
  clearNextAttemptCountdown();

  intervalIdNextAttempt.value = (
    globalThis as Window & typeof globalThis
  ).setInterval(() => {
    if (secondsNextAttempt.value > 0) {
      secondsNextAttempt.value--;
      return;
    }

    clearNextAttemptCountdown();
  }, 1000);
}

function prepareConnectionStart(options: { preserveQr?: boolean } = {}) {
  const shouldPreserveQr = options.preserveQr === true && Boolean(qrcode.value);
  const currentQrCode = qrcode.value;
  const currentConnectionAttemptId = connectionAttemptId.value;
  const currentQrPending = qrPending.value;
  const currentQrAttempt = qrAttempt.value;
  const currentQrMaxAttempts = qrMaxAttempts.value;

  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
  qrcode.value = shouldPreserveQr ? currentQrCode : undefined;
  connectionAttemptId.value = shouldPreserveQr
    ? currentConnectionAttemptId
    : undefined;
  qrPending.value = shouldPreserveQr ? currentQrPending : true;
  if (shouldPreserveQr) {
    qrAttempt.value = currentQrAttempt;
    qrMaxAttempts.value = currentQrMaxAttempts;
  } else {
    resetQrAttempts();
  }
  disconnectedByUser.value = false;
  phoneNumber.value = null;
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function prepareInitialModalState() {
  if (props.initialStatusId !== EWorkerStatus.online) {
    prepareConnectionStart();
    return;
  }

  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  qrcode.value = undefined;
  connectionAttemptId.value = undefined;
  qrPending.value = false;
  resetQrAttempts();
  phoneNumber.value = props.initialPhone
    ? formatPhoneBR(props.initialPhone)
    : null;
  disconnectedByUser.value = false;
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

async function reconnectChannel() {
  if (!channelId.value) return;

  prepareConnectionStart({ preserveQr: true });

  const state = await channelStore.requestConnectionQrCode(channelId.value);
  if (state) {
    applyDirectConnectionResponse(state);
  }
  syncQrPendingRecovery();
}

async function restartQrCodeAttempt() {
  await reconnectChannel();
}

async function recreateChannelWithFullCleanup() {
  if (!channelId.value) return;

  qrPendingRecovery.stop();
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.logoutInProgress;
  disconnectedByUser.value = true;
  qrcode.value = undefined;
  qrPending.value = false;
  connectionAttemptId.value = undefined;
  resetQrAttempts();
  resetPairingCodes();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
  pairingStartedAt.value = null;

  const reseted = await channelStore.resetConnectionChannel(channelId.value);

  if (!reseted) {
    statusConnection.value = EBaileysConnectionStatus.disconnected;
    statusCode.value = ECodeMessage.connectionClosed;
    return;
  }

  isResetting.value = true;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
}

function scheduleConnectedState(data: IBaileysConnectionState) {
  const startedAt = pairingStartedAt.value;
  if (!startedAt) {
    applyConnectedState(data);
    return;
  }

  const remaining = MIN_PAIRING_STAGE_MS - (Date.now() - startedAt);
  if (remaining <= 0) {
    applyConnectedState(data);
    return;
  }

  clearConnectedStateDelay();
  connectedStateDelayTimeout.value = (
    globalThis as Window & typeof globalThis
  ).setTimeout(() => {
    applyConnectedState(data);
  }, remaining);
}

function applyConnectedState(data: IBaileysConnectionState) {
  qrPendingRecovery.stop();
  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  phoneNumber.value = data.phone ? formatPhoneBR(data.phone) : null;
  disconnectedByUser.value = false;
  qrcode.value = undefined;
  qrPending.value = false;
  connectionAttemptId.value =
    data.connection_attempt_id ?? connectionAttemptId.value;
  resetQrAttempts();
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function shouldIgnorePhoneUnavailableState(
  data: IBaileysConnectionState
): boolean {
  const incomingStatus = data.status as EBaileysConnectionStatus | undefined;
  const incomingCode = data.code as ECodeMessage | undefined;
  const isIncomingConnected =
    incomingStatus === EBaileysConnectionStatus.connected ||
    incomingCode === ECodeMessage.connectionEstablished;

  return (
    statusCode.value === ECodeMessage.phoneNotAvailable && !isIncomingConnected
  );
}

function applyReducedConnectionState(data: IBaileysConnectionState) {
  if (!channelId.value || data.worker_id !== channelId.value) {
    return;
  }

  if (shouldIgnorePhoneUnavailableState(data)) {
    return;
  }

  const reduced = reduceWorkerConnectionState(connectionState.value, data);
  if (reduced.ignored) {
    return;
  }

  const next = reduced.state;
  applyQrAttempts(next);

  const incomingStatus = data.status as EBaileysConnectionStatus | undefined;
  const incomingCode = data.code as ECodeMessage | undefined;
  const isConnectedEvent =
    incomingStatus === EBaileysConnectionStatus.connected ||
    incomingCode === ECodeMessage.connectionEstablished;

  if (isConnectedEvent) {
    scheduleConnectedState(data);
    return;
  }

  clearConnectedStateDelay();

  if (
    incomingCode === ECodeMessage.pairingInProgress ||
    incomingCode === ECodeMessage.newLoginAttempt
  ) {
    pairingStartedAt.value = Date.now();
  }

  if (next.connection_attempt_id) {
    connectionAttemptId.value = next.connection_attempt_id;
  }

  qrPending.value = next.qr_pending === true;

  if (next.disconnected_user !== undefined) {
    disconnectedByUser.value = next.disconnected_user;
  }

  if (hasExceededQrAttempts(next)) {
    qrcode.value = undefined;
    qrPending.value = false;
  } else if (next.qrcode) {
    qrcode.value = next.qrcode;
  } else {
    qrcode.value = undefined;
  }

  if (incomingStatus) {
    const isInfo = incomingStatus === EBaileysConnectionStatus.info;
    if (
      !isInfo ||
      statusConnection.value !== EBaileysConnectionStatus.connected
    ) {
      statusConnection.value = incomingStatus;
    }
  }

  if (incomingCode && incomingCode !== ECodeMessage.info) {
    statusCode.value = incomingCode;
  }

  if (next.phone) {
    phoneNumber.value = formatPhoneBR(next.phone);
  }

  if (next.pairing_code) {
    const [primary, secondary] = splitCode(next.pairing_code);
    pairingCodePrimary.value = primary;
    pairingCodeSecondary.value = secondary;
  }

  if (next.seconds_until_next_attempt) {
    secondsNextAttempt.value = next.seconds_until_next_attempt;
    startNextAttemptCountdown();
  }

  syncQrPendingRecovery();
}

function applyDirectConnectionResponse(data: IBaileysConnectionState) {
  applyReducedConnectionState(data);
}

function syncQrPendingRecovery() {
  if (shouldRecoverPendingQr()) {
    qrPendingRecovery.start();
    return;
  }

  qrPendingRecovery.stop();
}

async function recoverQrAfterCentrifugoRecoveryFailure() {
  if (!channelId.value || !workerConnectionChannel.value) {
    return;
  }

  await fetchHistoryAndProcess(workerConnectionChannel.value);

  const state = await channelStore.requestConnectionQrCode(channelId.value, {
    silent: true,
  });
  if (state) {
    applyDirectConnectionResponse(state);
  }

  syncQrPendingRecovery();
}

function handleCentrifugoRecoveryFailed(event: Event) {
  const detail = (event as CustomEvent<{ channel?: string }>).detail;
  if (detail?.channel !== workerConnectionChannel.value) {
    return;
  }

  void recoverQrAfterCentrifugoRecoveryFailure();
}

function handleWorkerConnectionMessage(data: IBaileysConnectionState) {
  if (!channelId.value || data.worker_id !== channelId.value) {
    return;
  }

  if (data.worker_status_id === EWorkerStatus.recreating) {
    qrPendingRecovery.stop();
    isResetting.value = true;
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitConnection;
    qrcode.value = undefined;
    qrPending.value = false;
    connectionAttemptId.value = data.connection_attempt_id;
    pairingStartedAt.value = null;
    resetPairingCodes();
    clearConnectedStateDelay();
    return;
  }

  if (data.worker_status_id) {
    isResetting.value = false;
  }

  applyReducedConnectionState(data);
}

onMounted(async () => {
  if (!channelId.value || !accountId.value) {
    return;
  }

  prepareInitialModalState();
  await loadExternalConnectionLink();

  globalThis.addEventListener(
    'centrifugo-recovery-failed',
    handleCentrifugoRecoveryFailed as EventListener
  );

  await onMessage(workerConnectionChannel.value, handleWorkerConnectionMessage);
  await fetchRecentHistoryAndProcess(
    workerConnectionChannel.value,
    handleWorkerConnectionMessage
  );

  const state = await channelStore.requestConnectionQrCode(channelId.value);
  if (state) {
    applyDirectConnectionResponse(state);
  }
  syncQrPendingRecovery();
});

watch(isVisible, (visible) => {
  if (!visible) {
    qrPendingRecovery.stop();
    return;
  }

  void loadExternalConnectionLink();
  if (!isConnected.value) {
    void reconnectChannel();
  }
});

onUnmounted(() => {
  qrPendingRecovery.stop();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();

  globalThis.removeEventListener(
    'centrifugo-recovery-failed',
    handleCentrifugoRecoveryFailed as EventListener
  );

  if (accountId.value) {
    void unsubscribe(
      workerConnectionChannel.value,
      handleWorkerConnectionMessage
    );
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="640">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard data-testid="connection-dialog">
      <VRow no-gutters>
        <VCol cols="12" sm="8" md="12" lg="7" order="2" order-lg="1">
          <VCardItem>
            <VCardTitle>{{ $t('conection') }}</VCardTitle>
          </VCardItem>

          <VCardText class="connection-stage">
            <div class="connection-visual">
              <VImg
                v-if="modalState === 'qrReady' && qrcode"
                :src="qrcode"
                max-width="240"
                width="240"
                data-testid="connection-qr-image"
              />
              <VProgressCircular
                v-else-if="stageMeta.loading"
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
              <h4 class="text-h6 mb-2" data-testid="connection-stage-title">
                {{ $t(stageMeta.title) }}
              </h4>
              <p class="text-body-2 mb-0">
                {{ $t(stageMeta.description) }}
              </p>
              <small v-if="isConnected && phoneNumber" class="d-block mt-1">
                {{ phoneNumber }}
              </small>
              <template v-if="modalState === 'phoneUnavailable'">
                <strong class="d-block text-h5 mt-3">{{
                  formattedTime
                }}</strong>
                <small>{{ $t('seconds_until_next_attempt') }}</small>
              </template>
            </div>

            <div v-if="modalState === 'pairing'" class="pairing-code">
              <template v-if="pairingCodePrimary && pairingCodeSecondary">
                <VOtpInput
                  v-model="pairingCodePrimary"
                  disabled
                  length="4"
                  type="text"
                  class="pa-0"
                  :focused="false"
                />
                <VOtpInput
                  v-model="pairingCodeSecondary"
                  disabled
                  length="4"
                  type="text"
                  class="pa-0"
                  :focused="false"
                />
              </template>
              <VProgressLinear v-else indeterminate color="primary" />
            </div>

            <VProgressLinear
              v-if="modalState === 'qrReady'"
              indeterminate
              color="primary"
              class="connection-progress"
            />
          </VCardText>

          <VCardText v-if="showPrimaryActions" class="d-flex justify-center">
            <div class="d-flex gap-2">
              <VBtn
                v-if="showQrRetryOnly"
                color="primary"
                :disabled="isActionLocked"
                :loading="channelStore.loading"
                @click="restartQrCodeAttempt"
              >
                <VIcon icon="tabler-refresh" start />
                {{ $t('retry_qrcode') }}
              </VBtn>

              <VBtn
                v-else
                :disabled="isActionLocked"
                :loading="channelStore.loading && modalState === 'loggingOut'"
                :color="isConnected ? 'error' : 'primary'"
                @click="recreateChannelWithFullCleanup"
              >
                <VTooltip
                  location="top"
                  activator="parent"
                  transition="scroll-x-transition"
                >
                  <span>{{
                    isConnected ? $t('disconnect') : $t('recreate')
                  }}</span>
                </VTooltip>
                <VIcon
                  :icon="isConnected ? 'tabler-circle-off' : 'tabler-reload'"
                />
              </VBtn>

              <VBtn
                v-if="showReconnectAction"
                :disabled="isActionLocked"
                :loading="channelStore.loading && modalState === 'starting'"
                color="warning"
                data-testid="connection-reconnect"
                @click="reconnectChannel"
              >
                <VTooltip
                  location="top"
                  activator="parent"
                  transition="scroll-x-transition"
                >
                  <span>{{ $t('reconnect') }}</span>
                </VTooltip>
                <VIcon icon="tabler-refresh" />
              </VBtn>
            </div>
          </VCardText>

          <VCardText class="pt-0">
            <div class="external-connection-box">
              <div class="external-connection-header">
                <VIcon icon="tabler-link" color="primary" size="22" />
                <div>
                  <p class="text-body-2 font-weight-medium mb-0">
                    {{ $t('external_connection_link') }}
                  </p>
                  <small class="text-medium-emphasis">
                    {{ $t('external_connection_link_validity') }}
                    <template v-if="externalConnectionExpiresAtFormatted">
                      - {{ externalConnectionExpiresAtFormatted }}
                    </template>
                  </small>
                </div>
              </div>

              <AppTextField
                v-model="externalConnectionUrl"
                readonly
                density="compact"
                hide-details
                data-testid="external-connection-url"
                :loading="isExternalConnectionLinkLoading"
                :placeholder="$t('external_connection_link_loading')"
              >
                <template #append-inner>
                  <VBtn
                    icon
                    variant="text"
                    size="small"
                    :disabled="
                      !externalConnectionUrl || isExternalConnectionLinkLoading
                    "
                    @click.stop="copyExternalConnectionLink"
                  >
                    <VIcon
                      :icon="
                        isExternalConnectionCopied
                          ? 'tabler-check'
                          : 'tabler-copy'
                      "
                    />
                    <VTooltip
                      activator="parent"
                      location="top"
                      transition="scroll-x-transition"
                    >
                      <span>
                        {{
                          isExternalConnectionCopied
                            ? $t('external_connection_link_copied')
                            : $t('copy_external_connection_link')
                        }}
                      </span>
                    </VTooltip>
                  </VBtn>
                </template>
              </AppTextField>
            </div>
          </VCardText>
        </VCol>

        <VCol
          cols="12"
          sm="4"
          md="12"
          lg="5"
          order="1"
          order-lg="2"
          class="member-pricing-bg"
        >
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
                  <span class="app-timeline-title">{{
                    $t('tap_settings')
                  }}</span>
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
                  <span class="app-timeline-meta">{{
                    $t('scan_qr_code')
                  }}</span>
                </div>
              </VTimelineItem>
            </VTimeline>
          </VCardText>
        </VCol>
      </VRow>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.connection-stage {
  display: flex;
  min-block-size: 320px;
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
  max-inline-size: 300px;
  margin-inline: auto;
}

.connection-progress {
  max-inline-size: 240px;
}

.pairing-code {
  display: grid;
  inline-size: min(100%, 260px);
  gap: 8px;
}

.external-connection-box {
  display: grid;
  gap: 10px;
}

.external-connection-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.connection-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.member-pricing-bg {
  position: relative;
  background-color: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.v-btn {
  transform: none;
}
</style>
