import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError, AxiosRequestConfig } from 'axios';
import {
  ListAiAgentFinalResponse,
  ListAiAgentResponse,
} from '@core/schema/aiAgent/listAiAgent/response.schema';
import { ListAiAgentRequest } from '@core/schema/aiAgent/listAiAgent/request.schema';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { UpdateAiAgentRequest } from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';
import { ListAiAgentTypeResponse } from '@core/schema/aiAgent/listAiAgentType/response.schema';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { ListAiAgentPromptResponse } from '@core/schema/aiAgent/listAiAgentPrompt/response.schema';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';
import { ViewAiAgentPromptResponse } from '@core/schema/aiAgent/viewAiAgentPrompt/response.schema';
import { ViewAiAgentConfigResponse } from '@core/schema/aiAgent/viewAiAgentConfig/response.schema';
import {
  ListAiAgentUsageFinalResponse,
  ListAiAgentUsageResponseItem,
} from '@core/schema/aiAgent/listAiAgentUsage/response.schema';
import { ViewAiAgentHumanTransferResponse } from '@core/schema/aiAgent/viewAiAgentHumanTransfer/response.schema';
import { UpsertAiAgentHumanTransferBody } from '@core/schema/aiAgent/upsertAiAgentHumanTransfer/request.schema';
import { ListAiAgentHumanTransferSectorsResponse } from '@core/schema/aiAgent/listAiAgentHumanTransferSectors/response.schema';
import { ListAiAgentHumanTransferSectorUsersResponse } from '@core/schema/aiAgent/listAiAgentHumanTransferSectorUsers/response.schema';

interface IListAiAgents {
  page?: number;
  per_page?: number;
  sort_by?: any[];
  search?: string | null;
  name?: string | null;
  status?: EAiAgentStatus | null;
}

