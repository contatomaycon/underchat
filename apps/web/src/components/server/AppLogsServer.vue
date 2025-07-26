<script lang="ts" setup>
import { onMounted, onUnmounted } from 'vue';
import { useServerStore } from '@/@webcore/stores/server';
import { ServerLogsInstallResponse } from '@core/schema/server/serverLogsInstall/response.schema';

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
  serverId: number | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const fromElastic = ref(0);
const sizeElastic = ref(500);
const hasMore = ref(true);
const items = ref<ServerLogsInstallResponse[]>([]);

const serverId = toRef(props, 'serverId');
const containerLogsServer = ref<HTMLElement | null>(null);

const loadMore = async () => {
  if (!hasMore.value || !serverId.value) return;

  const response = await serverStore.searchInstallLogs(serverId.value, {
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
  const container = containerLogsServer.value;
  if (!container) return;

  const threshold = 50;
  const { scrollTop, scrollHeight, clientHeight } = container;

  if (scrollTop + clientHeight >= scrollHeight - threshold) {
    loadMore();
  }
};

watch(
  () => containerLogsServer.value,
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
  containerLogsServer.value?.removeEventListener('scroll', handleScroll);
});

watch(
  () => serverId.value,
  async (newServerId) => {
    if (newServerId) {
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

    <template v-if="serverStore.loading">
      <VOverlay
        :model-value="serverStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard :title="$t('server_logs')">
      <VCardText>
        <div
          ref="containerLogsServer"
          class="app-bar-search-list py-0"
          style="max-height: 60vh; overflow-y: auto"
        >
          <VList v-show="items.length" density="compact">
            <template v-for="item in items" :key="item">
              <slot :item="item">
                <VListItem>
                  <VListItemTitle class="wrap-text">
                    <strong>{{ item.date }}:</strong>
                    {{ item.command }}
                  </VListItemTitle>
                  <VListItemSubtitle class="wrap-text">
                    {{ item.output }}
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
