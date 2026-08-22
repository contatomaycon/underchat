<script lang="ts" setup>
import { computed, shallowRef, toRef, watch } from 'vue';
import { useServerStore } from '@/@webcore/stores/server';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ServerLogsInstallResponse } from '@core/schema/server/serverLogsInstall/response.schema';
import AppInstallConsolePanel from './AppInstallConsolePanel.vue';

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
  serverId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const fromElastic = shallowRef(0);
const sizeElastic = shallowRef(300);
const hasMore = shallowRef(true);
const items = shallowRef<ServerLogsInstallResponse[]>([]);
const isLoadingLogs = shallowRef(false);
const serverStatus = shallowRef<string | null>(null);

const serverId = toRef(props, 'serverId');

const loadMore = async (): Promise<void> => {
  if (!hasMore.value || !serverId.value || isLoadingLogs.value) return;

  isLoadingLogs.value = true;
  try {
    const response = await serverStore.searchInstallLogs(serverId.value, {
      from: fromElastic.value,
      size: sizeElastic.value,
      sort: ESortOrder.desc,
    });

    if (response.length === 0) {
      hasMore.value = false;
      return;
    }

    const chronologicalResponse = [...response].reverse();
    items.value =
      fromElastic.value === 0
        ? chronologicalResponse
        : [...chronologicalResponse, ...items.value];
    fromElastic.value += response.length;
    hasMore.value = response.length === sizeElastic.value;
  } finally {
    isLoadingLogs.value = false;
  }
};

watch(
  [isVisible, serverId],
  async ([visible, currentServerId]) => {
    if (!visible || !currentServerId) return;

    items.value = [];
    fromElastic.value = 0;
    hasMore.value = true;
    serverStatus.value = null;

    const [, server] = await Promise.all([
      loadMore(),
      serverStore.getServerById(currentServerId, { silent: true }),
    ]);
    serverStatus.value = server?.status.id ?? null;
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="980">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard class="server-install-console-card">
      <VCardText class="server-install-console-card__body">
        <AppInstallConsolePanel
          :has-more="hasMore"
          :items="items"
          :loading="isLoadingLogs && items.length === 0"
          :server-status="serverStatus"
          @load-more="loadMore"
        />
      </VCardText>

      <VCardText
        class="server-install-console-card__footer d-flex justify-end flex-wrap gap-3"
      >
        <VBtn
          color="secondary"
          prepend-icon="tabler-x"
          variant="tonal"
          @click="isVisible = false"
        >
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.server-install-console-card {
  display: flex;
  flex-direction: column;
  block-size: min(940px, calc(100vh - 32px));
}

.server-install-console-card__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-block-size: 0;
  overflow: hidden;
}

.server-install-console-card__footer {
  flex: 0 0 auto;
}
</style>
