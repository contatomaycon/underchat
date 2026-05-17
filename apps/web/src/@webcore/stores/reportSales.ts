import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';
import {
  ListPlanSalesFinalResponse,
  ListPlanSalesResponse,
} from '@core/schema/plan/listPlanSales/response.schema';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { IListPlanSales } from '../interfaces/IListPlanSales';
import { ListPlanSalesSummaryResponse } from '@core/schema/plan/listPlanSalesSummary/response.schema';

export const useReportSalesStore = defineStore('reportSales', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    listAll: [] as ListPlanAllResponse[],
    listSales: [] as ListPlanSalesResponse[],
    summary: {
      total_clients: 0,
      new_clients: 0,
    } as ListPlanSalesSummaryResponse,
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

    async listPlanAll(): Promise<ListPlanAllResponse[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListPlanAllResponse[]>>(
            '/sales/plan/all'
          );

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

    async listPlanSales(
      input?: IListPlanSales
    ): Promise<ListPlanSalesFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListPlanSalesRequest | undefined = input
          ? {
              plan_id: input.plan_id,
              start_date: input.start_date,
              end_date: input.end_date,
              payment_billing_type_id: input.payment_billing_type_id,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListPlanSalesFinalResponse>
        >('/sales/plan/sales', {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_sales_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.listSales = data.data.results;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_sales_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listPlanSalesSummary(
      input?: IListPlanSales
    ): Promise<ListPlanSalesSummaryResponse | null> {
      try {
        const request: ListPlanSalesRequest | undefined = input
          ? {
              plan_id: input.plan_id,
              start_date: input.start_date,
              end_date: input.end_date,
              payment_billing_type_id: input.payment_billing_type_id,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListPlanSalesSummaryResponse>
        >('/sales/plan/summary', {
          params: request,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('plan_sales_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.summary = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('plan_sales_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
  },
});
