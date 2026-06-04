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
import {
  ListWorkerServersResponse,
  ListWorkerServersItemResponse,
} from '@core/schema/worker/listWorkerServers/response.schema';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
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
import { ViewAttendanceHoursResponse } from '@core/schema/worker/viewAttendanceHours/response.schema';
import { UpdateAttendanceHoursRequest } from '@core/schema/worker/updateAttendanceHours/request.schema';
import { UpdateAttendanceHoursResponse } from '@core/schema/worker/updateAttendanceHours/response.schema';
import { ViewAttendanceInactivityAlertResponse } from '@core/schema/worker/viewAttendanceInactivityAlert/response.schema';
import { UpdateAttendanceInactivityAlertRequest } from '@core/schema/worker/updateAttendanceInactivityAlert/request.schema';
import { UpdateAttendanceInactivityAlertResponse } from '@core/schema/worker/updateAttendanceInactivityAlert/response.schema';
import { ViewOperatorReplyPendingAlertResponse } from '@core/schema/worker/viewOperatorReplyPendingAlert/response.schema';
import { UpdateOperatorReplyPendingAlertRequest } from '@core/schema/worker/updateOperatorReplyPendingAlert/request.schema';
import { UpdateOperatorReplyPendingAlertResponse } from '@core/schema/worker/updateOperatorReplyPendingAlert/response.schema';
import { ViewTypingSimulationResponse } from '@core/schema/worker/viewTypingSimulation/response.schema';
import { UpdateTypingSimulationRequest } from '@core/schema/worker/updateTypingSimulation/request.schema';
import { UpdateTypingSimulationResponse } from '@core/schema/worker/updateTypingSimulation/response.schema';
import { ViewSecurityKeyResponse } from '@core/schema/worker/viewSecurityKey/response.schema';
import { UpdateSecurityKeyRequest } from '@core/schema/worker/updateSecurityKey/request.schema';
import { UpdateSecurityKeyResponse } from '@core/schema/worker/updateSecurityKey/response.schema';
import { WorkerExternalConnectionLinkResponse } from '@core/schema/worker/externalConnectionLink/response.schema';
import { WorkerExternalConnectionViewResponse } from '@core/schema/worker/externalConnection/response.schema';

const workerConfigForChatPendingModule: Record<
  string,
  Promise<ViewWorkerConfigForChatResponse | null>
