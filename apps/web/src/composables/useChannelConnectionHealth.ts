import {
  readonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import type { WorkerConnectionLogsQuery } from '@core/schema/worker/workerConnectionLogs/request.schema';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useSettingsStore } from '@/@webcore/stores/settings';

export type ConnectionHealthPeriodHours = 24 | 72 | 168;
export type ChannelConnectionHealthScope = 'worker' | 'config';

interface UseChannelConnectionHealthOptions {
  scope?: MaybeRefOrGetter<ChannelConnectionHealthScope>;
}

const LOG_PAGE_SIZE = 80;

export function useChannelConnectionHealth(
  channelId: MaybeRefOrGetter<string | null>,
  options: UseChannelConnectionHealthOptions = {}
) {
  const channelsStore = useChannelsStore();
  const settingsStore = useSettingsStore();
  const health = shallowRef<WorkerConnectionHealthResponse | null>(null);
  const periodHours = shallowRef<ConnectionHealthPeriodHours>(24);
  const isLoading = shallowRef(false);
  const isLoadingMore = shallowRef(false);
  const hasError = shallowRef(false);
  let requestSequence = 0;

  const requestScope = (): ChannelConnectionHealthScope =>
    toValue(options.scope ?? 'worker');

  const loadHealth = (
    channelId: string,
    query: WorkerConnectionLogsQuery
  ): Promise<WorkerConnectionHealthResponse | null> =>
    requestScope() === 'config'
      ? settingsStore.channelConnectionHealth(channelId, query)
      : channelsStore.channelLogsConnection(channelId, query);

  const refresh = async (): Promise<void> => {
    const id = toValue(channelId);
    const requestId = ++requestSequence;

    if (!id) {
      health.value = null;
      return;
    }

    isLoading.value = true;
    hasError.value = false;

    try {
      const response = await loadHealth(id, {
        from: 0,
        size: LOG_PAGE_SIZE,
        period_hours: periodHours.value,
      });

      if (requestId !== requestSequence) return;

      health.value = response;
      hasError.value = response === null;
    } finally {
      if (requestId === requestSequence) {
        isLoading.value = false;
      }
    }
  };

  const loadMoreLogs = async (): Promise<void> => {
    const id = toValue(channelId);
    const current = health.value;

    if (!id || !current?.logs_has_more || isLoadingMore.value) return;

    isLoadingMore.value = true;
    try {
      const response = await loadHealth(id, {
        from: current.logs.length,
        size: LOG_PAGE_SIZE,
        period_hours: periodHours.value,
      });

      if (!response || health.value !== current) return;

      health.value = {
        ...response,
        logs: [...current.logs, ...response.logs],
      };
    } finally {
      isLoadingMore.value = false;
    }
  };

  watch(
    [() => toValue(channelId), periodHours, requestScope],
    () => {
      void refresh();
    },
    { immediate: true }
  );

  return {
    health: readonly(health),
    periodHours,
    isLoading: readonly(isLoading),
    isLoadingMore: readonly(isLoadingMore),
    hasError: readonly(hasError),
    refresh,
    loadMoreLogs,
  };
}
