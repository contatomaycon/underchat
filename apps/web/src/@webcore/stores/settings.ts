import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { ListNotificationsResponse } from '@core/schema/notifications/listNotifications/response.schema';
import { UpdateNotificationsRequest } from '@core/schema/notifications/updateNotifications/request.schema';
import { UpdateNotificationsResponse } from '@core/schema/notifications/updateNotifications/response.schema';
import { ListWorkersResponse } from '@core/schema/notifications/listWorkers/response.schema';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { UpdateNfseResponse } from '@core/schema/config/updateNfse/response.schema';
import { UpdateNfseIntegrationRequest } from '@core/schema/config/updateNfseIntegration/request.schema';
import { UpdateNfseIntegrationResponse } from '@core/schema/config/updateNfseIntegration/response.schema';
import { UploadNfseCertificateResponse } from '@core/schema/config/uploadNfseCertificate/response.schema';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ListChannelsFinalResponse } from '@core/schema/config/listChannels/response.schema';
import { ListS3BackupUploadsRequest } from '@core/schema/config/listS3BackupUploads/request.schema';
import { ListS3BackupUploadsFinalResponse } from '@core/schema/config/listS3BackupUploads/response.schema';
import { ListChannelServersResponse } from '@core/schema/config/listChannelServers/response.schema';
import { UpdateChannelRequest } from '@core/schema/config/updateChannel/request.schema';
import { ChannelsStatisticsResponse } from '@core/schema/config/channelsStatistics/response.schema';
import { RecreateChannelsAllRequest } from '@core/schema/config/recreateChannelsAll/request.schema';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { UpdateCreditCardFeeRequest } from '@core/schema/config/updateCreditCardFee/request.schema';
import { UpdateCreditCardFeeResponse } from '@core/schema/config/updateCreditCardFee/response.schema';
import { ListMethodPaymentsResponse } from '@core/schema/config/listMethodPayments/response.schema';
import { UpdateMethodPaymentRequest } from '@core/schema/config/updateMethodPayment/request.schema';
import { UpdateMethodPaymentResponse } from '@core/schema/config/updateMethodPayment/response.schema';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import {
  connectionLifecycleDebugHeaders,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
  logConnectionLifecycleDebug,
} from '@webcore/utils/connectionLifecycleDebug';

const buildConnectionLifecycleDebugConfig = (
  debugTraceId: string | undefined,
  config: AxiosRequestConfig = {}
): AxiosRequestConfig => {
  const headers = connectionLifecycleDebugHeaders(debugTraceId);
  if (!headers) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...((config.headers ?? {}) as Record<string, string>),
      ...headers,
    },
  };
};

const createWebTraceId = (prefix: string): string | undefined =>
  isConnectionLifecycleDebugEnabled()
    ? createConnectionLifecycleDebugTraceId(prefix)
    : undefined;

