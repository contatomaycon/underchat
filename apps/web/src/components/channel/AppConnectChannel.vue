<script lang="ts" setup>
import { onMessage } from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';

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
const totalSeconds = ref(15);
const elapsedSeconds = ref(0);
const qrcode = ref<string | null>(null);
const intervalId = ref<number | null>(null);

const getProgress = (seconds: number, max = totalSeconds.value) => {
  const value = Math.min(Math.round((seconds / max) * 100), 100);
  if (value > 75) return { value, color: 'error' as const };
  if (value > 50) return { value, color: 'warning' as const };
  return { value, color: 'success' as const };
};

const startTimer = () => {
  elapsedSeconds.value = 0;
  if (intervalId.value !== null) clearInterval(intervalId.value);
  intervalId.value = window.setInterval(() => {
    if (elapsedSeconds.value < totalSeconds.value) {
      elapsedSeconds.value++;
    } else {
      elapsedSeconds.value = 0;
      reconnectChannel();
    }
  }, 1000);
};

const reconnectChannel = async () => {
  if (!channelId.value) return;
  const input: StatusConnectionWorkerRequest = {
    worker_id: channelId.value,
    status: EWorkerStatus.online,
  };
  await channelStore.updateConnectionChannel(input);
};

const isConnected = computed(
  () => statusConnection.value === EBaileysConnectionStatus.connected
);
const isConnecting = computed(
  () => statusConnection.value === EBaileysConnectionStatus.connecting
);
const isDisconnected = computed(
  () => statusConnection.value === EBaileysConnectionStatus.disconnected
);

const progress = computed(() => getProgress(elapsedSeconds.value).value);
const progressColor = computed(() => getProgress(elapsedSeconds.value).color);

onMounted(async () => {
  onMessage(
    `worker_${channelId.value}_qrcode`,
    (data: IBaileysConnectionState) => {
      console.log('Received connection update:', data);

      if (data?.worker_id !== channelId.value) return;
      if (data?.status)
        statusConnection.value = data.status as EBaileysConnectionStatus;
      if (data?.qrcode) qrcode.value = data.qrcode;

      if (data.status === EBaileysConnectionStatus.connecting) {
        startTimer();
      }
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
  if (intervalId.value !== null) clearInterval(intervalId.value);
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

          <div v-if="qrcode && !isDisconnected && !isConnected">
            <VCardText class="d-flex justify-center">
              <VImg :src="qrcode" max-width="240" />
            </VCardText>

            <VCardText>
              <VProgressLinear
                :model-value="progress"
                :color="progressColor"
                size="32"
              />
            </VCardText>
          </div>

          <div v-if="isDisconnected">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-plug-connected-x" color="error" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <strong>{{ $t('connection_failed') }}</strong>
            </VCardText>
          </div>

          <div v-if="isConnected">
            <VCardText class="d-flex justify-center">
              <VIcon icon="tabler-plug-connected" color="success" size="150" />
            </VCardText>
            <VCardText class="text-center">
              <strong>{{ $t('connection_success') }}</strong>
            </VCardText>
          </div>

          <VCardText class="d-flex justify-center">
            <div class="d-flex gap-2">
              <VBtn :disabled="!isConnected" color="error">
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
                :disabled="isConnecting"
                color="warning"
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
