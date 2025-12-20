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
import { WorkerConfig } from '@core/schema/worker/updateWorkerConfig/response.schema';
import { ViewWorkerConfigResponse } from '@core/schema/worker/viewWorkerConfig/response.schema';
import { UpdateWorkerConfigRequest } from '@core/schema/worker/updateWorkerConfig/request.schema';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';

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
    workerConfigCache: {} as Record<string, ViewWorkerConfigResponse | null>,
    workerConfigForChatCache: {} as Record<
      string,
      ViewWorkerConfigForChatResponse | null
    >,
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

    buildProfileStatusFormData(
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
    ): FormData {
      const formData = new FormData();
      formData.append(
        'worker_profile_status_type_id',
        workerProfileStatusTypeId
      );

      if (files?.length) {
        for (const file of files) {
          formData.append('photos', file);
        }
      }

      if (text) {
        formData.append('text', text);
      }

      if (caption) {
        formData.append('caption', caption);
      }

      formData.append('is_permanent', isPermanent);

      if (!visibilityData) {
        return formData;
      }

      if (visibilityData.visibility_type) {
        formData.append('visibility_type', visibilityData.visibility_type);
      }

      if (visibilityData.contact_group_ids?.length) {
        formData.append(
          'contact_group_ids',
          JSON.stringify(visibilityData.contact_group_ids)
        );
      }

      if (visibilityData.contact_ids?.length) {
        formData.append(
          'contact_ids',
          JSON.stringify(visibilityData.contact_ids)
        );
      }

      return formData;
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

        const formData = this.buildProfileStatusFormData(
          workerProfileStatusTypeId,
          files,
          text,
          caption,
          isPermanent,
          visibilityData
        );

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
      photo?: File | null,
      removePhoto?: boolean
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

        if (removePhoto) {
          formData.append('remove_photo', 'true');
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

    async fetchWorkerConfig(
      workerId: string,
      forceRefresh = false
    ): Promise<ViewWorkerConfigResponse | null> {
      if (!workerId) return null;

      if (!forceRefresh && this.workerConfigCache[workerId] !== undefined) {
        return this.workerConfigCache[workerId];
      }

      try {
        const response = await axios.get<
          IApiResponse<ViewWorkerConfigResponse>
        >(`/worker/${workerId}/config`);

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t('channel_general_config_load_error');
          this.showSnackbar(message, EColor.error);

          this.workerConfigCache[workerId] = null;
          return null;
        }

        this.workerConfigCache[workerId] = data.data ?? null;
        return this.workerConfigCache[workerId];
      } catch (error) {
        let message = this.i18n.global.t('channel_general_config_load_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        this.workerConfigCache[workerId] = null;
        return null;
      }
    },

    async fetchWorkerConfigForChat(
      workerId: string
    ): Promise<ViewWorkerConfigForChatResponse | null> {
      if (!workerId) return null;

      if (this.workerConfigForChatCache[workerId] !== undefined) {
        return this.workerConfigForChatCache[workerId];
      }

      try {
        const response = await axios.get<
          IApiResponse<ViewWorkerConfigForChatResponse>
        >(`/chat/worker/${workerId}/config`);

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t('channel_general_config_load_error');
          this.showSnackbar(message, EColor.error);

          this.workerConfigForChatCache[workerId] = null;
          return null;
        }

        this.workerConfigForChatCache[workerId] = data.data ?? null;
        return this.workerConfigForChatCache[workerId];
      } catch (error) {
        let message = this.i18n.global.t('channel_general_config_load_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        this.workerConfigForChatCache[workerId] = null;
        return null;
      }
    },

    async updateWorkerConfig(
      workerId: string,
      body: UpdateWorkerConfigRequest
    ): Promise<WorkerConfig | null> {
      if (!workerId) return null;

      try {
        const response = await axios.post<IApiResponse<WorkerConfig>>(
          `/worker/${workerId}/config`,
          body
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('channel_general_config_save_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('channel_general_config_save_success'),
          EColor.success
        );

        this.workerConfigCache[workerId] = data.data ?? null;
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('channel_general_config_save_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchTransferProtocolText(workerId: string): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{ generate_protocol_at_transfer: string | null }>
        >(`/worker/${workerId}/config/transfer-protocol`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.generate_protocol_at_transfer;
      } catch {
        return null;
      }
    },

    async updateTransferProtocolText(
      workerId: string,
      text: string | null
    ): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<{ generate_protocol_at_transfer: string | null }>
        >(`/worker/${workerId}/config/transfer-protocol`, {
          text: text || null,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('transfer_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('transfer_protocol_text_update_success'),
          EColor.success
        );

        return data.data.generate_protocol_at_transfer;
      } catch (error) {
        let message = this.i18n.global.t('transfer_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchStartProtocolText(workerId: string): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{ generate_protocol_at_start: string | null }>
        >(`/worker/${workerId}/config/start-protocol`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.generate_protocol_at_start;
      } catch {
        return null;
      }
    },

    async updateStartProtocolText(
      workerId: string,
      text: string | null
    ): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<{ generate_protocol_at_start: string | null }>
        >(`/worker/${workerId}/config/start-protocol`, {
          text: text || null,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('start_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('start_protocol_text_update_success'),
          EColor.success
        );

        return data.data.generate_protocol_at_start;
      } catch (error) {
        let message = this.i18n.global.t('start_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchChatbot(workerId: string): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{ chatbot_id: string | null }>
        >(`/worker/${workerId}/config/chatbot`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.chatbot_id;
      } catch {
        return null;
      }
    },

    async updateChatbot(
      workerId: string,
      chatbotId: string | null
    ): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<{ chatbot_id: string | null }>
        >(`/worker/${workerId}/config/chatbot`, {
          chatbot_id: chatbotId || null,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('chatbot_update_success'),
          EColor.success
        );

        return data.data.chatbot_id;
      } catch (error) {
        let message = this.i18n.global.t('chatbot_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

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

    async fetchSimultaneousAttendance(
      workerId: string
    ): Promise<number | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{ simultaneous_attendance: number | null }>
        >(`/worker/${workerId}/config/simultaneous-attendance`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.simultaneous_attendance;
      } catch {
        return null;
      }
    },

    async updateSimultaneousAttendance(
      workerId: string,
      quantity: number | null
    ): Promise<number | null> {
      if (!workerId) return null;

      try {
        const body: { quantity?: number } = {};
        if (quantity !== null) {
          body.quantity = quantity;
        }

        const response = await axios.patch<
          IApiResponse<{ simultaneous_attendance: number | null }>
        >(`/worker/${workerId}/config/simultaneous-attendance`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('simultaneous_attendance_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('simultaneous_attendance_update_success'),
          EColor.success
        );

        return data.data.simultaneous_attendance;
      } catch (error) {
        let message = this.i18n.global.t(
          'simultaneous_attendance_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchShowMessageOnCall(workerId: string): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{ show_message_on_call: string | null }>
        >(`/worker/${workerId}/config/show-message-on-call`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.show_message_on_call;
      } catch {
        return null;
      }
    },

    async updateShowMessageOnCall(
      workerId: string,
      text: string | null
    ): Promise<string | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<{ show_message_on_call: string | null }>
        >(`/worker/${workerId}/config/show-message-on-call`, {
          text: text || null,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('show_message_on_call_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('show_message_on_call_update_success'),
          EColor.success
        );

        return data.data.show_message_on_call;
      } catch (error) {
        let message = this.i18n.global.t('show_message_on_call_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
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
