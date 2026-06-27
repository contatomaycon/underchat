import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { GetDashboardStatsResponse } from '@core/schema/dashboard/getDashboardStats/response.schema';
import { GetDashboardConversationsResponse } from '@core/schema/dashboard/getDashboardConversations/response.schema';
import { GetDashboardAdditionalResponse } from '@core/schema/dashboard/getDashboardAdditional/response.schema';
import {
  ListOfflineChannelsFinalResponse,
  ListOfflineChannelsResponse,
} from '@core/schema/dashboard/listOfflineChannels/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

const DASHBOARD_OFFLINE_CHANNELS_CACHE_TTL_MS = 3000;

let dashboardOfflineChannelsRequestInFlight: Promise<ListOfflineChannelsFinalResponse | null> | null =
  null;
let dashboardOfflineChannelsLastFetchedAt = 0;
let dashboardOfflineChannelsHasFetched = false;

interface ApplyOfflineChannelStatusEventInput {
  channelId: string;
  channelName?: string | null;
  statusId?: string | null;
  statusName?: string | null;
}

const shouldRemoveFromOfflineChannels = (
  statusId: string | null | undefined
): boolean => {
  return (
    !statusId ||
    statusId === EWorkerStatus.online ||
    statusId === EWorkerStatus.delete ||
    statusId === EWorkerStatus.deleting
  );
};

const normalizeOfflineChannels = (
  channels: ListOfflineChannelsFinalResponse
): ListOfflineChannelsFinalResponse => {
  const byId = new Map<string, ListOfflineChannelsResponse>();

  for (const channel of channels) {
    byId.set(channel.id, channel);
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loadingStats: false,
    loadingConversations: false,
    loadingAdditional: false,
    loadingOfflineChannels: false,
    stats: null as GetDashboardStatsResponse | null,
    conversations: null as GetDashboardConversationsResponse | null,
    additional: null as GetDashboardAdditionalResponse | null,
    offlineChannels: [] as ListOfflineChannelsFinalResponse,
  }),
  actions: {
    showSnackbar(message: string, color: EColor) {
      this.snackbar.message = message;
      this.snackbar.color = color;
      this.snackbar.status = true;
    },
    hideSnackbar() {
      this.snackbar.status = false;
    },
    async getDashboardStats(): Promise<GetDashboardStatsResponse | null> {
      try {
        this.loadingStats = true;

        const response =
          await axios.get<IApiResponse<GetDashboardStatsResponse>>(
            '/dashboard/stats'
          );

        if (response.data.status && response.data.data) {
          this.stats = response.data.data;
          return response.data.data;
        }

        return null;
      } catch (error) {
        if (error instanceof AxiosError) {
          const message =
            error.response?.data?.message ||
            this.i18n.global.t('dashboard_stats_error');
          this.showSnackbar(message, EColor.error);
        }

        return null;
      } finally {
        this.loadingStats = false;
      }
    },
    async getDashboardConversations(): Promise<GetDashboardConversationsResponse | null> {
      try {
        this.loadingConversations = true;

        const response = await axios.get<
          IApiResponse<GetDashboardConversationsResponse>
        >('/dashboard/conversations');

        if (response.data.status && response.data.data) {
          this.conversations = response.data.data;
          return response.data.data;
        }

        return null;
      } catch (error) {
        if (error instanceof AxiosError) {
          const message =
            error.response?.data?.message ||
            this.i18n.global.t('dashboard_conversations_error');
          this.showSnackbar(message, EColor.error);
        }

        return null;
      } finally {
        this.loadingConversations = false;
      }
    },
    async getDashboardAdditional(): Promise<GetDashboardAdditionalResponse | null> {
      try {
        this.loadingAdditional = true;

        const response = await axios.get<
          IApiResponse<GetDashboardAdditionalResponse>
        >('/dashboard/additional');

        if (response.data.status && response.data.data) {
          this.additional = response.data.data;
          return response.data.data;
        }

        return null;
      } catch (error) {
        if (error instanceof AxiosError) {
          const message =
            error.response?.data?.message ||
            this.i18n.global.t('dashboard_additional_error');
          this.showSnackbar(message, EColor.error);
        }

        return null;
      } finally {
        this.loadingAdditional = false;
      }
    },
    async getDashboardOfflineChannels(
      force = false
    ): Promise<ListOfflineChannelsFinalResponse | null> {
      if (
        !force &&
        dashboardOfflineChannelsHasFetched &&
        Date.now() - dashboardOfflineChannelsLastFetchedAt <
          DASHBOARD_OFFLINE_CHANNELS_CACHE_TTL_MS
      ) {
        return this.offlineChannels;
      }

      if (dashboardOfflineChannelsRequestInFlight) {
        return dashboardOfflineChannelsRequestInFlight;
      }

      dashboardOfflineChannelsRequestInFlight = (async () => {
        try {
          this.loadingOfflineChannels = true;

          const response = await axios.get<
            IApiResponse<ListOfflineChannelsFinalResponse>
          >('/dashboard/offline-channels');

          if (response.data.status && response.data.data) {
            this.offlineChannels = normalizeOfflineChannels(response.data.data);
            dashboardOfflineChannelsHasFetched = true;
            dashboardOfflineChannelsLastFetchedAt = Date.now();
            return this.offlineChannels;
          }

          return null;
        } catch (error) {
          if (error instanceof AxiosError) {
            const message =
              error.response?.data?.message ||
              this.i18n.global.t('dashboard_offline_channels_error');
            this.showSnackbar(message, EColor.error);
          }

          return null;
        } finally {
          this.loadingOfflineChannels = false;
          dashboardOfflineChannelsRequestInFlight = null;
        }
      })();

      return dashboardOfflineChannelsRequestInFlight;
    },
    applyOfflineChannelStatusEvent(input: ApplyOfflineChannelStatusEventInput) {
      if (shouldRemoveFromOfflineChannels(input.statusId)) {
        this.removeOfflineChannel(input.channelId);
        return;
      }

      const existing = this.offlineChannels.find(
        (ch) => ch.id === input.channelId
      );
      const channelName = input.channelName?.trim() || existing?.name;

      if (!channelName) {
        return;
      }

      const nextChannel: ListOfflineChannelsResponse = {
        id: input.channelId,
        name: channelName,
        status: input.statusId
          ? { id: input.statusId, name: input.statusName ?? null }
          : null,
      };

      this.offlineChannels = normalizeOfflineChannels([
        ...this.offlineChannels.filter((ch) => ch.id !== input.channelId),
        nextChannel,
      ]);
    },
    updateOfflineChannelStatus(
      channelId: string,
      statusId: string | null,
      statusName: string | null,
      channelName?: string | null
    ) {
      this.applyOfflineChannelStatusEvent({
        channelId,
        channelName,
        statusId,
        statusName,
      });
    },
    removeOfflineChannel(channelId: string) {
      this.offlineChannels = this.offlineChannels.filter(
        (ch) => ch.id !== channelId
      );
    },
  },
});
