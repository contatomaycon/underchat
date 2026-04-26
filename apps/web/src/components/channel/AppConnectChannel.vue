<script lang="ts" setup>
import { computed, onMounted, onUnmounted, shallowRef, toRef } from 'vue';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import {
  normalizeWorkerConnectionModalState,
  type WorkerConnectionModalState,
} from '@core/common/functions/normalizeWorkerConnectionModalState';

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
const channelType = toRef(props, 'channelType');
const accountId = toRef(props, 'accountId');

const MIN_PAIRING_STAGE_MS = 900;

const statusConnection = shallowRef<EBaileysConnectionStatus>(
  EBaileysConnectionStatus.connecting
);
const statusCode = shallowRef<ECodeMessage>(ECodeMessage.awaitConnection);
const qrcode = shallowRef<string | undefined>();
const phoneNumber = shallowRef<string | null>(null);
const disconnectedByUser = shallowRef(false);
const isResetting = shallowRef(false);

const isPhoneNumber = shallowRef(false);
const phoneSent = shallowRef(false);
const phoneConnection = shallowRef<string | undefined>();
const connectionType = shallowRef<EBaileysConnectionType>(
  EBaileysConnectionType.qrcode
);
const pairingCodePrimary = shallowRef('');
const pairingCodeSecondary = shallowRef('');

const secondsNextAttempt = shallowRef(0);
const intervalIdNextAttempt = shallowRef<number | null>(null);
const pairingStartedAt = shallowRef<number | null>(null);
const connectedStateDelayTimeout = shallowRef<number | null>(null);

const isBrowserWorkerType = computed(
  () => channelType.value === EWorkerType.wwebjs
);

const connectionState = computed<Partial<IBaileysConnectionState>>(() => ({
  status: statusConnection.value,
  code: statusCode.value,
  worker_id: channelId.value ?? '',
  account_id: accountId.value ?? '',
  qrcode: qrcode.value,
  phone: phoneNumber.value ?? undefined,
  disconnected_user: disconnectedByUser.value,
}));

const modalState = computed<WorkerConnectionModalState>(() =>
  normalizeWorkerConnectionModalState(connectionState.value, {
    isResetting: isResetting.value,
    isPhoneNumber: isPhoneNumber.value,
    phoneSent: phoneSent.value,
  })
);

const isConnected = computed(() => modalState.value === 'connected');
const isBlockingOperation = computed(
  () =>
    modalState.value === 'loggingOut' ||
    modalState.value === 'resetting' ||
    modalState.value === 'pairingInProgress'
);
const isActionLocked = computed(
  () => channelStore.loading || isBlockingOperation.value
);

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
      title: disconnectedByUser.value
        ? 'connection_removed'
        : 'connection_disconnected_title',
      description: 'connection_disconnected_description',
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

const showPrimaryActions = computed(
  () => modalState.value !== 'phoneInput' && modalState.value !== 'pairing'
);
const showReconnectAction = computed(
  () =>
    !isConnected.value &&
    !isBlockingOperation.value &&
    modalState.value !== 'phoneInput' &&
    modalState.value !== 'pairing'
);
const showEnterPhoneLink = computed(
  () =>
    !isBrowserWorkerType.value &&
    !isPhoneNumber.value &&
    !isConnected.value &&
    !isBlockingOperation.value &&
    modalState.value !== 'phoneUnavailable'
);
const showEnterQrLink = computed(
  () =>
    isPhoneNumber.value &&
    !isConnected.value &&
    !isBlockingOperation.value &&
    modalState.value !== 'phoneUnavailable' &&
    !(
      modalState.value === 'pairing' &&
      pairingCodePrimary.value &&
      pairingCodeSecondary.value
    )
);
const showChangePhoneLink = computed(
  () =>
    modalState.value === 'pairing' &&
    Boolean(pairingCodePrimary.value && pairingCodeSecondary.value) &&
    !isBlockingOperation.value
);