> = {};

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

    async listWorkerServers(): Promise<ListWorkerServersItemResponse[] | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListWorkerServersResponse>>(
            `/worker/servers`
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.results;
      } catch {
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
          { worker_type: payload.worker_type }
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

    async checkChannelOpenConversations(
      channelId: string
    ): Promise<number | null> {
      try {
        const response = await axios.get<IApiResponse<{ count: number }>>(
          `/worker/${channelId}/open-conversations`
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

    async requestConnectionQrCode(
      workerId: string,
      options: { silent?: boolean; timeoutMs?: number } = {}
    ): Promise<IBaileysConnectionState | null> {
      try {
        if (!options.silent) {
          this.loading = true;
        }

        const config: AxiosRequestConfig | undefined = options.timeoutMs
          ? { timeout: options.timeoutMs }
          : undefined;

        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(`/worker/${workerId}/connection/qrcode`, {}, config);

        if (!options.silent) {
          this.loading = false;
        }

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('worker_status_update_error');

          if (!options.silent) {
            this.showSnackbar(message, EColor.error);
          }

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_status_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        if (!options.silent) {
          this.showSnackbar(errorMessage, EColor.error);
        }

        if (!options.silent) {
          this.loading = false;
        }

        return null;
      }
    },

    async resetConnectionChannel(workerId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/worker/${workerId}/connection/reset`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('worker_connection_reset_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          data?.message ??
            this.i18n.global.t('worker_connection_reset_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_connection_reset_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async createExternalConnectionLink(
      workerId: string
    ): Promise<WorkerExternalConnectionLinkResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<WorkerExternalConnectionLinkResponse>
        >(`/worker/${workerId}/external-connection-link`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('external_connection_link_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('external_connection_link_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async viewExternalConnection(
      token: string
    ): Promise<WorkerExternalConnectionViewResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<WorkerExternalConnectionViewResponse>
        >(`/worker/external-connection/${encodeURIComponent(token)}`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async requestExternalConnectionQrCode(
      token: string,
      options: { timeoutMs?: number } = {}
    ): Promise<IBaileysConnectionState | null> {
      try {
        const config: AxiosRequestConfig | undefined = options.timeoutMs
          ? { timeout: options.timeoutMs }
          : undefined;

        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(
          `/worker/external-connection/${encodeURIComponent(token)}/qrcode`,
          {},
          config
        );

        return response?.data?.status ? (response.data.data ?? null) : null;
      } catch {
        return null;
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

    fetchWorkerConfigForChat(
      workerId: string
    ): Promise<ViewWorkerConfigForChatResponse | null> {
      if (!workerId) return Promise.resolve(null);

      if (this.workerConfigForChatCache[workerId] !== undefined) {
        return Promise.resolve(this.workerConfigForChatCache[workerId]);
      }

      if (workerId in workerConfigForChatPendingModule) {
        return workerConfigForChatPendingModule[workerId];
      }

      const promise = axios
        .get<IApiResponse<ViewWorkerConfigForChatResponse>>(
          `/chat/worker/${workerId}/config`
        )
        .then((response) => {
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
        })
        .catch((error) => {
          let message = this.i18n.global.t('channel_general_config_load_error');
          if (error instanceof AxiosError) {
            message = error?.response?.data?.message ?? message;
          }

          this.showSnackbar(message, EColor.error);

          this.workerConfigForChatCache[workerId] = null;
          return null;
        })
        .finally(() => {
          delete workerConfigForChatPendingModule[workerId];
        });

      workerConfigForChatPendingModule[workerId] = promise;
      return promise;
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

    async fetchTransferProtocolText(workerId: string): Promise<{
      generate_protocol_at_transfer: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_transfer: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTransferProtocolText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_transfer: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_transfer: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol`, body);

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

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('transfer_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchTransferProtocolSectorText(workerId: string): Promise<{
      generate_protocol_at_transfer_sector: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_transfer_sector: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTransferProtocolSectorText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_transfer_sector: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_transfer_sector: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('transfer_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('transfer_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchTransferProtocolSectorAndUserText(workerId: string): Promise<{
      generate_protocol_at_transfer_sector_and_user: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_transfer_sector_and_user: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector-and-user`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTransferProtocolSectorAndUserText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_transfer_sector_and_user: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_transfer_sector_and_user: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector-and-user`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('transfer_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('transfer_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchStartProtocolText(workerId: string): Promise<{
      generate_protocol_at_start: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_start: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/start-protocol`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateStartProtocolText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_start: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_start: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/start-protocol`, body);

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

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('start_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchChatbot(workerId: string): Promise<{
      chatbot_id: string | null;
      output_chatbot_id: string | null;
      chatbot_working_hours_enabled: boolean;
      chatbot_working_hours_timezone: string;
      chatbot_working_hours_rules: Array<{
        weekday:
          | 'monday'
          | 'tuesday'
          | 'wednesday'
          | 'thursday'
          | 'friday'
          | 'saturday'
          | 'sunday';
        start_time: string;
        end_time: string;
        chatbot_id: string;
      }>;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            chatbot_id: string | null;
            output_chatbot_id: string | null;
            chatbot_working_hours_enabled: boolean;
            chatbot_working_hours_timezone: string;
            chatbot_working_hours_rules: Array<{
              weekday:
                | 'monday'
                | 'tuesday'
                | 'wednesday'
                | 'thursday'
                | 'friday'
                | 'saturday'
                | 'sunday';
              start_time: string;
              end_time: string;
              chatbot_id: string;
            }>;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/chatbot`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateChatbot(
      workerId: string,
      chatbotId: string | null,
      outputChatbotId: string | null,
      enabled: boolean,
      chatbotWorkingHoursEnabled: boolean,
      chatbotWorkingHoursTimezone: string,
      chatbotWorkingHoursRules: Array<{
        weekday:
          | 'monday'
          | 'tuesday'
          | 'wednesday'
          | 'thursday'
          | 'friday'
          | 'saturday'
          | 'sunday';
        start_time: string;
        end_time: string;
        chatbot_id: string;
      }>
    ): Promise<{
      chatbot_id: string | null;
      output_chatbot_id: string | null;
      chatbot_working_hours_enabled: boolean;
      chatbot_working_hours_timezone: string;
      chatbot_working_hours_rules: Array<{
        weekday:
          | 'monday'
          | 'tuesday'
          | 'wednesday'
          | 'thursday'
          | 'friday'
          | 'saturday'
          | 'sunday';
        start_time: string;
        end_time: string;
        chatbot_id: string;
      }>;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: {
          chatbot_id?: string | null;
          output_chatbot_id?: string | null;
          chatbot_working_hours_enabled?: boolean;
          chatbot_working_hours_timezone?: string;
          chatbot_working_hours_rules?: Array<{
            weekday:
              | 'monday'
              | 'tuesday'
              | 'wednesday'
              | 'thursday'
              | 'friday'
              | 'saturday'
              | 'sunday';
            start_time: string;
            end_time: string;
            chatbot_id: string;
          }>;
          enabled: boolean;
        } = {
          enabled,
          chatbot_id: chatbotId,
          output_chatbot_id: outputChatbotId,
          chatbot_working_hours_enabled: chatbotWorkingHoursEnabled,
          chatbot_working_hours_timezone: chatbotWorkingHoursTimezone,
          chatbot_working_hours_rules: chatbotWorkingHoursRules,
        };

        const response = await axios.patch<
          IApiResponse<{
            chatbot_id: string | null;
            output_chatbot_id: string | null;
            chatbot_working_hours_enabled: boolean;
            chatbot_working_hours_timezone: string;
            chatbot_working_hours_rules: Array<{
              weekday:
                | 'monday'
                | 'tuesday'
                | 'wednesday'
                | 'thursday'
                | 'friday'
                | 'saturday'
                | 'sunday';
              start_time: string;
              end_time: string;
              chatbot_id: string;
            }>;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/chatbot`, body);

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

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('chatbot_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchAiAgentConfig(workerId: string): Promise<{
      ai_agent_id: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            ai_agent_id: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/ai-agent`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateAiAgentConfig(
      workerId: string,
      aiAgentId: string | null,
      enabled: boolean
    ): Promise<{
      ai_agent_id: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: {
          ai_agent_id?: string | null;
          enabled: boolean;
        } = {
          enabled,
          ai_agent_id: aiAgentId,
        };

        const response = await axios.patch<
          IApiResponse<{
            ai_agent_id: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/ai-agent`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('ai_agent_config_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_config_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('ai_agent_config_update_error');
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

    async fetchSimultaneousAttendance(workerId: string): Promise<{
      simultaneous_attendance: number | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            simultaneous_attendance: number | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/simultaneous-attendance`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateSimultaneousAttendance(
      workerId: string,
      quantity: number | null,
      enabled: boolean
    ): Promise<{
      simultaneous_attendance: number | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { quantity?: number; enabled: boolean } = {
          enabled,
        };
        if (quantity !== null) {
          body.quantity = quantity;
        }

        const response = await axios.patch<
          IApiResponse<{
            simultaneous_attendance: number | null;
            enabled: boolean;
          }>
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

        return data.data;
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

    async fetchTypingSimulation(
      workerId: string
    ): Promise<ViewTypingSimulationResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewTypingSimulationResponse>
        >(`/worker/${workerId}/config/typing-simulation`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTypingSimulation(
      workerId: string,
      body: UpdateTypingSimulationRequest
    ): Promise<UpdateTypingSimulationResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateTypingSimulationResponse>
        >(`/worker/${workerId}/config/typing-simulation`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('typing_simulation_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('typing_simulation_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('typing_simulation_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchSecurityKey(
      workerId: string
    ): Promise<ViewSecurityKeyResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<IApiResponse<ViewSecurityKeyResponse>>(
          `/worker/${workerId}/config/security-key`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateSecurityKey(
      workerId: string,
      body: UpdateSecurityKeyRequest
    ): Promise<UpdateSecurityKeyResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateSecurityKeyResponse>
        >(`/worker/${workerId}/config/security-key`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('security_key_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('security_key_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('security_key_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchShowMessageOnCall(workerId: string): Promise<{
      show_message_on_call: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            show_message_on_call: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/show-message-on-call`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateShowMessageOnCall(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      show_message_on_call: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            show_message_on_call: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/show-message-on-call`, body);

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

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('show_message_on_call_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchSendMessageOnFinishAttendance(workerId: string): Promise<{
      send_message_on_finish_attendance: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            send_message_on_finish_attendance: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/send-message-on-finish-attendance`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateSendMessageOnFinishAttendance(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      send_message_on_finish_attendance: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            send_message_on_finish_attendance: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/send-message-on-finish-attendance`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t(
              'send_message_on_finish_attendance_update_error'
            );
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t(
            'send_message_on_finish_attendance_update_success'
          ),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'send_message_on_finish_attendance_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchAttendanceInactivityAlert(
      workerId: string
    ): Promise<ViewAttendanceInactivityAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewAttendanceInactivityAlertResponse>
        >(`/worker/${workerId}/config/attendance-inactivity-alert`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateAttendanceInactivityAlert(
      workerId: string,
      body: UpdateAttendanceInactivityAlertRequest
    ): Promise<UpdateAttendanceInactivityAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateAttendanceInactivityAlertResponse>
        >(`/worker/${workerId}/config/attendance-inactivity-alert`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('attendance_inactivity_alert_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('attendance_inactivity_alert_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'attendance_inactivity_alert_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchOperatorReplyPendingAlert(
      workerId: string
    ): Promise<ViewOperatorReplyPendingAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewOperatorReplyPendingAlertResponse>
        >(`/worker/${workerId}/config/operator-reply-pending-alert`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateOperatorReplyPendingAlert(
      workerId: string,
      body: UpdateOperatorReplyPendingAlertRequest
    ): Promise<UpdateOperatorReplyPendingAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateOperatorReplyPendingAlertResponse>
        >(`/worker/${workerId}/config/operator-reply-pending-alert`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('operator_reply_pending_alert_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('operator_reply_pending_alert_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'operator_reply_pending_alert_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchAttendanceHours(
      workerId: string
    ): Promise<ViewAttendanceHoursResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewAttendanceHoursResponse>
        >(`/worker/${workerId}/config/attendance-hours`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateAttendanceHours(
      workerId: string,
      body: UpdateAttendanceHoursRequest
    ): Promise<UpdateAttendanceHoursResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateAttendanceHoursResponse>
        >(`/worker/${workerId}/config/attendance-hours`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('attendance_hours_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('attendance_hours_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('attendance_hours_update_error');
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
