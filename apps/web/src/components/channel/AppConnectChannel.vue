<script lang="ts" setup>
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

const channelStore = useChannelsStore();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', v: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');

const statusConnection = ref<EBaileysConnectionStatus>(
  EBaileysConnectionStatus.disconnected
);
const statusCode = ref<ECodeMessage>(ECodeMessage.awaitConnection);

const totalSeconds = ref(60);
const elapsedSeconds = ref(0);

const qrcode = ref<string | null>(null);

const intervalId = ref<number | null>(null);
const intervalIdNextAttempt = ref<number | null>(null);

const phoneNumber = ref<string | null>(null);

const attempt = ref(0);
const maxAttempts = ref(4);

const removeInPhone = ref(false);
const isPhoneNumber = ref(false);

const pairingCodePrimary = ref<string>();
const pairingCodeSecondary = ref<string>();

const connectionType = ref<EBaileysConnectionType>(
  EBaileysConnectionType.qrcode
);

const phoneConnection = ref<string | undefined>();

const phoneSent = ref(false);

const secondsNextAttempt = ref(0);

const isConnected = computed(
  () => statusConnection.value === EBaileysConnectionStatus.connected
);

const isDisconnected = computed(
  () => statusConnection.value === EBaileysConnectionStatus.disconnected
);

const progress = computed(() => calculateProgress(elapsedSeconds.value).value);
const progressColor = computed(
  () => calculateProgress(elapsedSeconds.value).color
);

const formattedTime = computed(() => {
  const m = Math.floor(secondsNextAttempt.value / 60)
    .toString()
    .padStart(2, '0');
  const s = (secondsNextAttempt.value % 60).toString().padStart(2, '0');

  return `${m}:${s}`;
});

function calculateProgress(seconds: number, max = totalSeconds.value) {
  const value = Math.min(Math.round((seconds / max) * 100), 100);

  if (value > 75) return { value, color: 'error' as const };
  if (value > 50) return { value, color: 'warning' as const };

  return { value, color: 'success' as const };
}

function splitCode(code: string): [string, string] {
  return [code.slice(0, 4), code.slice(4)];
}

async function reconnectChannel(restart = false) {
  if (!channelId.value) return;
  if (restart) attempt.value = 0;

  resetPairingCodes();

  await channelStore.updateConnectionChannel(
    buildRequest(EWorkerStatus.online)
  );
}

async function disponibleChannel() {
  if (!channelId.value) return;

  await channelStore.updateConnectionChannel(
    buildRequest(EWorkerStatus.disponible)
  );
}

async function sendPhoneNumber() {
  if (!channelId.value || !phoneConnection.value) return;

  phoneSent.value = true;
  totalSeconds.value = 120;
  maxAttempts.value = 2;

  resetPairingCodes();

  await channelStore.updateConnectionChannel(
    buildRequest(EWorkerStatus.online)
  );
}

function enterPhoneNumber() {
  secondsNextAttempt.value = 0;
  isPhoneNumber.value = true;
  phoneSent.value = false;
  connectionType.value = EBaileysConnectionType.phone;
  phoneNumber.value = null;
  attempt.value = 0;
}

function changePhone() {
  isPhoneNumber.value = true;
  phoneSent.value = false;
  phoneConnection.value = undefined;

  resetPairingCodes();
}

async function enterQrcode() {
  isPhoneNumber.value = false;
  connectionType.value = EBaileysConnectionType.qrcode;
  phoneConnection.value = undefined;
  attempt.value = 0;
  secondsNextAttempt.value = 0;
  totalSeconds.value = 60;
  statusCode.value = ECodeMessage.awaitConnection;

  if (channelId.value) {
    clearTimer();

    await channelStore.updateConnectionChannel(
      buildRequest(EWorkerStatus.online)
    );
  }
}

function startTimer() {
  elapsedSeconds.value = 0;
  clearTimer();

  intervalId.value = window.setInterval(() => {
    if (
      (!phoneSent.value &&
        connectionType.value === EBaileysConnectionType.phone) ||
      statusCode.value === ECodeMessage.phoneNotAvailable
    ) {
      clearTimer();

      return;
    }

    if (elapsedSeconds.value < totalSeconds.value) {
      elapsedSeconds.value++;

      return;
    }

    elapsedSeconds.value = 0;
    if (attempt.value <= maxAttempts.value) {
      attempt.value++;
      reconnectChannel();

      return;
    }

    clearTimer();
  }, 1000);
}

function clearTimer() {
  if (intervalId.value !== null) clearInterval(intervalId.value);

  intervalId.value = null;
}

function resetPairingCodes() {
  pairingCodePrimary.value = '';
  pairingCodeSecondary.value = '';
}

function buildRequest(status: EWorkerStatus): StatusConnectionWorkerRequest {
  return {
    worker_id: channelId.value!,
    status,
    type: connectionType.value,
    phone_connection: phoneConnection.value,
  };
}

