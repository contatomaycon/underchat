import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListPlanFinalResponse,
  ListPlanResponse,
} from '@core/schema/plan/listPlan/response.schema';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { IListPlans } from '../interfaces/IListPlans';

export const usePlanStore = defineStore('plan', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListPlanResponse[],
    listAll: [] as ListPlanAllResponse[],
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

    async listPlan(input?: IListPlans): Promise<ListPlanFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListPlanRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              plan_id: input.search,
              name: input.name,
              price: input.search,
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListPlanFinalResponse>>(
          `/plan`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('plan_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listPlanAll(): Promise<ListPlanAllResponse[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListPlanAllResponse[]>>('/plan/all');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_all_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.listAll = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_all_list_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },
  },
});
