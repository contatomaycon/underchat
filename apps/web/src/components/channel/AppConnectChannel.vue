<script lang="ts" setup>
import { onMessage } from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

const channelStore = useChannelsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');
const statusConnection = ref<EBaileysConnectionStatus>(
  EBaileysConnectionStatus.disconnected
);
const statusCode = ref<ECodeMessage>(ECodeMessage.awaitConnection);
const totalSeconds = ref(15);
const elapsedSeconds = ref(0);
const qrcode = ref<string | null>(null);
const intervalId = ref<number | null>(null);
const phoneNumber = ref<string | null>(null);
const numberAttempt = ref(0);
const numberMaxAttempt = ref(4);
const removeInPhone = ref(false);

const getProgress = (seconds: number, max = totalSeconds.value) => {
  const value = Math.min(Math.round((seconds / max) * 100), 100);

  if (value > 75)
    return {
      value,
      color: 'error' as const,
    };

  if (value > 50)
    return {
      value,
      color: 'warning' as const,
    };

  return {
    value,
    color: 'success' as const,
  };
};

const startTimer = () => {
  elapsedSeconds.value = 0;

  if (intervalId.value !== null) clearInterval(intervalId.value);

  intervalId.value = window.setInterval(() => {
    if (elapsedSeconds.value < totalSeconds.value) {
      elapsedSeconds.value++;
      return;
    }

    elapsedSeconds.value = 0;
    if (numberAttempt.value <= numberMaxAttempt.value) {
      numberAttempt.value++;
      reconnectChannel();

      return;
    }

    clearInterval(intervalId.value!);
    intervalId.value = null;
  }, 1000);
};

const reconnectChannel = async (restart: boolean = false) => {
  if (!channelId.value) return;
  if (restart) numberAttempt.value = 0;

  const input: StatusConnectionWorkerRequest = {
    worker_id: channelId.value,
    status: EWorkerStatus.online,
  };

  await channelStore.updateConnectionChannel(input);
};

const disponibleChannel = async () => {
  if (!channelId.value) return;

  const input: StatusConnectionWorkerRequest = {
    worker_id: channelId.value,
    status: EWorkerStatus.disponible,
  };

  await channelStore.updateConnectionChannel(input);
};

const isConnected = computed(
  () => statusConnection.value === EBaileysConnectionStatus.connected
);
const isDisconnected = computed(
  () => statusConnection.value === EBaileysConnectionStatus.disconnected
);

const progress = computed(() => getProgress(elapsedSeconds.value).value);
const progressColor = computed(() => getProgress(elapsedSeconds.value).color);

onMounted(async () => {
  await onMessage(
    `worker_${channelId.value}_qrcode`,
    (data: IBaileysConnectionState) => {
      if (data?.worker_id !== channelId.value) return;

      if (data?.status) {
        statusConnection.value = data.status as EBaileysConnectionStatus;
      }

      if (data?.qrcode) {
        qrcode.value = data.qrcode;
      }

      if (data?.code) {
        statusCode.value = data.code as ECodeMessage;

        if (data.code === ECodeMessage.loggedOut) {
          numberAttempt.value = 0;
          removeInPhone.value = true;
        }
      }

      if (data?.phone) {
        phoneNumber.value = formatPhoneBR(data.phone);
      }

      if (
        data.status === EBaileysConnectionStatus.connecting &&
        qrcode.value &&
        numberAttempt.value <= numberMaxAttempt.value
      ) {
        startTimer();
      }

      channelStore.updateInfoChannel(data);
    }
  );

  if (channelId.value) {
    const input: StatusConnectionWorkerRequest = {
      worker_id: channelId.value,
      status: EWorkerStatus.online,
    };

    await channelStore.updateConnectionChannel(input);
  }
});

onBeforeMount(() => {
  if (intervalId.value !== null) {
    clearInterval(intervalId.value);
  }
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

          <div v-if="numberAttempt > numberMaxAttempt && !isConnected">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-mobiledata-off" size="150" />
            </VCardText>

            <VCardText class="text-center">
              <i>{{ $t('connection_timeout') }}</i>
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

          <div
            v-else-if="
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

          <div v-else-if="statusCode === ECodeMessage.newLoginAttempt">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-brand-whatsapp" size="150" />
            </VCardText>

            <VCardText class="text-center">
              <i>{{ $t('connection_in_progress') }}</i>
            </VCardText>
          </div>

          <div v-else-if="isDisconnected && removeInPhone">
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
              <i>{{ $t('connection_success') }}</i>
              <br />
              <small>{{ phoneNumber }}</small>
            </VCardText>
          </div>

          <VCardText class="d-flex justify-center">
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
                  !(numberAttempt > numberMaxAttempt && !isConnected) &&
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
</style>
