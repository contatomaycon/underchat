import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { ListIntegrationsResponse } from '@core/schema/integration/listIntegrations/response.schema';
import { CreateIntegrationRequest } from '@core/schema/integration/createIntegration/request.schema';
import { CreateIntegrationResponse } from '@core/schema/integration/createIntegration/response.schema';
import { UpdateIntegrationRequest } from '@core/schema/integration/updateIntegration/request.schema';
import { ViewIntegrationByIdResponse } from '@core/schema/integration/viewIntegrationById/response.schema';
import { UpdateIntegrationStatusRequest } from '@core/schema/integration/updateIntegrationStatus/request.schema';
import { GenerateIntegrationKeyResponse } from '@core/schema/integration/generateIntegrationKey/response.schema';
import { ViewWebhookMappingResponse } from '@core/schema/integration/viewWebhookMapping/response.schema';
import { SaveWebhookMappingRequest } from '@core/schema/integration/saveWebhookMapping/request.schema';
import { ViewWebhookDataResponse } from '@core/schema/integration/viewWebhookData/response.schema';
import { ListAvailableChannelsResponse } from '@core/schema/integration/listAvailableChannels/response.schema';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';

export const useIntegrationStore = defineStore('integration', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    integrations: [] as ListIntegrationsResponse['results'],
    pagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 0,
      total: 0,
    } as PagingResponseSchema,
    currentIntegration: null as ViewIntegrationByIdResponse | null,
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
    async listIntegrations(params?: {
      page?: number;
      per_page?: number;
      search?: string;
      status?: string;
    }): Promise<ListIntegrationsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListIntegrationsResponse>
        >(`/integration`, {
          params,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('integrations_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.integrations = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('integrations_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },
    async createIntegration(
      request: CreateIntegrationRequest
    ): Promise<CreateIntegrationResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<CreateIntegrationResponse>
        >(`/integration`, request);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('integration_creation_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        const message = this.i18n.global.t('integration_created_successfully');
        this.showSnackbar(message, EColor.success);

        await this.listIntegrations();

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('integration_creation_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },
    async updateIntegration(
      apiKeyId: string,
      request: UpdateIntegrationRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<{ success: boolean }>>(
          `/integration/update`,
          request,
          { params: { api_key_id: apiKeyId } }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('integration_update_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        const message = this.i18n.global.t('integration_updated_successfully');
        this.showSnackbar(message, EColor.success);

        await this.listIntegrations();

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('integration_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },
    async deleteIntegration(apiKeyId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<{ success: boolean }>>(
          `/integration/delete`,
          { params: { api_key_id: apiKeyId } }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('integration_deletion_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        const message = this.i18n.global.t('integration_deleted_successfully');
        this.showSnackbar(message, EColor.success);

        await this.listIntegrations();

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('integration_deletion_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },
    async viewIntegrationById(
      apiKeyId: string
    ): Promise<ViewIntegrationByIdResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ViewIntegrationByIdResponse>
        >(`/integration/view`, {
          params: { api_key_id: apiKeyId },
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('integration_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.currentIntegration = data.data;

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
    async updateIntegrationStatus(
      apiKeyId: string,
      status: EStatusApiKey
    ): Promise<boolean> {
      try {
        this.loading = true;

        const request: UpdateIntegrationStatusRequest = {
          api_key_id: apiKeyId,
          status,
        };

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

        await this.listIntegrations();

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
    async generateIntegrationKey(apiKeyId: string): Promise<string | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<GenerateIntegrationKeyResponse>
        >(`/integration/generate-key`, null, {
          params: { api_key_id: apiKeyId },
        });

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

        await this.viewIntegrationById(apiKeyId);

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
    async viewWebhookMapping(
      apiKeyId: string
    ): Promise<ViewWebhookMappingResponse | null> {
      try {
        this.webhookMappingLoading = true;

        const response = await axios.get<
          IApiResponse<ViewWebhookMappingResponse>
        >(`/integration/webhook-mapping`, {
          params: { api_key_id: apiKeyId },
        });

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
      apiKeyId: string,
      mapping: Record<string, string>
    ): Promise<boolean> {
      try {
        this.webhookMappingLoading = true;

        const request: SaveWebhookMappingRequest = {
          api_key_id: apiKeyId,
          mapping,
        };

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

        await this.viewWebhookMapping(apiKeyId);

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
    async viewWebhookData(apiKeyId: string): Promise<unknown | null> {
      try {
        this.webhookDataLoading = true;

        const response = await axios.get<IApiResponse<ViewWebhookDataResponse>>(
          `/integration/webhook-data`,
          { params: { api_key_id: apiKeyId } }
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
    async listAvailableChannels(): Promise<ListAvailableChannelsResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListAvailableChannelsResponse>
        >(`/integration/available-channels`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },
  },
});
