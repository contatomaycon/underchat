import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';
import { CreateChatbotRequest } from '@core/schema/chatbot/createChatbot/request.schema';
import { CreateChatbotResponse } from '@core/schema/chatbot/createChatbot/response.schema';
import { ChatbotUserResponse } from '@core/schema/chatbot/listUsers/response.schema';
import { ChatbotSectorResponse } from '@core/schema/chatbot/listSectors/response.schema';
import { ChatbotSectorUserResponse } from '@core/schema/chatbot/listSectorUsers/response.schema';
import { ChatbotChatTagResponse } from '@core/schema/chatbot/listChatTags/response.schema';

export const useChatbotStore = defineStore('chatbot', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListChatbotResponse[],
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

    async listChatbots(): Promise<ListChatbotResponse[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListChatbotResponse[]>>('/chatbot');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.list = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('chatbot_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async createChatbot(
      input: CreateChatbotRequest
    ): Promise<CreateChatbotResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<CreateChatbotResponse>>(
          '/chatbot',
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_creator_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        const successMessage =
          this.i18n.global.t('chatbot_creator_success') ||
          'Chatbot criado com sucesso';
        this.showSnackbar(successMessage, EColor.success);

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('chatbot_creator_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listChatbotUsers(): Promise<ChatbotUserResponse[]> {
      try {
        const response =
          await axios.get<IApiResponse<ChatbotUserResponse[]>>(
            '/chatbot/users'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('error_loading_chatbot_users') ||
          'Erro ao carregar usuários do chatbot';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listChatbotSectors(): Promise<ChatbotSectorResponse[]> {
      try {
        const response =
          await axios.get<IApiResponse<ChatbotSectorResponse[]>>(
            '/chatbot/sectors'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('error_loading_chatbot_sectors') ||
          'Erro ao carregar setores do chatbot';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listChatbotSectorUsers(
      sectorId: string
    ): Promise<ChatbotSectorUserResponse[]> {
      try {
        const response = await axios.get<
          IApiResponse<ChatbotSectorUserResponse[]>
        >(`/chatbot/sectors/${sectorId}/users`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('error_loading_chatbot_sector_users') ||
          'Erro ao carregar usuários do setor do chatbot';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listChatbotTags(): Promise<ChatbotChatTagResponse[]> {
      try {
        const response =
          await axios.get<IApiResponse<ChatbotChatTagResponse[]>>(
            '/chatbot/tags'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('error_loading_chatbot_tags') ||
          'Erro ao carregar etiquetas do chatbot';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },
  },
});
