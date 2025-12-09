import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { UpdateNotificationsResponse } from '@core/schema/notifications/updateNotifications/response.schema';
import { ListWorkersResponse } from '@core/schema/notifications/listWorkers/response.schema';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { UpdateNfseResponse } from '@core/schema/config/updateNfse/response.schema';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsFinalResponse } from '@core/schema/config/listChannels/response.schema';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    notifications: null as ListNotificationsResponse | null,
    nfse: null as ListNfseResponse | null,
    channels: null as ListChannelsFinalResponse | null,
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
    async getNotifications(): Promise<ListNotificationsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListNotificationsResponse>
        >('/config/notifications');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.notifications = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async updateNotifications(
      input: UpdateNotificationsRequest
    ): Promise<UpdateNotificationsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<
          IApiResponse<UpdateNotificationsResponse>
        >('/config/notifications', input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('notifications_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('notifications_update_success'),
          EColor.success
        );

        this.notifications = {
          notification_id: data.data.notification_id,
          two_factor_notification: data.data.two_factor_notification,
          plan_notification: data.data.plan_notification,
          plan_expiration_reminder: data.data.plan_expiration_reminder,
          created_at: data.data.created_at,
          updated_at: data.data.updated_at,
        };

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('notifications_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async getWorkers(): Promise<ListWorkersResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ListWorkersResponse>>(
          '/config/notifications/workers'
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async getNfse(): Promise<ListNfseResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListNfseResponse>>('/config/nfse');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.nfse = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async updateNfse(
      input: UpdateNfseRequest
    ): Promise<UpdateNfseResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<UpdateNfseResponse>>(
          '/config/nfse',
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('nfse_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('nfse_updated_successfully'),
          EColor.success
        );

        this.nfse = data.data;

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('nfse_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async getChannels(
      query: ListChannelsRequest
    ): Promise<ListChannelsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListChannelsFinalResponse>
        >('/config/channels', {
          params: query,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.channels = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async getAccounts(): Promise<IAccountBasic[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<IAccountBasic[]>>('/config/accounts');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },

    async recreateChannel(channelId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<null>>(
          `/config/channels/${channelId}/recreate`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('channel_recreate_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('channel_recreate_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('channel_recreate_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async deleteChannel(channelId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/config/channels/${channelId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('channel_delete_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('channel_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('channel_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },
  },
});
