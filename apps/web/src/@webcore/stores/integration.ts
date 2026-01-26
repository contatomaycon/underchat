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
import { ViewWebhookMappingResponse } from '@core/schema/integration/viewWebhookMapping/response.schema';
import { SaveWebhookMappingRequest } from '@core/schema/integration/saveWebhookMapping/request.schema';
import { ViewWebhookDataResponse } from '@core/schema/integration/viewWebhookData/response.schema';
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
    webhookMapping: null as ViewWebhookMappingResponse | null,
    webhookData: null as unknown | null,
    webhookMappingLoading: false,
    webhookDataLoading: false,
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
    async viewWebhookMapping(): Promise<ViewWebhookMappingResponse | null> {
      try {
        this.webhookMappingLoading = true;

        const response = await axios.get<
          IApiResponse<ViewWebhookMappingResponse>
        >(`/integration/webhook-mapping`);

        this.webhookMappingLoading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.webhookMapping = null;
          return null;
        }

        this.webhookMapping = data.data;

        return data.data;
      } catch {
        this.webhookMappingLoading = false;
        this.webhookMapping = null;

        return null;
      }
    },
    async saveWebhookMapping(
      mapping: Record<string, string>
    ): Promise<boolean> {
      try {
        this.webhookMappingLoading = true;

        const request: SaveWebhookMappingRequest = { mapping };

        const response = await axios.post<IApiResponse<{ success: boolean }>>(
          `/integration/webhook-mapping`,
          request
        );

        this.webhookMappingLoading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('webhook_mapping_save_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        const message = this.i18n.global.t(
          'webhook_mapping_saved_successfully'
        );
        this.showSnackbar(message, EColor.success);

        await this.viewWebhookMapping();

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('webhook_mapping_save_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.webhookMappingLoading = false;

        return false;
      }
    },
    async viewWebhookData(): Promise<unknown | null> {
      try {
        this.webhookDataLoading = true;

        const response = await axios.get<IApiResponse<ViewWebhookDataResponse>>(
          `/integration/webhook-data`
        );

        this.webhookDataLoading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.webhookData = null;
          return null;
        }

        this.webhookData = data.data.data;

        return data.data.data;
      } catch {
        this.webhookDataLoading = false;
        this.webhookData = null;

        return null;
      }
    },
  },
});
