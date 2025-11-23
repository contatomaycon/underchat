import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListFinancialReportRequest,
  ListFinancialReportResponse,
  FinancialReportAnnual,
  FinancialReportItem,
} from '@core/schema/financial/listFinancialReport';

export const useFinancialStore = defineStore('financial', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    annualReport: null as FinancialReportAnnual | null,
    monthlyReport: [] as FinancialReportItem[],
    dailyReport: [] as FinancialReportItem[],
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
    async listFinancialReport(
      input: ListFinancialReportRequest
    ): Promise<ListFinancialReportResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListFinancialReportResponse>
        >(`/financial/report`, {
          params: input,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('financial_report_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        if (input.view_type === 'annual') {
          this.annualReport = data.data as FinancialReportAnnual;
        } else if (input.view_type === 'monthly') {
          this.monthlyReport = data.data as FinancialReportItem[];
        } else {
          this.dailyReport = data.data as FinancialReportItem[];
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('financial_report_list_error');
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
