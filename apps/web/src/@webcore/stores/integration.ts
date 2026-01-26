import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { ViewIntegrationResponse } from '@core/schema/integration/viewIntegration/response.schema';
import { UpdateIntegrationStatusRequest } from '@core/schema/integration/updateIntegrationStatus/request.schema';
import { GenerateIntegrationKeyResponse } from '@core/schema/integration/generateIntegrationKey/response.schema';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

export const useIntegrationStore = defineStore('integration', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    integration: null as ViewIntegrationResponse | null,
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
    async viewIntegration(): Promise<ViewIntegrationResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ViewIntegrationResponse>>(
            `/integration`
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('integration_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.integration = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('integration_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },
    async updateIntegrationStatus(status: EStatusApiKey): Promise<boolean> {
      try {
        this.loading = true;

        const request: UpdateIntegrationStatusRequest = { status };

        const response = await axios.patch<IApiResponse<{ success: boolean }>>(
          `/integration/status`,
          request
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('integration_status_update_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        const message = this.i18n.global.t(
          'integration_status_updated_successfully'
        );
        this.showSnackbar(message, EColor.success);

        if (this.integration) {
          this.integration.status = status;
        }

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'integration_status_update_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },
    async generateIntegrationKey(): Promise<string | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<GenerateIntegrationKeyResponse>
        >(`/integration/generate-key`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('integration_key_generation_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        const message = this.i18n.global.t(
          'integration_key_generated_successfully'
        );
        this.showSnackbar(message, EColor.success);

        if (this.integration) {
          this.integration.key = data.data.key;
        }

        return data.data.key;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'integration_key_generation_error'
        );
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
