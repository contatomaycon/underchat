<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore } from '@/@webcore/stores/chat';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EColor } from '@core/common/enums/EColor';
import { useI18n } from 'vue-i18n';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getUser } from '@/@webcore/localStorage/user';

const { t } = useI18n();
const router = useRouter();
const chatStore = useChatStore();
const dashboardStore = useDashboardStore();

const offlineChannels = computed(() => {
  return dashboardStore.offlineChannels;
});

const prioritizedChannels = computed(() => {
  const activeWorkerId = chatStore.activeChat?.worker?.id;
  const channels = [...offlineChannels.value];

  if (activeWorkerId) {
    const activeIndex = channels.findIndex(
      (channel) => channel.id === activeWorkerId
    );
    if (activeIndex > -1) {
      const [activeChannel] = channels.splice(activeIndex, 1);
      channels.unshift(activeChannel);
    }
  }

  return channels;
});

const displayedChannels = computed(() => {
  return prioritizedChannels.value.slice(0, 2);
});

const remainingChannels = computed(() => {
  return prioritizedChannels.value.slice(2);
});

const remainingChannelsCount = computed(() => {
  return remainingChannels.value.length;
});

const remainingChannelsNames = computed(() => {
  return remainingChannels.value.map((channel) => channel.name).join(', ');
});

const shouldShowBanner = computed(() => {
  return offlineChannels.value.length > 0;
});

const getChannelStatus = (statusId: string | undefined | null) => {
  if (!statusId) return null;

  if (statusId === EWorkerStatus.disponible)
    return { color: EColor.warning, text: t('disponible') };
  if (statusId === EWorkerStatus.offline)
    return { color: EColor.error, text: t('offline') };
  if (statusId === EWorkerStatus.new)
    return { color: EColor.info, text: t('new') };
  if (statusId === EWorkerStatus.creating)
    return { color: EColor.warning, text: t('creating') };
  if (statusId === EWorkerStatus.error)
    return { color: EColor.error, text: t('error') };
  if (statusId === EWorkerStatus.mismatched)
    return { color: EColor.error, text: t('mismatched') };
  if (statusId === EWorkerStatus.stopped)
    return { color: EColor.warning, text: t('stopped') };

  return { color: EColor.primary, text: t('unknown') };
};

const handleClick = () => {
  router.push('/channels');
};

const loadChannelsIfNeeded = async () => {
  if (dashboardStore.offlineChannels.length === 0) {
    await dashboardStore.getDashboardOfflineChannels();
  }
};

const getStatusName = (statusId: string | undefined | null): string | null => {
  if (!statusId) return null;

  if (statusId === EWorkerStatus.offline) return t('offline');
  if (statusId === EWorkerStatus.disponible) return t('disponible');
  if (statusId === EWorkerStatus.error) return t('error');
  if (statusId === EWorkerStatus.mismatched) return t('mismatched');
  if (statusId === EWorkerStatus.stopped) return t('stopped');
  if (statusId === EWorkerStatus.creating) return t('creating');
  if (statusId === EWorkerStatus.new) return t('new');

  return null;
};

const user = getUser();

const workerStatusHandler = (data: IBaileysConnectionState) => {
  if (data.worker_status_id === EWorkerStatus.online) {
    dashboardStore.updateOfflineChannelStatus(data.worker_id, null, null);
    return;
  }

  const statusId = data.worker_status_id ?? null;
  const statusName = getStatusName(data.worker_status_id);

  dashboardStore.updateOfflineChannelStatus(
    data.worker_id,
    statusId,
    statusName
  );

  if (!dashboardStore.offlineChannels.find((ch) => ch.id === data.worker_id)) {
    dashboardStore.getDashboardOfflineChannels();
  }
};

onMounted(async () => {
  await loadChannelsIfNeeded();

  if (user?.account_id) {
    await onMessage(
      workerCentrifugoQueue(user.account_id),
      workerStatusHandler
    );
  }
});

onUnmounted(async () => {
  if (user?.account_id) {
    await unsubscribe(
      workerCentrifugoQueue(user.account_id),
      workerStatusHandler
    );
  }
});
</script>

<template>
  <div
    v-if="shouldShowBanner"
    class="channel-status-banner"
    @click="handleClick"
  >
    <div class="d-flex align-center gap-2">
      <template v-for="(channel, index) in displayedChannels" :key="channel.id">
        <div class="d-flex align-center gap-2">
          <span class="channel-name">{{ channel.name }}</span>
          <VChip
            v-if="getChannelStatus(channel.status?.id)"
            :color="getChannelStatus(channel.status?.id)?.color"
            size="small"
          >
            {{ getChannelStatus(channel.status?.id)?.text }}
          </VChip>
        </div>
        <VDivider
          v-if="
            index < displayedChannels.length - 1 || remainingChannelsCount > 0
          "
          vertical
          class="mx-1"
        />
      </template>
      <VTooltip
        v-if="remainingChannelsCount > 0"
        :text="remainingChannelsNames"
        location="top"
      >
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="remaining-count">
            +{{ remainingChannelsCount }}
          </span>
        </template>
      </VTooltip>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.channel-status-banner {
  cursor: pointer;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  .channel-name {
    font-weight: 500;
  }

  .remaining-count {
    font-weight: 500;
    color: rgb(var(--v-theme-primary));
    cursor: pointer;
  }
}
</style>
