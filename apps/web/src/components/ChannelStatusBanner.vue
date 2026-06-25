<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { isAxiosError } from 'axios';
import { useChatStore } from '@/@webcore/stores/chat';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EColor } from '@core/common/enums/EColor';
import { useI18n } from 'vue-i18n';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { getUser, getChannels } from '@/@webcore/localStorage/user';
import { logLocalConnectionStatus } from '@/@webcore/utils/localConnectionStatusLog';

const POLLING_INTERVAL_MS = 60_000;

const { t } = useI18n();
const router = useRouter();
const chatStore = useChatStore();
const dashboardStore = useDashboardStore();

const userChannelIds = ref<Set<string>>(
  new Set(getChannels().map((ch) => ch.id))
);

const refreshUserChannels = () => {
  userChannelIds.value = new Set(getChannels().map((ch) => ch.id));
};

const offlineChannels = computed(() => {
  if (userChannelIds.value.size === 0) return dashboardStore.offlineChannels;
  return dashboardStore.offlineChannels.filter((ch) =>
    userChannelIds.value.has(ch.id)
  );
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
  logLocalConnectionStatus('web.status_banner.worker_status.received', {
    layer: 'web.status_banner',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    worker_status_id: data.worker_status_id,
    status: data.status,
    code: data.code,
    session_ready: data.session_ready,
    can_send: data.can_send,
    can_receive_runtime: data.can_receive_runtime,
    authenticated: data.authenticated,
    provider_state: data.provider_state,
    degraded_reason: data.degraded_reason,
    phone: data.phone,
    connection_attempt_id: data.connection_attempt_id,
    runtime_generation: data.runtime_generation,
  });
  if (
    userChannelIds.value.size > 0 &&
    !userChannelIds.value.has(data.worker_id)
  ) {
    logLocalConnectionStatus('web.status_banner.worker_status.ignored', {
      layer: 'web.status_banner',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      reason: 'worker_not_in_user_channel_ids',
    });
    return;
  }

  if (
    data.worker_status_id === EWorkerStatus.online &&
    data.session_ready === true
  ) {
    logLocalConnectionStatus('web.status_banner.worker_status.online_removed', {
      layer: 'web.status_banner',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      session_ready: data.session_ready,
      phone: data.phone,
    });
    dashboardStore.updateOfflineChannelStatus(data.worker_id, null, null);
    return;
  }

  if (data.worker_status_id === EWorkerStatus.online) {
    logLocalConnectionStatus(
      'web.status_banner.worker_status.weak_online_ignored',
      {
        layer: 'web.status_banner',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        worker_status_id: data.worker_status_id,
        status: data.status,
        code: data.code,
        session_ready: data.session_ready,
        phone: data.phone,
      }
    );
    return;
  }

  const statusId = data.worker_status_id ?? null;
  const statusName = getStatusName(data.worker_status_id);

  dashboardStore.updateOfflineChannelStatus(
    data.worker_id,
    statusId,
    statusName
  );
  logLocalConnectionStatus('web.status_banner.worker_status.offline_applied', {
    layer: 'web.status_banner',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    worker_status_id: data.worker_status_id,
    status: data.status,
    code: data.code,
    session_ready: data.session_ready,
    status_name: statusName,
  });

  if (!dashboardStore.offlineChannels.find((ch) => ch.id === data.worker_id)) {
    void dashboardStore.getDashboardOfflineChannels(true).catch(() => {});
  }
};

let pollingTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  try {
    await loadChannelsIfNeeded();
  } catch (error) {
    if (!isAxiosError(error) || error.response?.status !== 401) {
      if (import.meta.env.DEV) {
        console.error(
          'Failed to load offline channels for status banner',
          error
        );
      }
    }
  }

  if (user?.account_id) {
    try {
      await onMessage(
        workerCentrifugoQueue(user.account_id),
        workerStatusHandler
      );
    } catch (error) {
      if (!isAxiosError(error) || error.response?.status !== 401) {
        if (import.meta.env.DEV) {
          console.error(
            'Failed to subscribe ChannelStatusBanner to worker status channel',
            error
          );
        }
      }
    }
  }

  pollingTimer = setInterval(() => {
    refreshUserChannels();
    void dashboardStore.getDashboardOfflineChannels().catch(() => {});
  }, POLLING_INTERVAL_MS);
});

onUnmounted(async () => {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }

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
