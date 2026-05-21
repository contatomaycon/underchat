import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { CreateLocalHolidayRequest } from '@core/schema/chatbot/createLocalHoliday/request.schema';
import { ListNationalHolidaysResponse } from '@core/schema/chatbot/listNationalHolidays/response.schema';
import { ListLocalHolidaysResponse } from '@core/schema/chatbot/listLocalHolidays/response.schema';

export const useHolidayStore = defineStore('holiday', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
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

    _translateMessageIfExists(message: string): string {
      const trimmedMessage = message.trim();

      if (!trimmedMessage) {
        return trimmedMessage;
      }

      return this.i18n.global.te(trimmedMessage)
        ? this.i18n.global.t(trimmedMessage)
        : trimmedMessage;
    },

    _translateErrorMessage(backendMessage: string): string {
      if (backendMessage.includes(';')) {
        const messages = backendMessage
          .split(';')
          .map((msg: string) => msg.trim())
          .filter(Boolean);
        const translatedMessages = messages.map((msg: string) =>
          this._translateMessageIfExists(msg)
        );
        return translatedMessages.join('; ');
      }

      return this._translateMessageIfExists(backendMessage);
    },

    _getErrorMessage(error: unknown, defaultKey: string): string {
      if (!(error instanceof AxiosError)) {
        return this.i18n.global.t(defaultKey);
      }

      const backendMessage = error?.response?.data?.message;
      if (!backendMessage) {
        return this.i18n.global.t(defaultKey);
      }

      return this._translateErrorMessage(backendMessage);
    },

    async listNationalHolidays(
      year: number
    ): Promise<ListNationalHolidaysResponse> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListNationalHolidaysResponse>
        >('/chatbot/holidays/national', {
          params: {
            year,
          },
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch (error) {
        const errorMessage = this._getErrorMessage(
          error,
          'chatbot_holiday_national_list_error'
        );
        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return [];
      }
    },

    async listLocalHolidays(): Promise<ListLocalHolidaysResponse> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListLocalHolidaysResponse>
        >('/chatbot/holidays/local');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch (error) {
        const errorMessage = this._getErrorMessage(
          error,
          'chatbot_holiday_local_list_error'
        );
        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return [];
      }
    },

    async createLocalHoliday(
      input: CreateLocalHolidayRequest
    ): Promise<string | null> {
      try {
        const response = await axios.post<
          IApiResponse<{ chatbot_holiday_id: string }>
        >('/chatbot/holidays/local', input);

        const data = response?.data;

        if (!data?.status || !data?.data?.chatbot_holiday_id) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_holiday_create_error');
          this.showSnackbar(message, EColor.error);
          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('chatbot_holiday_created_successfully'),
          EColor.success
        );

        return data.data.chatbot_holiday_id;
      } catch (error) {
        const errorMessage = this._getErrorMessage(
          error,
          'chatbot_holiday_create_error'
        );
        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async updateLocalHoliday(
      chatbotHolidayId: string,
      input: CreateLocalHolidayRequest
    ): Promise<boolean> {
      try {
        const response = await axios.patch<IApiResponse<boolean>>(
          `/chatbot/holidays/local/${chatbotHolidayId}`,
          input
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_holiday_update_error');
          this.showSnackbar(message, EColor.error);
          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('chatbot_holiday_updated_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        const errorMessage = this._getErrorMessage(
          error,
          'chatbot_holiday_update_error'
        );
        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async deleteLocalHoliday(chatbotHolidayId: string): Promise<boolean> {
      try {
        const response = await axios.delete<IApiResponse<boolean>>(
          `/chatbot/holidays/local/${chatbotHolidayId}`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_holiday_delete_error');
          this.showSnackbar(message, EColor.error);
          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('chatbot_holiday_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        const errorMessage = this._getErrorMessage(
          error,
          'chatbot_holiday_delete_error'
        );
        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },
  },
});