function resetPairingCodes() {
  pairingCodePrimary.value = '';
  pairingCodeSecondary.value = '';
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

function prepareConnectionStart() {
  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.awaitConnection;
  qrcode.value = undefined;
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
  phoneNumber.value = props.initialPhone
    ? formatPhoneBR(props.initialPhone)
    : null;
  disconnectedByUser.value = false;
  isPhoneNumber.value = false;
  phoneSent.value = false;
  connectionType.value = EBaileysConnectionType.qrcode;
  phoneConnection.value = undefined;
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function buildRequest(
  status: EWorkerStatus,
  removeSession = false
): StatusConnectionWorkerRequest {
  const payload: StatusConnectionWorkerRequest = {
    worker_id: channelId.value!,
    status,
    type: connectionType.value,
    phone_connection: phoneConnection.value,
  };

  if (removeSession) {
    payload.remove_session = true;
  }

  return payload;
}

async function reconnectChannel(restart = false) {
  if (!channelId.value) return;

  if (restart) {
    connectionType.value = EBaileysConnectionType.qrcode;
    phoneConnection.value = undefined;
    isPhoneNumber.value = false;
    phoneSent.value = false;
  }

  prepareConnectionStart();

  await channelStore.updateConnectionChannel(
    buildRequest(EWorkerStatus.online)
  );
}

async function recreateChannelWithFullCleanup() {
  if (!channelId.value) return;

  statusConnection.value = EBaileysConnectionStatus.connecting;
  statusCode.value = ECodeMessage.logoutInProgress;
  disconnectedByUser.value = true;
  qrcode.value = undefined;
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

async function sendPhoneNumber() {
  if (!channelId.value || !phoneConnection.value) return;

  phoneSent.value = true;
  connectionType.value = EBaileysConnectionType.phone;
  prepareConnectionStart();
  phoneSent.value = true;

  await channelStore.updateConnectionChannel(
    buildRequest(EWorkerStatus.online)
  );
}

function enterPhoneNumber() {
  if (isBrowserWorkerType.value) return;

  isPhoneNumber.value = true;
  phoneSent.value = false;
  connectionType.value = EBaileysConnectionType.phone;
  phoneConnection.value = undefined;
  qrcode.value = undefined;
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
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

function changePhone() {
  isPhoneNumber.value = true;
  phoneSent.value = false;
  phoneConnection.value = undefined;
  pairingStartedAt.value = null;
  resetPairingCodes();
  clearConnectedStateDelay();
}

async function enterQrcode() {
  isPhoneNumber.value = false;
  phoneSent.value = false;
  connectionType.value = EBaileysConnectionType.qrcode;
  phoneConnection.value = undefined;
  prepareConnectionStart();

  if (channelId.value) {
    await channelStore.updateConnectionChannel(
      buildRequest(EWorkerStatus.online)
    );
  }
}

function shouldIgnoreIncomingState(data: IBaileysConnectionState): boolean {
  const incomingCode = data.code as ECodeMessage | undefined;
  const incomingStatus = data.status as EBaileysConnectionStatus | undefined;
  const isIncomingConnected =
    incomingStatus === EBaileysConnectionStatus.connected ||
    incomingCode === ECodeMessage.connectionEstablished;
  const isStaleStartupEvent =
    incomingCode === ECodeMessage.awaitConnection && !data.qrcode;
  const isCurrentUserActionState =
    statusCode.value === ECodeMessage.awaitingReadQrCode ||
    statusCode.value === ECodeMessage.awaitingPairingCode ||
    statusCode.value === ECodeMessage.pairingInProgress ||
    statusCode.value === ECodeMessage.newLoginAttempt;

  if (
    statusCode.value === ECodeMessage.phoneNotAvailable &&
    !isIncomingConnected
  ) {
    return true;
  }

  if (isStaleStartupEvent && qrcode.value) {
    return true;
  }

  if (isStaleStartupEvent && isCurrentUserActionState) {
    return true;
  }

  if (
    isStaleStartupEvent &&
    statusConnection.value === EBaileysConnectionStatus.connected
  ) {
    return true;
  }

  return false;
}

function applyConnectedState(data: IBaileysConnectionState) {
  isResetting.value = false;
  statusConnection.value = EBaileysConnectionStatus.connected;
  statusCode.value = ECodeMessage.connectionEstablished;
  phoneNumber.value = data.phone ? formatPhoneBR(data.phone) : null;
  disconnectedByUser.value = false;
  qrcode.value = undefined;
  isPhoneNumber.value = false;
  phoneSent.value = false;
  connectionType.value = EBaileysConnectionType.qrcode;
  phoneConnection.value = undefined;
  secondsNextAttempt.value = 0;
  pairingStartedAt.value = null;
  resetPairingCodes();
  clearNextAttemptCountdown();
  clearConnectedStateDelay();
}

function handleWorkerConnectionMessage(data: IBaileysConnectionState) {
  if (!channelId.value || data.worker_id !== channelId.value) {
    return;
  }

  if (data.worker_status_id === EWorkerStatus.recreating) {
    isResetting.value = true;
    statusConnection.value = EBaileysConnectionStatus.connecting;
    statusCode.value = ECodeMessage.awaitConnection;
    qrcode.value = undefined;
    pairingStartedAt.value = null;
    resetPairingCodes();
    clearConnectedStateDelay();
    return;
  }

  if (data.worker_status_id) {
    isResetting.value = false;
  }

  if (shouldIgnoreIncomingState(data)) {
    return;
  }

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

  if (data.disconnected_user !== undefined) {
    disconnectedByUser.value = data.disconnected_user;
  }

  if (data.qrcode) {
    qrcode.value = data.qrcode;
  } else if (
    incomingCode === ECodeMessage.awaitConnection ||
    incomingCode === ECodeMessage.logoutInProgress ||
    incomingCode === ECodeMessage.pairingInProgress ||
    incomingCode === ECodeMessage.newLoginAttempt ||
    incomingStatus === EBaileysConnectionStatus.disconnected
  ) {
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

  if (data.phone) {
    phoneNumber.value = formatPhoneBR(data.phone);
  }

  if (data.pairing_code) {
    const [primary, secondary] = splitCode(data.pairing_code);
    pairingCodePrimary.value = primary;
    pairingCodeSecondary.value = secondary;
  }

  if (data.seconds_until_next_attempt) {
    secondsNextAttempt.value = data.seconds_until_next_attempt;
    startNextAttemptCountdown();
  }
}

onMounted(async () => {
  if (!channelId.value || !accountId.value) {
    return;
  }

  prepareInitialModalState();

  await onMessage(
    workerCentrifugoQueue(accountId.value),
    handleWorkerConnectionMessage
  );

  await channelStore.updateConnectionChannel(
    buildRequest(EWorkerStatus.online)
  );
});

onUnmounted(() => {
  clearNextAttemptCountdown();
  clearConnectedStateDelay();

  if (accountId.value) {
    void unsubscribe(
      workerCentrifugoQueue(accountId.value),
      handleWorkerConnectionMessage
    );
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="640">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard>
      <VRow no-gutters>
        <VCol cols="12" sm="8" md="12" lg="7" order="2" order-lg="1">
          <VCardItem>
            <VCardTitle>{{ $t('conection') }}</VCardTitle>
          </VCardItem>

          <VCardText v-if="modalState === 'phoneInput'">
            <div class="connection-copy">
              <VIcon
                :icon="stageMeta.icon"
                :color="stageMeta.color"
                size="52"
              />
              <h4 class="text-h5 mb-1">{{ $t(stageMeta.title) }}</h4>
              <p class="mb-1">{{ $t(stageMeta.description) }}</p>
              <p class="mb-3">
                <strong>{{ $t('attention') }}:</strong>
                {{ $t('is_limited') }}
              </p>
            </div>

            <v-phone-input v-model="phoneConnection" />

            <VBtn
              :loading="channelStore.loading"
              :disabled="channelStore.loading || !phoneConnection"
              block
              class="mt-3"
              @click="sendPhoneNumber"
            >
              {{ $t('request') }}
            </VBtn>
          </VCardText>

          <VCardText v-else class="connection-stage">
            <div class="connection-visual">
              <VImg
                v-if="modalState === 'qrReady' && qrcode"
                :src="qrcode"
                max-width="240"
                width="240"
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
              <h4 class="text-h6 mb-2">{{ $t(stageMeta.title) }}</h4>
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
                @click="reconnectChannel(true)"
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

          <VCardText v-if="showEnterQrLink" class="text-center pt-0">
            <a class="clickable" @click="enterQrcode">
              {{ $t('enter_qrcode') }}
            </a>
          </VCardText>

          <VCardText v-if="showChangePhoneLink" class="text-center pt-0">
            <a class="clickable" @click="changePhone">
              {{ $t('change_phone_number') }}
            </a>
          </VCardText>

          <VCardText v-else-if="showEnterPhoneLink" class="text-center pt-0">
            <a class="clickable" @click="enterPhoneNumber">
              {{ $t('enter_phone_number') }}
            </a>
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

.clickable {
  cursor: pointer;
}
</style>
