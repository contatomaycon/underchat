import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListReportConversationHistoryFinalResponse,
  ReportConversationHistoryResult,
} from '@core/schema/reportConversationHistory/listReportConversationHistory/response.schema';
import { ListReportConversationHistoryRequest } from '@core/schema/reportConversationHistory/listReportConversationHistory/request.schema';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { ListReportConversationHistorySectorsResponse } from '@core/schema/reportConversationHistory/listReportConversationHistorySectors/response.schema';
import { ListReportConversationHistoryUsersResponse } from '@core/schema/reportConversationHistory/listReportConversationHistoryUsers/response.schema';
import { ListReportConversationHistoryMessagesResponse } from '@core/schema/reportConversationHistory/listReportConversationHistoryMessages/response.schema';
import { ViewReportConversationHistoryContactResponse } from '@core/schema/reportConversationHistory/viewReportConversationHistoryContact/response.schema';

export const useReportConversationHistoryStore = defineStore(
  'reportConversationHistory',
  {
    state: () => ({
      snackbar: {
        color: EColor.success,
        message: '',
        status: false,
      } as ISnackbar,
      i18n: getI18n(),
      loading: false,
      list: [] as ReportConversationHistoryResult[],
      pagings: {
        current_page: 1,
        per_page: 10,
        total_pages: 1,
        total: 0,
        count: 0,
      } as PagingResponseSchema,
      sectors: [] as ListReportConversationHistorySectorsResponse['sectors'],
      users: [] as ListReportConversationHistoryUsersResponse['users'],
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
      async listReportConversationHistory(
        input: ListReportConversationHistoryRequest
      ): Promise<ListReportConversationHistoryFinalResponse | null> {
        try {
          this.loading = true;

          const response = await axios.get<
            IApiResponse<ListReportConversationHistoryFinalResponse>
          >('/report-conversation-history', {
            params: input,
          });

          this.loading = false;

          const data = response?.data;

          if (!data?.status || !data?.data) {
            const message =
              data?.message ??
              this.i18n.global.t('report_conversation_history_list_error');

            this.showSnackbar(message, EColor.error);

            return null;
          }

          this.list = data.data.results;
          this.pagings = data.data.pagings;

          return data.data;
        } catch (error) {
          let errorMessage = this.i18n.global.t(
            'report_conversation_history_list_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);

          this.loading = false;

          return null;
        }
      },
      async listReportConversationHistorySectors(): Promise<
        ListReportConversationHistorySectorsResponse['sectors'] | null
      > {
        try {
          const response = await axios.get<
            IApiResponse<ListReportConversationHistorySectorsResponse>
          >('/report-conversation-history/sectors');

          const data = response?.data;

          if (!data?.status || !data?.data) {
            const message =
              data?.message ??
              this.i18n.global.t(
                'report_conversation_history_sectors_list_error'
              );

            this.showSnackbar(message, EColor.error);

            return null;
          }

          this.sectors = data.data.sectors;

          return data.data.sectors;
        } catch (error) {
          let errorMessage = this.i18n.global.t(
            'report_conversation_history_sectors_list_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);

          return null;
        }
      },
      async listReportConversationHistoryUsers(): Promise<
        ListReportConversationHistoryUsersResponse['users'] | null
      > {
        try {
          const response = await axios.get<
            IApiResponse<ListReportConversationHistoryUsersResponse>
          >('/report-conversation-history/users');

          const data = response?.data;

          if (!data?.status || !data?.data) {
            const message =
              data?.message ??
              this.i18n.global.t(
                'report_conversation_history_users_list_error'
              );

            this.showSnackbar(message, EColor.error);

            return null;
          }

          this.users = data.data.users;

          return data.data.users;
        } catch (error) {
          let errorMessage = this.i18n.global.t(
            'report_conversation_history_users_list_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);

          return null;
        }
      },
      async listReportConversationHistoryMessages(
        chatId: string
      ): Promise<ListReportConversationHistoryMessagesResponse | null> {
        try {
          const response = await axios.get<
            IApiResponse<ListReportConversationHistoryMessagesResponse>
          >(`/report-conversation-history/${chatId}/messages`);

          const data = response?.data;

          if (!data?.status || !data?.data) {
            const message =
              data?.message ??
              this.i18n.global.t(
                'report_conversation_history_messages_list_error'
              );

            this.showSnackbar(message, EColor.error);

            return null;
          }

          return data.data;
        } catch (error) {
          let errorMessage = this.i18n.global.t(
            'report_conversation_history_messages_list_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);

          return null;
        }
      },
      async getReportConversationHistoryContact(
        contactId: string
      ): Promise<ViewReportConversationHistoryContactResponse | null> {
        try {
          const response = await axios.get<
            IApiResponse<ViewReportConversationHistoryContactResponse>
          >(`/report-conversation-history/contacts/${contactId}`);

          const data = response?.data;

          if (!data?.status || !data?.data) {
            const message =
              data?.message ?? this.i18n.global.t('contact_not_found');

            this.showSnackbar(message, EColor.error);

            return null;
          }

          return data.data;
        } catch (error) {
          let errorMessage = this.i18n.global.t('contact_not_found');
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);

          return null;
        }
      },
      async getReportConversationHistoryContactEmailDecrypted(
        contactId: string
      ): Promise<string | null> {
        try {
          const response = await axios.get<IApiResponse<{ email: string }>>(
            `/report-conversation-history/contacts/${contactId}/email`
          );

          const data = response?.data;

          if (!data?.status || !data?.data) {
            return null;
          }

          return data.data.email;
        } catch {
          return null;
        }
      },
      async getReportConversationHistoryContactPhoneDecrypted(
        contactId: string
      ): Promise<string | null> {
        try {
          const response = await axios.get<IApiResponse<{ phone: string }>>(
            `/report-conversation-history/contacts/${contactId}/phone`
          );

          const data = response?.data;

          if (!data?.status || !data?.data) {
            return null;
          }

          return data.data.phone;
        } catch {
          return null;
        }
      },
      async generateReportConversationHistoryPdf(
        chatId: string
      ): Promise<{ pdf_id: string; status: string } | null> {
        try {
          const response = await axios.post<
            IApiResponse<{ pdf_id: string; status: string }>
          >(`/report-conversation-history/${chatId}/pdf`);

          const data = response?.data;

          if (!data?.status || !data?.data) {
            const message =
              data?.message ??
              this.i18n.global.t(
                'report_conversation_history_pdf_generation_error'
              );

            this.showSnackbar(message, EColor.error);

            return null;
          }

          return data.data;
        } catch (error) {
          let errorMessage = this.i18n.global.t(
            'report_conversation_history_pdf_generation_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);

          return null;
        }
      },
      async viewReportConversationHistoryPdf(chatId: string): Promise<{
        pdf_id: string;
        url_pdf: string | null;
        status: string;
        requested_at: string | null;
        generated_at: string | null;
      } | null> {
        try {
          const response = await axios.get<
            IApiResponse<{
              pdf_id: string;
              url_pdf: string | null;
              status: string;
              requested_at: string | null;
              generated_at: string | null;
            }>
          >(`/report-conversation-history/${chatId}/pdf`);

          const data = response?.data;

          if (!data?.status || !data?.data) {
            return null;
          }

          return data.data;
        } catch {
          return null;
        }
      },
      async downloadReportConversationHistoryPdf(
        chatId: string
      ): Promise<void> {
        try {
          const response = await axios.get(
            `/report-conversation-history/${chatId}/pdf/download`,
            {
              responseType: 'blob',
            }
          );

          const blob = new Blob([response.data], { type: 'application/pdf' });
          const url = globalThis.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `conversation-history-${chatId}.pdf`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          globalThis.URL.revokeObjectURL(url);
        } catch (error) {
          let errorMessage = this.i18n.global.t(
            'report_conversation_history_pdf_download_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);
        }
      },
      async deleteReportConversationHistoryPdf(
        chatId: string
      ): Promise<boolean> {
        try {
          const response = await axios.delete<
            IApiResponse<{ deleted: boolean }>
          >(`/report-conversation-history/${chatId}/pdf`);

          const data = response?.data;

          if (!data?.status || !data?.data) {
            const message =
              data?.message ??
              this.i18n.global.t(
                'report_conversation_history_pdf_delete_error'
              );

            this.showSnackbar(message, EColor.error);

            return false;
          }

          this.showSnackbar(
            this.i18n.global.t(
              'report_conversation_history_pdf_deleted_successfully'
            ),
            EColor.success
          );

          return true;
        } catch (error) {
          let errorMessage = this.i18n.global.t(
            'report_conversation_history_pdf_delete_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);

          return false;
        }
      },
    },
  }
);
