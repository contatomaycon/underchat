import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
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
          return [];
        }

        this.types = data.data;

        return data.data;
      } catch {
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
  },
});
