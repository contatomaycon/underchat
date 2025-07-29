<script lang="ts" setup>
import { onMessage } from '@/@webcore/centrifugo';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

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

watch(channelId, async (id) => {
  if (!id) return;

  const input: StatusConnectionWorkerRequest = {
    worker_id: id,
    status: EWorkerStatus.online,
  };

  await channelStore.updateConnectionChannel(input);
});

onMounted(() => {
  onMessage(`worker:${channelId}:qrcode`, (data: IBaileysConnectionState) => {
    console.log('Baileys QR Code:', data);
  });
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

    <VCard :title="$t('add_server')">
      <VCardText> </VCardText>
    </VCard>
  </VDialog>
</template>