function startNextAttemptCountdown() {
  intervalIdNextAttempt.value = window.setInterval(() => {
    if (secondsNextAttempt.value > 0) secondsNextAttempt.value--;
  }, 1000);
}

onMounted(async () => {
  await onMessage(
    `worker_${channelId.value}_qrcode`,
    (data: IBaileysConnectionState) => {
      if (data?.worker_id !== channelId.value) return;
      if (statusCode.value === ECodeMessage.phoneNotAvailable) return;

      if (data.status) {
        statusConnection.value = data.status as EBaileysConnectionStatus;
        if (statusConnection.value === EBaileysConnectionStatus.connected) {
          phoneNumber.value = null;
          isPhoneNumber.value = false;
          phoneSent.value = false;
          connectionType.value = EBaileysConnectionType.qrcode;

          resetPairingCodes();
        }
      }

      if (data.qrcode) qrcode.value = data.qrcode;
      if (data.code) {
        statusCode.value = data.code as ECodeMessage;

        if (data.code === ECodeMessage.loggedOut) {
          attempt.value = 0;
          removeInPhone.value = true;
        }
      }

      if (data.phone) phoneNumber.value = formatPhoneBR(data.phone);

      if (
        data.status === EBaileysConnectionStatus.connecting &&
        qrcode.value &&
        attempt.value <= maxAttempts.value
      ) {
        startTimer();
      }

      if (data.pairing_code) {
        const [p, s] = splitCode(data.pairing_code);

        pairingCodePrimary.value = p;
        pairingCodeSecondary.value = s;
      }

      if (data.seconds_until_next_attempt) {
        secondsNextAttempt.value = data.seconds_until_next_attempt;

        startNextAttemptCountdown();
      }

      channelStore.updateInfoChannel(data);
    }
  );

  if (channelId.value)
    await channelStore.updateConnectionChannel(
      buildRequest(EWorkerStatus.online)
    );
});

