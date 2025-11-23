import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListExpenditureFinalResponse,
  ListExpenditureResponse,
} from '@core/schema/expenditure/listExpenditure/response.schema';
import { ListExpenditureRequest } from '@core/schema/expenditure/listExpenditure/request.schema';
import { CreateExpenditureRequest } from '@core/schema/expenditure/createExpenditure/request.schema';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/updateExpenditure/request.schema';

interface IListExpenditures {
  page?: number;
  per_page?: number;
  sort_by?: any[];
  search?: string | null;
  name?: string | null;
  description?: string | null;
  price?: string | null;
}

export const useExpenditureStore = defineStore('expenditure', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListExpenditureResponse[],
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

    async listExpenditure(
      input?: IListExpenditures
    ): Promise<ListExpenditureFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListExpenditureRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.name || input.search,
              description: input.description || input.search,
              price: input.price || input.search,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListExpenditureFinalResponse>
        >(`/expenditure`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('expenditure_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('expenditure_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async createExpenditure(input: CreateExpenditureRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<null>>(
          '/expenditure',
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('expenditure_creation_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('expenditure_created_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('expenditure_creation_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async updateExpenditure(
      expenditureId: string,
      input: UpdateExpenditureRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<null>>(
          `/expenditure/${expenditureId}`,
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('expenditure_update_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('expenditure_updated_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('expenditure_update_failed');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async deleteExpenditure(expenditureId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/expenditure/${expenditureId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('expenditure_delete_failed');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('expenditure_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('expenditure_delete_failed');

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
