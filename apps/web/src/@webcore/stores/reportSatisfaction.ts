import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListReportSatisfactionFinalResponse,
  ReportSatisfactionResult,
} from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';
import { ListReportSatisfactionRequest } from '@core/schema/reportSatisfaction/listReportSatisfaction/request.schema';

export const useReportSatisfactionStore = defineStore('reportSatisfaction', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ReportSatisfactionResult[],
    summary: { total_responses: 0, unique_satisfactions: 0 },
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
    async listReportSatisfaction(
      input: ListReportSatisfactionRequest
    ): Promise<ListReportSatisfactionFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListReportSatisfactionFinalResponse>
        >('/report-satisfaction', {
          params: input,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('report_satisfaction_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.summary = data.data.summary;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('report_satisfaction_list_error');
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