const isWorkerLifecycleAck = (value: unknown): value is IWorkerLifecycleAck =>
  typeof value === 'object' &&
  value !== null &&
  (value as { queued?: unknown }).queued === true;

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
    s3BackupUploads: null as ListS3BackupUploadsFinalResponse | null,
    creditCardFee: null as ListCreditCardFeeResponse | null,
    methodPayments: null as ListMethodPaymentsResponse | null,
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
          plan_new_notification: data.data.plan_new_notification,
          plan_renewal_notification: data.data.plan_renewal_notification,
          plan_expiration_reminder: data.data.plan_expiration_reminder,
          plan_cancellation_notification:
            data.data.plan_cancellation_notification,
          recurring_payment_failure_notification:
            data.data.recurring_payment_failure_notification,
          test_plan_new_notification: data.data.test_plan_new_notification,
          test_plan_expiration_reminder:
            data.data.test_plan_expiration_reminder,
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
    async updateNfseIntegration(
      input: UpdateNfseIntegrationRequest
    ): Promise<UpdateNfseIntegrationResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<
          IApiResponse<UpdateNfseIntegrationResponse>
        >('/config/nfse/integration', input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('nfse_integration_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('nfse_integration_updated_successfully'),
          EColor.success
        );

        this.nfse = data.data;

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('nfse_integration_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async uploadNfseCertificate(
      certificate: File,
      certificatePassword: string
    ): Promise<UploadNfseCertificateResponse | null> {
      try {
        this.loading = true;

        const formData = new FormData();
        formData.append('certificate', certificate);
        formData.append('certificate_password', certificatePassword);

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<
          IApiResponse<UploadNfseCertificateResponse>
        >('/config/nfse/certificate', formData, config);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('nfse_certificate_upload_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('nfse_certificate_uploaded_successfully'),
          EColor.success
        );

        this.nfse = data.data;

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('nfse_certificate_upload_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async getCreditCardFee(): Promise<ListCreditCardFeeResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListCreditCardFeeResponse>
        >('/config/credit-card-fee');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.creditCardFee = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async updateCreditCardFee(
      input: UpdateCreditCardFeeRequest
    ): Promise<UpdateCreditCardFeeResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<
          IApiResponse<UpdateCreditCardFeeResponse>
        >('/config/credit-card-fee', input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('credit_card_fee_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('credit_card_fee_updated_successfully'),
          EColor.success
        );

        this.creditCardFee = data.data;

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('credit_card_fee_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async getMethodPayments(): Promise<ListMethodPaymentsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListMethodPaymentsResponse>
        >('/config/method-payments');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.methodPayments = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async updateMethodPayment(
      input: UpdateMethodPaymentRequest
    ): Promise<UpdateMethodPaymentResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<
          IApiResponse<UpdateMethodPaymentResponse>
        >('/config/method-payment', input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('method_payment_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('method_payment_updated_successfully'),
          EColor.success
        );

        if (this.methodPayments) {
          const index = this.methodPayments.findIndex(
            (mp) => mp.method_payment_id === data.data.method_payment_id
          );
          if (index !== -1) {
            this.methodPayments[index] = data.data;
          }
        }

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('method_payment_update_error');
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
    async getS3BackupUploads(
      query: ListS3BackupUploadsRequest
    ): Promise<ListS3BackupUploadsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListS3BackupUploadsFinalResponse>
        >('/config/s3-backups', {
          params: query,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.s3BackupUploads = null;
          return null;
        }

        this.s3BackupUploads = data.data;

        return data.data;
      } catch {
        this.loading = false;
        this.s3BackupUploads = null;
        return null;
      }
    },
    async reprocessS3BackupUpload(s3BackupUploadId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<null>>(
          `/config/s3-backups/${s3BackupUploadId}/reprocess`
        );

        this.loading = false;

        const data = response?.data;
        const isAccepted = response?.status === 202;

        if (isAccepted && data?.status && data?.message) {
          this.showSnackbar(data.message, EColor.info);
          return true;
        }

        if (!data?.status) {
          this.showSnackbar(
            data?.message ??
              this.i18n.global.t('s3_backup_upload_reprocess_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('s3_backup_upload_reprocess_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t(
          's3_backup_upload_reprocess_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
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
    async getChannelServers(): Promise<
      ListChannelServersResponse['results'] | null
    > {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListChannelServersResponse>
        >('/config/channels/servers');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.results;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async updateChannel(input: UpdateChannelRequest): Promise<boolean> {
      const debugTraceId = createWebTraceId('web_config_channel_edit');
      try {
        this.loading = true;
        logConnectionLifecycleDebug('web.config_channel_edit.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: input.channel_id,
          worker_type_id: input.worker_type,
          has_server_id: Boolean(input.server_id),
        });

        const response = await axios.patch<
          IApiResponse<null | IWorkerLifecycleAck>
        >(
          `/config/channels/${input.channel_id}`,
          {
            name: input.name,
            worker_type: input.worker_type,
            server_id: input.server_id,
          },
          buildConnectionLifecycleDebugConfig(debugTraceId)
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('channel_edit_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('channel_edit_success'),
          EColor.success
        );
        logConnectionLifecycleDebug('web.config_channel_edit.response', {
          trace_id: isWorkerLifecycleAck(data.data)
            ? (data.data.debug_trace_id ?? debugTraceId)
            : debugTraceId,
          layer: 'web',
          worker_id: input.channel_id,
          account_id: isWorkerLifecycleAck(data.data)
            ? data.data.account_id
            : undefined,
          worker_type_id: isWorkerLifecycleAck(data.data)
            ? data.data.worker_type_id
            : input.worker_type,
          lifecycle_operation_id: isWorkerLifecycleAck(data.data)
            ? data.data.operation_id
            : undefined,
          status: isWorkerLifecycleAck(data.data)
            ? data.data.status
            : 'updated',
          reason: isWorkerLifecycleAck(data.data)
            ? data.data.reason
            : 'no_recreate_required',
        });

        return true;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('channel_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        logConnectionLifecycleDebug('web.config_channel_edit.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: input.channel_id,
          worker_type_id: input.worker_type,
          reason: errorMessage,
        });

        return false;
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

    async checkChannelOpenConversations(
      channelId: string
    ): Promise<number | null> {
      try {
        const response = await axios.get<IApiResponse<{ count: number }>>(
          `/config/channels/${channelId}/open-conversations`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.count;
      } catch {
        return null;
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
    async recreateChannelsAll(filters?: RecreateChannelsAllRequest): Promise<{
      enqueued: boolean;
      success?: number;
      errors?: number;
    } | null> {
      try {
        this.loading = true;

        const response = await axios.patch<
          IApiResponse<{ success?: number; errors?: number }>
        >('/config/channels/recreate-all', {
          status: filters?.status ?? undefined,
          type: filters?.type ?? undefined,
          account: filters?.account ?? undefined,
          name: filters?.name ?? undefined,
          number: filters?.number ?? undefined,
        });

        this.loading = false;

        const data = response?.data;
        const isAccepted = response?.status === 202;

        if (isAccepted && data?.status && data?.message) {
          this.showSnackbar(data.message, EColor.info);
          return { enqueued: true };
        }

        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('channels_recreate_all_error'),
            EColor.error
          );

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('channels_recreate_all_success', {
            success: data.data.success,
            errors: data.data.errors,
          }),
          EColor.success
        );

        return {
          enqueued: false,
          success: data.data.success,
          errors: data.data.errors,
        };
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('channels_recreate_all_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async getChannelsStatistics(): Promise<ChannelsStatisticsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ChannelsStatisticsResponse>
        >('/config/channels/statistics');

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
  },
});
