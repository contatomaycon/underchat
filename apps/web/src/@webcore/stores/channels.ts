import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { IListChannels } from '@webcore/interfaces/IListChannels';
import {
  ListWorkerFinalResponse,
  ListWorkerResponse,
} from '@core/schema/worker/listWorker/response.schema';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerConnectionLogsQuery } from '@core/schema/worker/workerConnectionLogs/request.schema';
import { WorkerConnectionLogsResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import { ProfileStatus } from '@core/schema/worker/listProfileStatus/response.schema';
import { WorkerProfileStatus } from '@core/schema/worker/uploadProfileStatus/response.schema';
import { WorkerProfileInfo } from '@core/schema/worker/uploadProfileInfo/response.schema';

export const useChannelsStore = defineStore('channels', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListWorkerResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
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
    async listChannels(
      input?: IListChannels
    ): Promise<ListWorkerFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListWorkerRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              number: input.search,
              server: input.search,
              account: input.search,
              status: input.status,
              type: input.type,
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListWorkerFinalResponse>>(
          `/worker`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async addChannel(payload: CreateWorkerRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/worker`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('channel_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('channel_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('channel_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateChannel(payload: EditWorkerRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/worker/${payload.worker_id}/${payload.name}`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('channel_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('channel_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('channel_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async getWorkerById(workerId: string): Promise<ViewWorkerResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewWorkerResponse>>(
          `/worker/${workerId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async deleteChannel(workerId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/worker/${workerId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_delete_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('worker_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateConnectionChannel(
      input: StatusConnectionWorkerRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          '/worker/whatsapp/unofficial',
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_status_update_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_status_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async channelLogsConnection(
      channelId: string,
      input: WorkerConnectionLogsQuery
    ): Promise<WorkerConnectionLogsResponse[]> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<WorkerConnectionLogsResponse[]>
        >(`/worker/logs/connection/${channelId}`, {
          params: input,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_logs_connection_error');

          this.showSnackbar(mensage, EColor.error);

          return [];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_logs_connection_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return [];
      }
    },

    async recreateChannel(workerId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/worker/${workerId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_recreation_failed');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('worker_recreate_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_recreation_failed');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async fetchWorkerProfileStatus(
      workerId: string
    ): Promise<ProfileStatus[] | null> {
      if (!workerId) return [];

      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ProfileStatus[]>>(
          `/worker/${workerId}/profile/status`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_load_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_load_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async uploadWorkerProfileStatus(
      workerId: string,
      workerProfileStatusTypeId: string,
      files?: File[],
      text?: string,
      caption?: string,
      isPermanent: string = 'false',
      visibilityData?: {
        visibility_type?: string;
        contact_group_ids?: string[];
        contact_ids?: string[];
      }
    ): Promise<WorkerProfileStatus[] | null> {
      if (!workerId || !workerProfileStatusTypeId) return null;

      try {
        this.loading = true;

        const formData = new FormData();
        formData.append(
          'worker_profile_status_type_id',
          workerProfileStatusTypeId
        );

        if (files && files.length > 0) {
          files.forEach((file) => {
            formData.append('photos', file);
          });
        }

        if (text) {
          formData.append('text', text);
        }

        if (caption) {
          formData.append('caption', caption);
        }

        formData.append('is_permanent', isPermanent);

        if (visibilityData) {
          if (visibilityData.visibility_type) {
            formData.append('visibility_type', visibilityData.visibility_type);
          }
          if (
            visibilityData.contact_group_ids &&
            visibilityData.contact_group_ids.length > 0
          ) {
            visibilityData.contact_group_ids.forEach((id) => {
              formData.append('contact_group_ids', id);
            });
          }
          if (
            visibilityData.contact_ids &&
            visibilityData.contact_ids.length > 0
          ) {
            visibilityData.contact_ids.forEach((id) => {
              formData.append('contact_ids', id);
            });
          }
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<IApiResponse<WorkerProfileStatus[]>>(
          `/worker/${workerId}/profile/status`,
          formData,
          config
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_upload_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_status_upload_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_upload_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchWorkerProfilePhotos(
      workerId: string
    ): Promise<ProfileStatus[] | null> {
      return this.fetchWorkerProfileStatus(workerId);
    },

    async uploadWorkerProfilePhotos(
      workerId: string,
      files: File[],
      isPermanent: boolean = false
    ): Promise<WorkerProfileStatus[] | null> {
      return this.uploadWorkerProfileStatus(
        workerId,
        '019a9d00-0002-7000-8000-000000000002',
        files,
        undefined,
        undefined,
        isPermanent.toString()
      );
    },

    async updateProfileStatusIsPermanent(
      workerProfileStatusId: string,
      isPermanent: boolean
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<null>>(
          `/worker/profile/status/${workerProfileStatusId}`,
          {
            is_permanent: isPermanent,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_update_error');
          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_status_update_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },

    async updateProfileStatusPhotoIsPermanent(
      workerProfileStatusId: string,
      isPermanent: boolean
    ): Promise<boolean> {
      return this.updateProfileStatusIsPermanent(
        workerProfileStatusId,
        isPermanent
      );
    },

    async uploadWorkerProfileInfo(
      workerId: string,
      name?: string | null,
      message?: string | null,
      photo?: File | null
    ): Promise<WorkerProfileInfo | null> {
      if (!workerId) return null;

      try {
        this.loading = true;

        const formData = new FormData();

        if (name !== undefined && name !== null) {
          formData.append('name', name);
        }

        if (message !== undefined && message !== null) {
          formData.append('message', message);
        }

        if (photo instanceof File) {
          formData.append('photo', photo);
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<IApiResponse<WorkerProfileInfo>>(
          `/worker/${workerId}/profile/info`,
          formData,
          config
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_info_upload_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_info_upload_success') ||
            'Informações do perfil salvas com sucesso',
          EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage =
          this.i18n.global.t('profile_info_upload_error') ||
          'Erro ao salvar informações do perfil';

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async fetchWorkerProfileInfo(
      workerId: string
    ): Promise<WorkerProfileInfo | null> {
      if (!workerId) return null;

      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<WorkerProfileInfo>>(
          `/worker/${workerId}/profile/info`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;

        return null;
      }
    },

    async deleteProfileStatus(workerProfileStatusId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/worker/profile/status/${workerProfileStatusId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_delete_error');
          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_status_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_delete_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },

    updateStatusChannel(input: IBaileysConnectionState): void {
      const index = this.list.findIndex(
        (c) => c.account?.id === input.account_id && c.id === input.worker_id
      );

      if (index === -1) return;

      if (input.worker_status_id === EWorkerStatus.delete) {
        this.list.splice(index, 1);

        return;
      }

      const channel = this.list[index];
      if (channel?.status && input?.worker_status_id) {
        channel.status.id = input.worker_status_id;
      }
    },
  },
});
