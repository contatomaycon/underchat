import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListVoiceIaFinalResponse,
  ListVoiceIaResponse,
} from '@core/schema/voiceIa/listVoiceIa/response.schema';
import { ListVoiceIaRequest } from '@core/schema/voiceIa/listVoiceIa/request.schema';
import { CreateVoiceIaRequest } from '@core/schema/voiceIa/createVoiceIa/request.schema';
import { UpdateVoiceIaRequest } from '@core/schema/voiceIa/updateVoiceIa/request.schema';
import { ViewVoiceIaResponse } from '@core/schema/voiceIa/viewVoiceIa/response.schema';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { SortRequest } from '@core/schema/common/sortRequestSchema';

interface IListVoiceIas {
  page?: number;
  per_page?: number;
  sort_by?: SortRequest[];
  search?: string | null;
  name?: string | null;
  status?: EVoiceIaStatus | null;
}

export const useVoiceIaStore = defineStore('voiceIa', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListVoiceIaResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
    activeVoiceIasForSelect: [] as Array<{ value: string; title: string }>,
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
    async listActiveVoiceIas(): Promise<
      Array<{ value: string; title: string }>
    > {
      try {
        const response = await axios.get<
          IApiResponse<ListVoiceIaFinalResponse>
        >(`/ai-agent/voice-ia`, {
          params: {
            current_page: 1,
            per_page: 100,
            status: EVoiceIaStatus.active,
          },
        });

        const data = response?.data;

        if (!data?.status || !data?.data?.results) {
          return [];
        }

        const list = data.data.results.map((item) => ({
          value: item.voice_ia_id,
          title: item.name,
        }));

        this.activeVoiceIasForSelect = list;

        return list;
      } catch {
        return [];
      }
    },
    async listVoiceIas(
      input?: IListVoiceIas
    ): Promise<ListVoiceIaFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListVoiceIaRequest | undefined = input
          ? {
              current_page: input.page ?? 1,
              per_page: input.per_page ?? 10,
              sort_by: input.sort_by,
              name: input.name,
              status: input.status,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListVoiceIaFinalResponse>
        >(`/ai-agent/voice-ia`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('voice_ia_list_not_found');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('voice_ia_list_not_found');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async addVoiceIa(input: CreateVoiceIaRequest): Promise<string | null> {
      try {
        const response = await axios.post<
          IApiResponse<{ voice_ia_id: string }>
        >(`/ai-agent/voice-ia`, input);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('voice_ia_add_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('voice_ia_add_success'),
          EColor.success
        );

        return data.data.voice_ia_id;
      } catch (error) {
        let errorMessage = this.i18n.global.t('voice_ia_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async viewVoiceIa(voiceIaId: string): Promise<ViewVoiceIaResponse | null> {
      try {
        const response = await axios.get<IApiResponse<ViewVoiceIaResponse>>(
          `/ai-agent/voice-ia/${voiceIaId}`
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

    async updateVoiceIa(
      voiceIaId: string,
      input: UpdateVoiceIaRequest
    ): Promise<boolean> {
      try {
        const response = await axios.patch<IApiResponse<null>>(
          `/ai-agent/voice-ia/${voiceIaId}`,
          input
        );

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('voice_ia_update_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('voice_ia_update_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('voice_ia_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async deleteVoiceIa(voiceIaId: string): Promise<boolean> {
      try {
        const response = await axios.delete<IApiResponse<null>>(
          `/ai-agent/voice-ia/${voiceIaId}`
        );

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('voice_ia_delete_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('voice_ia_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('voice_ia_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },
  },
});
