<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
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
const channelsStore = useChannelsStore();

const offlineChannels = computed(() => {
  return channelsStore.list.filter(
    (channel) =>
      channel.status?.id &&
      channel.status.id !== EWorkerStatus.online
  );
});

const currentChannel = computed(() => {
  const activeWorkerId = chatStore.activeChat?.worker?.id;

  if (activeWorkerId) {
    const activeChannel = offlineChannels.value.find(
      (channel) => channel.id === activeWorkerId
    );
    if (activeChannel) return activeChannel;
  }

  if (offlineChannels.value.length > 0) {
    return offlineChannels.value[0];
  }

  return null;
});

const shouldShowBanner = computed(() => {
  return !!currentChannel.value;
});

const channelStatus = computed(() => {
  if (!currentChannel.value?.status?.id) return null;

  const statusId = currentChannel.value.status.id;

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
});

const handleClick = () => {
  router.push('/channels');
};

const loadChannelsIfNeeded = async () => {
  if (channelsStore.list.length === 0) {
    await channelsStore.listChannels({
      page: 1,
      per_page: 100,
      sort_by: [],
    });
  }
};

const user = getUser();

const workerStatusHandler = (data: IBaileysConnectionState) => {
  channelsStore.updateStatusChannel(data);
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
    await unsubscribe(workerCentrifugoQueue(user.account_id), workerStatusHandler);
  }
});
</script>

<template>
  <div
    v-if="shouldShowBanner && currentChannel && channelStatus"
    class="channel-status-banner"
    @click="handleClick"
  >
    <div class="d-flex align-center gap-2">
      <span class="channel-name">{{ currentChannel.name }}</span>
      <VChip :color="channelStatus.color" size="small">
        {{ channelStatus.text }}
      </VChip>
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
}
</style>