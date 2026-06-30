import { defineStore } from 'pinia';
import { AxiosError } from 'axios';
import axios from '@webcore/axios';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import {
  CreateWhatsappTemplateRequest,
  DeleteWhatsappTemplateResponse,
  ListWhatsappTemplatesQuery,
  ListWhatsappTemplatesResponse,
  SyncWhatsappTemplatesResponse,
  UpdateWhatsappTemplateRequest,
  UploadWhatsappTemplateMediaResponse,
  WhatsappTemplateResponse,
} from '@core/schema/worker/whatsappOfficialTemplate';

const defaultPagings = (): PagingResponseSchema => ({
  current_page: 1,
  total_pages: 1,
  per_page: 10,
  count: 0,
  total: 0,
});

export const useWhatsappOfficialTemplateStore = defineStore(
  'whatsappOfficialTemplate',
  {
    state: () => ({
      snackbar: {
        color: EColor.success,
        message: '',
        status: false,
      } as ISnackbar,
      i18n: getI18n(),
      loading: false,
      saving: false,
      syncing: false,
      uploading: false,
      list: [] as WhatsappTemplateResponse[],
      pagings: defaultPagings(),
      selected: null as WhatsappTemplateResponse | null,
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
      extractErrorMessage(error: unknown, fallbackKey: string): string {
        if (error instanceof AxiosError) {
          return (
            error.response?.data?.message ?? this.i18n.global.t(fallbackKey)
          );
        }

        return this.i18n.global.t(fallbackKey);
      },
      async listTemplates(
        workerId: string,
        query: ListWhatsappTemplatesQuery
      ): Promise<ListWhatsappTemplatesResponse | null> {
        try {
          this.loading = true;
          const response = await axios.get<
            IApiResponse<ListWhatsappTemplatesResponse>
          >(`/worker/${workerId}/whatsapp-official/templates`, {
            params: query,
          });
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_list_error'),
              EColor.error
            );
            return null;
          }

          this.list = data.data.results;
          this.pagings = data.data.pagings;

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(error, 'whatsapp_template_list_error'),
            EColor.error
          );
          return null;
        } finally {
          this.loading = false;
        }
      },
      async syncTemplates(
        workerId: string
      ): Promise<SyncWhatsappTemplatesResponse | null> {
        try {
          this.syncing = true;
          const response = await axios.post<
            IApiResponse<SyncWhatsappTemplatesResponse>
          >(`/worker/${workerId}/whatsapp-official/templates/sync`);
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_sync_error'),
              EColor.error
            );
            return null;
          }

          this.showSnackbar(
            data.message ??
              this.i18n.global.t('whatsapp_template_sync_success'),
            data.data.errors.length ? EColor.warning : EColor.success
          );

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(error, 'whatsapp_template_sync_error'),
            EColor.error
          );
          return null;
        } finally {
          this.syncing = false;
        }
      },
      async createTemplate(
        workerId: string,
        payload: CreateWhatsappTemplateRequest
      ): Promise<WhatsappTemplateResponse | null> {
        try {
          this.saving = true;
          const response = await axios.post<
            IApiResponse<WhatsappTemplateResponse>
          >(`/worker/${workerId}/whatsapp-official/templates`, payload);
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_create_error'),
              EColor.error
            );
            return null;
          }

          this.showSnackbar(
            data.message ??
              this.i18n.global.t('whatsapp_template_create_success'),
            EColor.success
          );

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(error, 'whatsapp_template_create_error'),
            EColor.error
          );
          return null;
        } finally {
          this.saving = false;
        }
      },
      async viewTemplate(
        workerId: string,
        templateId: string
      ): Promise<WhatsappTemplateResponse | null> {
        try {
          this.loading = true;
          const response = await axios.get<
            IApiResponse<WhatsappTemplateResponse>
          >(`/worker/${workerId}/whatsapp-official/templates/${templateId}`);
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_view_error'),
              EColor.error
            );
            return null;
          }

          this.selected = data.data;

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(error, 'whatsapp_template_view_error'),
            EColor.error
          );
          return null;
        } finally {
          this.loading = false;
        }
      },
      async updateTemplate(
        workerId: string,
        templateId: string,
        payload: UpdateWhatsappTemplateRequest
      ): Promise<WhatsappTemplateResponse | null> {
        try {
          this.saving = true;
          const response = await axios.patch<
            IApiResponse<WhatsappTemplateResponse>
          >(
            `/worker/${workerId}/whatsapp-official/templates/${templateId}`,
            payload
          );
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_update_error'),
              EColor.error
            );
            return null;
          }

          this.showSnackbar(
            data.message ??
              this.i18n.global.t('whatsapp_template_update_success'),
            EColor.success
          );

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(error, 'whatsapp_template_update_error'),
            EColor.error
          );
          return null;
        } finally {
          this.saving = false;
        }
      },
      async deleteTemplate(
        workerId: string,
        templateId: string
      ): Promise<DeleteWhatsappTemplateResponse | null> {
        try {
          this.saving = true;
          const response = await axios.delete<
            IApiResponse<DeleteWhatsappTemplateResponse>
          >(`/worker/${workerId}/whatsapp-official/templates/${templateId}`);
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_delete_error'),
              EColor.error
            );
            return null;
          }

          this.showSnackbar(
            data.message ??
              this.i18n.global.t('whatsapp_template_delete_success'),
            EColor.success
          );

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(error, 'whatsapp_template_delete_error'),
            EColor.error
          );
          return null;
        } finally {
          this.saving = false;
        }
      },
      async deactivateTemplate(
        workerId: string,
        templateId: string
      ): Promise<DeleteWhatsappTemplateResponse | null> {
        try {
          this.saving = true;
          const response = await axios.patch<
            IApiResponse<DeleteWhatsappTemplateResponse>
          >(
            `/worker/${workerId}/whatsapp-official/templates/${templateId}/deactivate`
          );
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_deactivate_error'),
              EColor.error
            );
            return null;
          }

          this.showSnackbar(
            data.message ??
              this.i18n.global.t('whatsapp_template_deactivate_success'),
            EColor.success
          );

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(
              error,
              'whatsapp_template_deactivate_error'
            ),
            EColor.error
          );
          return null;
        } finally {
          this.saving = false;
        }
      },
      async uploadMedia(
        workerId: string,
        file: File
      ): Promise<UploadWhatsappTemplateMediaResponse | null> {
        try {
          this.uploading = true;
          const formData = new FormData();
          formData.append('file', file);

          const response = await axios.post<
            IApiResponse<UploadWhatsappTemplateMediaResponse>
          >(`/worker/${workerId}/whatsapp-official/templates/media`, formData);
          const data = response.data;

          if (!data?.status || !data.data) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('whatsapp_template_media_upload_error'),
              EColor.error
            );
            return null;
          }

          this.showSnackbar(
            data.message ??
              this.i18n.global.t('whatsapp_template_media_upload_success'),
            EColor.success
          );

          return data.data;
        } catch (error) {
          this.showSnackbar(
            this.extractErrorMessage(
              error,
              'whatsapp_template_media_upload_error'
            ),
            EColor.error
          );
          return null;
        } finally {
          this.uploading = false;
        }
      },
    },
  }
);
