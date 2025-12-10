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
import { ListSentNotificationsRequest } from '@core/schema/notifications/listSentNotifications/request.schema';
import { ListSentNotificationsFinalResponse } from '@core/schema/notifications/listSentNotifications/response.schema';

export const useNotificationsStore = defineStore('notifications', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    notifications: null as ListNotificationsResponse | null,
    sentNotificationsList: [] as ListSentNotificationsFinalResponse['results'],
    sentNotificationsPagings: {
      current_page: 1,
      total_pages: 0,
      per_page: 10,
      count: 0,
      total: 0,
    },
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

        const response =
          await axios.get<IApiResponse<ListNotificationsResponse>>(
            '/notifications'
          );

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
        >('/notifications', input);

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
          '/notifications/workers'
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
    async getSentNotifications(
      query: ListSentNotificationsRequest
    ): Promise<ListSentNotificationsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListSentNotificationsFinalResponse>
        >('/config/notifications/sent', {
          params: query,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.sentNotificationsList = [];
          this.sentNotificationsPagings = {
            current_page: 1,
            total_pages: 0,
            per_page: query.per_page ?? 10,
            count: 0,
            total: 0,
          };
          return null;
        }

        this.sentNotificationsList = data.data.results || [];
        this.sentNotificationsPagings = data.data.pagings || {
          current_page: 1,
          total_pages: 0,
          per_page: query.per_page ?? 10,
          count: 0,
          total: 0,
        };

        return data.data;
      } catch {
        this.loading = false;
        this.sentNotificationsList = [];
        this.sentNotificationsPagings = {
          current_page: 1,
          total_pages: 0,
          per_page: query.per_page ?? 10,
          count: 0,
          total: 0,
        };
        return null;
      }
    },
  },
});