export const useAiAgentStore = defineStore('aiAgent', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListAiAgentResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
    types: [] as ListAiAgentTypeResponse[],
    prompts: [] as ListAiAgentPromptResponse[],
    aiAgentConfig: null as ViewAiAgentConfigResponse | null,
    usageList: [] as ListAiAgentUsageResponseItem[],
    usagePagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
    usageLoading: false,
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
    async listAiAgents(
      input?: IListAiAgents
    ): Promise<ListAiAgentFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListAiAgentRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.name,
              status: input.status as EAiAgentStatus | null | undefined,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListAiAgentFinalResponse>
        >(`/ai-agent`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listAiAgentTypes(): Promise<ListAiAgentTypeResponse[]> {
      try {
        const response =
          await axios.get<IApiResponse<ListAiAgentTypeResponse[]>>(
            `/ai-agent/types`
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('ai_agent_type_list_error');
          this.showSnackbar(message, EColor.error);

          return [];
        }

        this.types = data.data;

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('ai_agent_type_list_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }
        this.showSnackbar(message, EColor.error);

        return [];
      }
    },

    async addAiAgent(payload: CreateAiAgentRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<string | null>>(
          `/ai-agent`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async viewAiAgent(aiAgentId: string): Promise<ViewAiAgentResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewAiAgentResponse>>(
          `/ai-agent/${aiAgentId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_not_found');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_not_found');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async updateAiAgent(
      aiAgentId: string,
      body: UpdateAiAgentRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/ai-agent/${aiAgentId}`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_update_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_update_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async setAiAgentPlanBlockStatus(
      aiAgentId: string,
      action: 'block' | 'unblock'
    ): Promise<boolean> {
      const isBlock = action === 'block';

      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/ai-agent/${aiAgentId}/${action}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t(
              isBlock ? 'ai_agent_block_error' : 'ai_agent_unblock_error'
            );

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t(
              isBlock ? 'ai_agent_block_success' : 'ai_agent_unblock_success'
            ),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          isBlock ? 'ai_agent_block_error' : 'ai_agent_unblock_error'
        );

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async blockAiAgent(aiAgentId: string): Promise<boolean> {
      return this.setAiAgentPlanBlockStatus(aiAgentId, 'block');
    },

    async unblockAiAgent(aiAgentId: string): Promise<boolean> {
      return this.setAiAgentPlanBlockStatus(aiAgentId, 'unblock');
    },

    async deleteAiAgent(aiAgentId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/ai-agent/${aiAgentId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_deleter_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_deleter_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async viewAiAgentHumanTransfer(
      aiAgentId: string
    ): Promise<ViewAiAgentHumanTransferResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ViewAiAgentHumanTransferResponse>
        >(`/ai-agent/${aiAgentId}/human-transfer`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_not_found');
          this.showSnackbar(mensage, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        const errorMessage = this.i18n.global.t('ai_agent_not_found');
        const msg =
          error instanceof AxiosError
            ? (error?.response?.data?.message ?? errorMessage)
            : errorMessage;
        this.showSnackbar(msg, EColor.error);
        this.loading = false;
        return null;
      }
    },

    async upsertAiAgentHumanTransfer(
      aiAgentId: string,
      body: UpsertAiAgentHumanTransferBody
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.put<IApiResponse<{ success: boolean }>>(
          `/ai-agent/${aiAgentId}/human-transfer`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_update_error');
          this.showSnackbar(mensage, EColor.error);
          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_human_transfer_upsert_successfully'),
          EColor.success
        );
        return true;
      } catch (error) {
        const errorMessage = this.i18n.global.t('ai_agent_update_error');
        const msg =
          error instanceof AxiosError
            ? (error?.response?.data?.message ?? errorMessage)
            : errorMessage;
        this.showSnackbar(msg, EColor.error);
        this.loading = false;
        return false;
      }
    },

    async listHumanTransferSectors(): Promise<ListAiAgentHumanTransferSectorsResponse> {
      try {
        const response = await axios.get<
          IApiResponse<ListAiAgentHumanTransferSectorsResponse>
        >('/ai-agent/human-transfer/sectors');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage = this.i18n.global.t(
          'error_loading_transfer_sectors'
        );
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listHumanTransferSectorUsers(
      sectorId: string
    ): Promise<ListAiAgentHumanTransferSectorUsersResponse> {
      try {
        const response = await axios.get<
          IApiResponse<ListAiAgentHumanTransferSectorUsersResponse>
        >(`/ai-agent/human-transfer/sectors/${sectorId}/users`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage = this.i18n.global.t('transfer_sector_users_error');
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listHumanTransferSectorUsersBySectorIds(
      sectorIds: string[]
    ): Promise<ListAiAgentHumanTransferSectorUsersResponse> {
      if (sectorIds.length === 0) {
        return [];
      }

      try {
        const response = await axios.get<
          IApiResponse<ListAiAgentHumanTransferSectorUsersResponse>
        >('/ai-agent/human-transfer/sectors/users', {
          params: { sector_ids: sectorIds },
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage = this.i18n.global.t('transfer_sector_users_error');
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listAiAgentPrompts(
      aiAgentId: string
    ): Promise<ListAiAgentPromptResponse[] | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListAiAgentPromptResponse[]>
        >(`/ai-agent/${aiAgentId}/prompt`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_prompt_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.prompts = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_prompt_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async addAiAgentPrompt(
      input: CreateAiAgentPromptRequest,
      file?: File | null
    ): Promise<string | null> {
      try {
        this.loading = true;

        const formData = new FormData();
        formData.append('ai_agent_id', input.ai_agent_id.value);

        if (file) {
          formData.append('file', file);
        }

        if (input.status) {
          formData.append('status', input.status.value);
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<
          IApiResponse<{ ai_agent_prompt_id: string }>
        >(`/ai-agent/prompt`, formData, config);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_prompt_add_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_prompt_add_success'),
          EColor.success
        );

        return data.data.ai_agent_prompt_id;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_prompt_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async viewAiAgentPrompt(
      aiAgentPromptId: string
    ): Promise<ViewAiAgentPromptResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ViewAiAgentPromptResponse>
        >(`/ai-agent/prompt/${aiAgentPromptId}`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_prompt_not_found');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_prompt_not_found');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async updateAiAgentPrompt(
      aiAgentPromptId: string,
      input: UpdateAiAgentPromptRequest,
      file?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = new FormData();

        if (input.status !== undefined) {
          formData.append('status[value]', input.status.value);
        }

        if (file) {
          formData.append('file', file);
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.patch<IApiResponse<null>>(
          `/ai-agent/prompt/${aiAgentPromptId}`,
          formData,
          config
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('ai_agent_prompt_update_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_prompt_update_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_prompt_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deleteAiAgentPrompt(aiAgentPromptId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/ai-agent/prompt/${aiAgentPromptId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('ai_agent_prompt_deleter_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_prompt_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_prompt_deleter_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async refreshAiAgentPrompt(aiAgentPromptId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<null>>(
          `/ai-agent/prompt/${aiAgentPromptId}/refresh`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('ai_agent_prompt_refresh_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_prompt_refresh_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_prompt_refresh_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async refreshAllAiAgentPrompts(aiAgentId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<null>>(
          `/ai-agent/${aiAgentId}/prompt/refresh-all`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('ai_agent_prompt_refresh_all_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_prompt_refresh_all_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'ai_agent_prompt_refresh_all_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async listAiAgentUsage(
      aiAgentId: string,
      page = 1,
      perPage = 10
    ): Promise<ListAiAgentUsageFinalResponse | null> {
      try {
        this.usageLoading = true;

        const response = await axios.get<
          IApiResponse<ListAiAgentUsageFinalResponse>
        >(`/ai-agent/${aiAgentId}/usage`, {
          params: { current_page: page, per_page: perPage },
        });

        this.usageLoading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('ai_agent_usage_list_error');
          this.showSnackbar(message, EColor.error);
          return null;
        }

        this.usageList = data.data.results;
        this.usagePagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('ai_agent_usage_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        this.usageLoading = false;
        return null;
      }
    },

    async fetchAiAgentConfig(
      forceRefresh = false
    ): Promise<ViewAiAgentConfigResponse | null> {
      if (!forceRefresh && this.aiAgentConfig !== null) {
        return this.aiAgentConfig;
      }

      try {
        const response =
          await axios.get<IApiResponse<ViewAiAgentConfigResponse>>(
            `/ai-agent/config`
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.aiAgentConfig = {
            ai_agent: null,
            enabled: false,
            total: 0,
          };
          return this.aiAgentConfig;
        }

        this.aiAgentConfig = data.data;
        return this.aiAgentConfig;
      } catch {
        this.aiAgentConfig = {
          ai_agent: null,
          enabled: false,
          total: 0,
        };
        return this.aiAgentConfig;
      }
    },
  },
});
