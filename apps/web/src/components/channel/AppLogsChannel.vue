<script lang="ts" setup>
import { onMounted, onUnmounted } from 'vue';
import { formatDateTimeSeconds } from '@core/common/functions/formatDateTimeSeconds';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { WorkerConnectionLogsResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';

const channelStore = useChannelsStore();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const fromElastic = ref(0);
const sizeElastic = ref(500);
const hasMore = ref(true);
const items = ref<WorkerConnectionLogsResponse[]>([]);

const channelId = toRef(props, 'channelId');
const containerLogsChannel = ref<HTMLElement | null>(null);

const loadMore = async () => {
  if (!hasMore.value || !channelId.value) return;

  const response = await channelStore.channelLogsConnection(channelId.value, {
    from: fromElastic.value,
    size: sizeElastic.value,
  });

  if (response.length === 0) {
    hasMore.value = false;
    return;
  }

  items.value.push(...response);
  fromElastic.value += response.length;
};

const handleScroll = () => {
  const container = containerLogsChannel.value;
  if (!container) return;

  const threshold = 50;
  const { scrollTop, scrollHeight, clientHeight } = container;

  if (scrollTop + clientHeight >= scrollHeight - threshold) {
    loadMore();
  }
};

watch(
  () => containerLogsChannel.value,
  (container) => {
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
  },
  { immediate: true }
);

onMounted(async () => {
  await nextTick();
});

onUnmounted(() => {
  containerLogsChannel.value?.removeEventListener('scroll', handleScroll);
});

watch(
  () => channelId.value,
  async (newchannelId) => {
    if (newchannelId) {
      items.value = [];
      fromElastic.value = 0;
      hasMore.value = true;

      await loadMore();
    }
  },
  { immediate: true }
);
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

    <VCard :title="$t('worker_logs_connection')">
      <VCardText>
        <div
          ref="containerLogsChannel"
          class="app-bar-search-list py-0"
          style="max-height: 60vh; overflow-y: auto"
        >
          <VList v-show="items.length" density="compact">
            <template v-for="item in items" :key="item">
              <slot :item="item">
                <VListItem>
                  <VListItemTitle class="wrap-text">
                    <strong>{{ formatDateTimeSeconds(item.date) }}:</strong>
                    {{ item.code }}: {{ item.status }}
                  </VListItemTitle>
                  <VListItemSubtitle class="wrap-text">
                    {{ item.message }}
                  </VListItemSubtitle>
                </VListItem>
              </slot>
            </template>
          </VList>
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.wrap-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
