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
import { ListOfflineChannelsFinalResponse } from '@core/schema/dashboard/listOfflineChannels/response.schema';

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
    async getDashboardOfflineChannels(): Promise<ListOfflineChannelsFinalResponse | null> {
      try {
        this.loadingOfflineChannels = true;

        const response = await axios.get<
          IApiResponse<ListOfflineChannelsFinalResponse>
        >('/dashboard/offline-channels');

        if (response.data.status && response.data.data) {
          this.offlineChannels = response.data.data;
          return response.data.data;
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
      }
    },
    updateOfflineChannelStatus(
      channelId: string,
      statusId: string | null,
      statusName: string | null
    ) {
      const channel = this.offlineChannels.find((ch) => ch.id === channelId);
      if (channel) {
        channel.status =
          statusId && statusName ? { id: statusId, name: statusName } : null;
      }
    },
  },
});
