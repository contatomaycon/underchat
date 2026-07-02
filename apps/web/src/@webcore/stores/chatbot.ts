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
import { CloneChatbotRequest } from '@core/schema/chatbot/cloneChatbot/request.schema';
import { CloneChatbotResponse } from '@core/schema/chatbot/cloneChatbot/response.schema';
import { UpdateChatbotRequest } from '@core/schema/chatbot/updateChatbot/request.schema';
import { UpdateChatbotResponse } from '@core/schema/chatbot/updateChatbot/response.schema';
import { ChatbotUserResponse } from '@core/schema/chatbot/listUsers/response.schema';
import { ChatbotChannelResponse } from '@core/schema/chatbot/listChannels/response.schema';
import { ChatbotSectorResponse } from '@core/schema/chatbot/listSectors/response.schema';
import { ChatbotSectorUserResponse } from '@core/schema/chatbot/listSectorUsers/response.schema';
import { ChatbotChatTagResponse } from '@core/schema/chatbot/listChatTags/response.schema';
import { ChatbotAiAgentResponse } from '@core/schema/chatbot/listAiAgents/response.schema';
import { ChatbotRandomMessageResponse } from '@core/schema/chatbot/listRandomMessages/response.schema';
import { SaveChatbotFlowResponse } from '@core/schema/chatbot/saveChatbotFlow/response.schema';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { SaveChatbotFlowConfigurationsRequest } from '@core/schema/chatbot/saveChatbotFlowConfigurations/request.schema';
import { SaveChatbotFlowConfigurationsResponse } from '@core/schema/chatbot/saveChatbotFlowConfigurations/response.schema';
import { ListChatbotFlowConfigurationsResponse } from '@core/schema/chatbot/listChatbotFlowConfigurations/response.schema';
import { OfficialCapabilitiesResponse } from '@core/schema/chatbot/officialCapabilities/response.schema';
import { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';

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

    _translateErrorMessage(backendMessage: string): string {
      if (backendMessage.includes(';')) {
        const messages = backendMessage
          .split(';')
          .map((msg: string) => msg.trim());
        const translatedMessages = messages.map((msg: string) => {
          const translation = this.i18n.global.t(msg);
          return translation === msg ? msg : translation;
        });
        return translatedMessages.join('; ');
      }

      const translation = this.i18n.global.t(backendMessage);
      return translation === backendMessage ? backendMessage : translation;
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

    async _handleGetRequest<T>(
      url: string,
      params?: Record<string, string>,
      errorKey: string = 'request_error'
    ): Promise<T | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<T>>(url, { params });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message = data?.message ?? this.i18n.global.t(errorKey);
          this.showSnackbar(message, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        const errorMessage = this._getErrorMessage(error, errorKey);
        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;
        return null;
      }
    },

    async _handleGetRequestSilent<T>(
      url: string,
      params?: Record<string, string>
    ): Promise<T | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<T>>(url, { params });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },

    async _handleGetRequestArray<T>(
      url: string,
      errorKey: string,
      params?: Record<string, string | undefined>
    ): Promise<T[]> {
      try {
        const response = await axios.get<IApiResponse<T[]>>(url, { params });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage = this.i18n.global.t(errorKey);
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async _handlePostRequest<TRequest, TResponse>(
      url: string,
      input: TRequest,
      successKey: string,
      errorKey: string
    ): Promise<TResponse | null> {
      try {
        const response = await axios.post<IApiResponse<TResponse>>(url, input);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message = data?.message ?? this.i18n.global.t(errorKey);
          this.showSnackbar(message, EColor.error);
          return null;
        }

        const successMessage = this.i18n.global.t(successKey);
        this.showSnackbar(successMessage, EColor.success);

        return data.data;
      } catch (error) {
        const errorMessage = this._getErrorMessage(error, errorKey);
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },

    async _handlePutRequest<TRequest, TResponse>(
      url: string,
      input: TRequest,
      successKey: string,
      errorKey: string
    ): Promise<TResponse | null> {
      try {
        const response = await axios.put<IApiResponse<TResponse>>(url, input);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message = data?.message ?? this.i18n.global.t(errorKey);
          this.showSnackbar(message, EColor.error);
          return null;
        }

        const successMessage = this.i18n.global.t(successKey);
        this.showSnackbar(successMessage, EColor.success);

        return data.data;
      } catch (error) {
        const errorMessage = this._getErrorMessage(error, errorKey);
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },

    async _handlePostRequestWithLoading<TRequest, TResponse>(
      url: string,
      input: TRequest,
      successKey: string,
      errorKey: string
    ): Promise<TResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<TResponse>>(url, input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message = data?.message ?? this.i18n.global.t(errorKey);
          this.showSnackbar(message, EColor.error);
          return null;
        }

        if (!data?.data) {
          const message = data?.message ?? this.i18n.global.t(errorKey);
          this.showSnackbar(message, EColor.error);
          return null;
        }

        const successMessage = this.i18n.global.t(successKey);
        this.showSnackbar(successMessage, EColor.success);

        return data.data;
      } catch (error) {
        const errorMessage = this._getErrorMessage(error, errorKey);
        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;
        return null;
      }
    },

    async _handlePostRequestWithComplexError<TRequest, TResponse>(
      url: string,
      input: TRequest,
      successKey: string,
      errorKey: string
    ): Promise<TResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<TResponse>>(url, input);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message = data?.message ?? this.i18n.global.t(errorKey);
          this.showSnackbar(message, EColor.error);
          return null;
        }

        const successMessage = this.i18n.global.t(successKey);
        this.showSnackbar(successMessage, EColor.success);

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(errorKey);
        if (error instanceof AxiosError) {
          const backendMessage = error?.response?.data?.message;
          if (!backendMessage) {
            this.showSnackbar(errorMessage, EColor.error);
            this.loading = false;
            return null;
          }

          errorMessage = this._translateErrorMessage(backendMessage);
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;
        return null;
      }
    },

    async listChatbots(): Promise<ListChatbotResponse[] | null> {
      const result = await this._handleGetRequest<ListChatbotResponse[]>(
        '/chatbot',
        undefined,
        'chatbot_list_error'
      );

      if (result) {
        this.list = result;
      }

      return result;
    },

    async createChatbot(
      input: CreateChatbotRequest
    ): Promise<CreateChatbotResponse | null> {
      return this._handlePostRequest<
        CreateChatbotRequest,
        CreateChatbotResponse
      >('/chatbot', input, 'chatbot_creator_success', 'chatbot_creator_error');
    },

    async cloneChatbot(
      input: CloneChatbotRequest
    ): Promise<CloneChatbotResponse | null> {
      return this._handlePostRequest<CloneChatbotRequest, CloneChatbotResponse>(
        '/chatbot/clone',
        input,
        'chatbot_cloner_success',
        'chatbot_cloner_error'
      );
    },

    async updateChatbot(
      chatbotId: string,
      input: UpdateChatbotRequest
    ): Promise<UpdateChatbotResponse | null> {
      return this._handlePutRequest<
        UpdateChatbotRequest,
        UpdateChatbotResponse
      >(
        `/chatbot/${chatbotId}`,
        input,
        'chatbot_update_success',
        'chatbot_update_error'
      );
    },

    async listChatbotUsers(channelId?: string): Promise<ChatbotUserResponse[]> {
      return this._handleGetRequestArray<ChatbotUserResponse>(
        '/chatbot/users',
        'error_loading_chatbot_users',
        {
          channel_id: channelId ?? undefined,
        }
      );
    },

    async listChatbotChannels(): Promise<ChatbotChannelResponse[]> {
      return this._handleGetRequestArray<ChatbotChannelResponse>(
        '/chatbot/channels',
        'error_loading_transfer_options'
      );
    },

    async listChatbotSectors(): Promise<ChatbotSectorResponse[]> {
      return this._handleGetRequestArray<ChatbotSectorResponse>(
        '/chatbot/sectors',
        'error_loading_chatbot_sectors'
      );
    },

    async listChatbotSectorUsers(
      sectorId: string,
      channelId?: string
    ): Promise<ChatbotSectorUserResponse[]> {
      return this._handleGetRequestArray<ChatbotSectorUserResponse>(
        `/chatbot/sectors/${sectorId}/users`,
        'error_loading_chatbot_sector_users',
        {
          channel_id: channelId ?? undefined,
        }
      );
    },

    async listChatbotTags(): Promise<ChatbotChatTagResponse[]> {
      return this._handleGetRequestArray<ChatbotChatTagResponse>(
        '/chatbot/tags',
        'error_loading_chatbot_tags'
      );
    },

    async listChatbotAiAgents(): Promise<ChatbotAiAgentResponse[]> {
      return this._handleGetRequestArray<ChatbotAiAgentResponse>(
        '/chatbot/ai-agents',
        'error_loading_chatbot_ai_agents'
      );
    },

    async listChatbotRandomMessages(): Promise<ChatbotRandomMessageResponse[]> {
      return this._handleGetRequestArray<ChatbotRandomMessageResponse>(
        '/chatbot/random-messages',
        'error_loading_chatbot_random_messages'
      );
    },

    async saveChatbotFlow(
      formData: FormData
    ): Promise<SaveChatbotFlowResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<SaveChatbotFlowResponse>
        >('/chatbot/flow', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_flow_save_error');
          this.showSnackbar(message, EColor.error);
          return null;
        }

        const successMessage = this.i18n.global.t('chatbot_flow_save_success');
        this.showSnackbar(successMessage, EColor.success);

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('chatbot_flow_save_error');
        if (error instanceof AxiosError) {
          const backendMessage = error?.response?.data?.message;
          if (!backendMessage) {
            this.showSnackbar(errorMessage, EColor.error);
            this.loading = false;
            return null;
          }

          errorMessage = this._translateErrorMessage(backendMessage);
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;
        return null;
      }
    },

    async listChatbotFlow(
      chatbotId: string
    ): Promise<ListChatbotFlowResponse | null> {
      return this._handleGetRequestSilent<ListChatbotFlowResponse>(
        '/chatbot/flow',
        { chatbot_id: chatbotId }
      );
    },

    async listOfficialCapabilities(
      chatbotId: string
    ): Promise<OfficialCapabilitiesResponse | null> {
      return this._handleGetRequestSilent<OfficialCapabilitiesResponse>(
        '/chatbot/official-capabilities',
        { chatbot_id: chatbotId }
      );
    },

    async listOfficialTemplates(
      chatbotId: string
    ): Promise<OfficialTemplatesResponse | null> {
      return this._handleGetRequestSilent<OfficialTemplatesResponse>(
        '/chatbot/official-templates',
        { chatbot_id: chatbotId }
      );
    },

    async saveChatbotFlowConfigurations(
      input: SaveChatbotFlowConfigurationsRequest
    ): Promise<SaveChatbotFlowConfigurationsResponse | null> {
      return this._handlePostRequestWithLoading<
        SaveChatbotFlowConfigurationsRequest,
        SaveChatbotFlowConfigurationsResponse
      >(
        '/chatbot/flow/configurations',
        input,
        'chatbot_flow_configurations_save_success',
        'chatbot_flow_configurations_save_error'
      );
    },

    async listChatbotFlowConfigurations(
      chatbotId: string
    ): Promise<ListChatbotFlowConfigurationsResponse | null> {
      return this._handleGetRequestSilent<ListChatbotFlowConfigurationsResponse>(
        '/chatbot/flow/configurations',
        { chatbot_id: chatbotId }
      );
    },

    async deleteChatbot(chatbotId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/chatbot/${chatbotId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_deleter_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('chatbot_deleted_successfully'),
          EColor.success
        );

        await this.listChatbots();

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('chatbot_deleter_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },
  },
});