onBeforeMount(() => {
  clearTimer();

  if (intervalIdNextAttempt.value !== null) {
    clearInterval(intervalIdNextAttempt.value);
  }

  unsubscribe(`worker_${channelId.value}_qrcode`);
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="channelStore.loading">
      <VOverlay
        :model-value="channelStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard>
      <VRow no-gutters>
        <VCol cols="12" sm="8" md="12" lg="7" order="2" order-lg="1">
          <VCardItem>
            <VCardTitle>{{ $t('conection') }}</VCardTitle>
          </VCardItem>

          <div v-if="attempt > maxAttempts && !isConnected && !isPhoneNumber">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-mobiledata-off" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('connection_timeout') }}</i>
            </VCardText>
          </div>

          <div v-else-if="statusCode === ECodeMessage.newLoginAttempt">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-brand-whatsapp" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('connection_in_progress') }}</i>
            </VCardText>
          </div>

          <div v-else-if="statusCode === ECodeMessage.awaitConnection">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-hourglass-high" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('awaiting_connection') }}</i>
            </VCardText>
          </div>

          <VCardText
            v-else-if="
              isPhoneNumber && !phoneSent && !isDisconnected && !isConnected
            "
          >
            <h4 class="text-h4 mb-1">{{ $t('for_phone') }} 💬</h4>
            <p class="mb-1">{{ $t('request_phone_number') }}</p>
            <p class="mb-1">
              <strong>{{ $t('attention') }}:</strong> {{ $t('is_limited') }}
            </p>

            <v-phone-input v-model="phoneConnection" />

            <VCol cols="12">
              <VBtn
                :loading="channelStore.loading"
                :disabled="channelStore.loading"
                block
                class="mt-2"
                @click="sendPhoneNumber"
              >
                {{ $t('request') }}
              </VBtn>
            </VCol>
          </VCardText>

          <VCardText
            v-else-if="
              statusCode === ECodeMessage.phoneNotAvailable &&
              secondsNextAttempt
            "
          >
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-device-mobile-off" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('phone_not_available') }}</i
              ><br />
              <strong>{{ $t('seconds_until_next_attempt') }}:</strong><br />
              <strong class="text-h5">{{ formattedTime }}</strong
              ><br />
              <small>{{ $t('wait_until_next_attempt') }}</small>
            </VCardText>
          </VCardText>

          <VCardText
            v-else-if="isPhoneNumber && !isDisconnected && !isConnected"
          >
            <h4 class="text-h4 mb-1">{{ $t('for_phone') }} 💬</h4>
            <VCardText
              class="d-flex flex-column align-center gap-2"
              v-if="!pairingCodePrimary || !pairingCodeSecondary"
            >
              <p class="mb-1">{{ $t('code_requested') }}</p>
              <VProgressCircular indeterminate size="40" color="primary" />
            </VCardText>

            <VCardText v-else>
              <p class="mb-1">{{ $t('for_phone_description') }}</p>

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

              <VCardText class="text-center">
                <VProgressLinear
                  :model-value="progress"
                  :color="progressColor"
                  size="32"
                />
              </VCardText>
            </VCardText>
          </VCardText>

          <div
            v-else-if="
              !isPhoneNumber &&
              statusCode === ECodeMessage.awaitingReadQrCode &&
              qrcode &&
              !isDisconnected &&
              !isConnected
            "
          >
            <VCardText class="d-flex justify-center">
              <VImg :src="qrcode" max-width="240" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('awaiting_qr_code') }}</i>
              <VProgressLinear
                :model-value="progress"
                :color="progressColor"
                size="32"
              />
            </VCardText>
          </div>

          <div v-else-if="isDisconnected && removeInPhone && !isPhoneNumber">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-plug-connected-x" color="error" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('connection_removed_in_phone') }}</i>
            </VCardText>
          </div>

          <div v-else-if="isDisconnected">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-plug-connected-x" color="error" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('connection_removed') }}</i>
            </VCardText>
          </div>

          <div v-else-if="isConnected">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-brand-whatsapp" color="success" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <i>{{ $t('connection_success') }}</i
              ><br />
              <small>{{ phoneNumber }}</small>
            </VCardText>
          </div>

          <VCardText
            class="d-flex justify-center"
            v-if="
              !isPhoneNumber ||
              isConnected ||
              statusCode === ECodeMessage.newLoginAttempt
            "
          >
            <div class="d-flex gap-2">
              <VBtn
                :disabled="!isConnected"
                color="error"
                @click="disponibleChannel"
              >
                <VTooltip
                  location="top"
                  activator="parent"
                  transition="scroll-x-transition"
                >
                  <span>{{ $t('remove') }}</span>
                </VTooltip>
                <VIcon icon="tabler-circle-off" />
              </VBtn>

              <VBtn
                :disabled="
                  !(attempt > maxAttempts && !isConnected) &&
                  !(isDisconnected && removeInPhone)
                "
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

          <div
            v-if="
              isPhoneNumber &&
              !isDisconnected &&
              !isConnected &&
              !pairingCodePrimary &&
              !pairingCodeSecondary
            "
          >
            <VCardText class="text-center">
              <a class="clickable" @click="enterQrcode">{{
                $t('enter_qrcode')
              }}</a>
            </VCardText>
          </div>

          <div
            v-else-if="
              isPhoneNumber &&
              pairingCodePrimary &&
              pairingCodeSecondary &&
              !isConnected &&
              statusCode !== ECodeMessage.newLoginAttempt &&
              !(
                statusCode === ECodeMessage.phoneNotAvailable &&
                secondsNextAttempt
              )
            "
          >
            <VCardText class="text-center">
              <a class="clickable" @click="changePhone">{{
                $t('change_phone_number')
              }}</a>
            </VCardText>
          </div>

          <div
            v-else-if="
              !isDisconnected &&
              !isConnected &&
              statusCode !== ECodeMessage.newLoginAttempt &&
              !(
                statusCode === ECodeMessage.phoneNotAvailable &&
                secondsNextAttempt
              )
            "
          >
            <VCardText class="text-center">
              <a class="clickable" @click="enterPhoneNumber">{{
                $t('enter_phone_number')
              }}</a>
            </VCardText>
          </div>
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
                <div
                  class="d-flex justify-space-between align-center gap-2 flex-wrap mb-2"
                >
                  <span class="app-timeline-title">{{
                    $t('open_whatsapp')
                  }}</span>
                  <span class="app-timeline-meta">{{
                    $t('certify_latest_version')
                  }}</span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="warning" size="16" />
                </template>
                <div
                  class="d-flex justify-space-between align-center gap-2 flex-wrap mb-2"
                >
                  <span class="app-timeline-title">{{
                    $t('tap_settings')
                  }}</span>
                  <span class="app-timeline-meta">{{
                    $t('you_top_right_corner')
                  }}</span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="info" size="16" />
                </template>
                <div
                  class="d-flex justify-space-between align-center gap-2 flex-wrap mb-2"
                >
                  <span class="app-timeline-title">{{
                    $t('select_connected_devices')
                  }}</span>
                  <span class="app-timeline-meta">{{
                    $t('access_connect_device')
                  }}</span>
                </div>
              </VTimelineItem>

              <VTimelineItem
                dot-color="rgb(var(--v-theme-surface))"
                size="x-small"
              >
                <template #icon>
                  <VIcon icon="tabler-circle" color="success" size="16" />
                </template>
                <div
                  class="d-flex justify-space-between align-center gap-2 flex-wrap mb-2"
                >
                  <span class="app-timeline-title">{{
                    $t('point_camera_screen')
                  }}</span>
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
.avatar-center {
  position: absolute;
  border: 3px solid rgb(var(--v-theme-surface));
  inset-block-start: -2rem;
  inset-inline-start: 1rem;
}

.member-pricing-bg {
  position: relative;
  background-color: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.membership-pricing {
  sup {
    inset-block-start: 9px;
  }
}

.v-btn {
  transform: none;
}

.clickable {
  cursor: pointer;
}
</style>
