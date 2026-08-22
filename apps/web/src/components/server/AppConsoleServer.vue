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
  addCentrifugoLifecycleListener,
  onMessage,
  unsubscribe,
} from '@/@webcore/centrifugo';
import { useServerStore } from '@/@webcore/stores/server';
import {
  serverSshCentrifugoQueue,
  statusServerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import type { IServerSshCentrifugo } from '@core/common/interfaces/IServerSshCentrifugo';
import type { IStatusServerCentrifugo } from '@core/common/interfaces/IStatusServerCentrifugo';
import AppInstallConsolePanel from './AppInstallConsolePanel.vue';
import type { InstallConsoleSourceItem } from './installConsole';

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
  serverId: string | null;
  serverStatus?: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const serverId = toRef(props, 'serverId');
const items = shallowRef<InstallConsoleSourceItem[]>([]);
const isLoadingHistory = shallowRef(false);
const authoritativeStatus = shallowRef<string | null>(
  props.serverStatus ?? null
);
let statusReconciliationTimer: ReturnType<typeof setInterval> | null = null;
let removeLifecycleListener: (() => void) | null = null;

const itemIdentity = (item: InstallConsoleSourceItem): string =>
  item.event_id ??
  [
    item.installation_id ?? '',
    new Date(item.date).getTime(),
    item.command ?? '',
    item.output ?? '',
  ].join(':');

const mergeItems = (
  ...sources: InstallConsoleSourceItem[][]
): InstallConsoleSourceItem[] => {
  const byId = new Map<string, InstallConsoleSourceItem>();

  for (const item of sources.flat()) {
    byId.set(itemIdentity(item), item);
  }

  return [...byId.values()]
    .sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime()
    )
    .slice(-500);
};

const loadRecentLogs = async (): Promise<void> => {
  const requestedServerId = serverId.value;
  if (!requestedServerId) return;

  isLoadingHistory.value = true;
  try {
    const response = await serverStore.searchInstallLogs(requestedServerId, {
      from: 0,
      size: 300,
      sort: ESortOrder.desc,
    });

    if (serverId.value !== requestedServerId) return;
    items.value = mergeItems([...response].reverse(), items.value);
  } finally {
    if (serverId.value === requestedServerId) {
      isLoadingHistory.value = false;
    }
  }
};

const appendLiveItem = (data: IServerSshCentrifugo): void => {
  if (data.server_id !== serverId.value) return;

  items.value = mergeItems(items.value, [data]);
};

const handleStatusItem = (data: IStatusServerCentrifugo): void => {
  if (data.server_id !== serverId.value) return;
  authoritativeStatus.value = data.status;
};

const refreshAuthoritativeStatus = async (): Promise<void> => {
  const requestedServerId = serverId.value;
  if (!requestedServerId || !isVisible.value) return;

  const server = await serverStore.getServerById(requestedServerId, {
    silent: true,
  });
  if (server && serverId.value === requestedServerId && isVisible.value) {
    authoritativeStatus.value = server.status.id;
  }
};

const stopStatusReconciliation = (): void => {
  if (!statusReconciliationTimer) return;
  clearInterval(statusReconciliationTimer);
  statusReconciliationTimer = null;
};

const startStatusReconciliation = (): void => {
  stopStatusReconciliation();
  statusReconciliationTimer = setInterval(() => {
    void refreshAuthoritativeStatus();
  }, 2_000);
};

watch(
  [isVisible, serverId],
  async ([visible, currentServerId]) => {
    if (!visible || !currentServerId) return;

    items.value = [];
    authoritativeStatus.value = props.serverStatus ?? null;
    await Promise.all([loadRecentLogs(), refreshAuthoritativeStatus()]);
    if (!isVisible.value || serverId.value !== currentServerId) return;
    startStatusReconciliation();
  },
  { immediate: true }
);

watch(
  () => props.serverStatus,
  (status) => {
    if (status) authoritativeStatus.value = status;
  }
);

watch(isVisible, (visible) => {
  if (!visible) stopStatusReconciliation();
});

onMounted(async () => {
  await Promise.all([
    onMessage(serverSshCentrifugoQueue(), appendLiveItem),
    onMessage(statusServerCentrifugoQueue(), handleStatusItem),
  ]);

  removeLifecycleListener = addCentrifugoLifecycleListener((event) => {
    if (event.type !== 'recovery_failed' || !isVisible.value) return;

    if (event.channel === serverSshCentrifugoQueue()) {
      void loadRecentLogs();
    }
    if (event.channel === statusServerCentrifugoQueue()) {
      void refreshAuthoritativeStatus();
    }
  });
});

onUnmounted(() => {
  stopStatusReconciliation();
  removeLifecycleListener?.();
  void unsubscribe(serverSshCentrifugoQueue(), appendLiveItem);
  void unsubscribe(statusServerCentrifugoQueue(), handleStatusItem);
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="980">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard class="server-install-console-card">
      <VCardText class="server-install-console-card__body">
        <AppInstallConsolePanel
          :items="items"
          :loading="isLoadingHistory"
          :server-status="authoritativeStatus"
          live
        />
      </VCardText>

      <VCardText
        class="server-install-console-card__footer d-flex justify-end gap-3"
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
