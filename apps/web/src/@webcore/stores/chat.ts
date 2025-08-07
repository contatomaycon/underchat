import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { IPagingElastic } from '@core/common/interfaces/IPagingElastic';
import { ListChatsResponse } from '@core/schema/chat/listChats/response.schema';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { Promise } from '@sinclair/typebox';

export const useChatStore = defineStore('chat', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    activeChat: {} as ListChatsResponse,
    listQueue: [] as ListChatsResponse[],
    listInChat: [] as ListChatsResponse[],
    pagings: {
      from: 0,
      size: 100,
    } as IPagingElastic,
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
    async listQueueChats(input: ListChatsQuery): Promise<ListChatsResponse[]> {
      try {
        this.loading = true;

        const request: ListChatsQuery = {
          from: input.from,
          size: input.size,
          status: input.status,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse[]>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data as IApiResponse<ListChatsResponse[]>;

        if (!data?.status || !data?.data) {
          this.listQueue = [];

          return [] as ListChatsResponse[];
        }

        this.listQueue = data.data;

        return data.data;
      } catch {
        this.listQueue = [];

        return [] as ListChatsResponse[];
      }
    },

    async listInChatChats(input: ListChatsQuery): Promise<ListChatsResponse[]> {
      try {
        this.loading = true;

        const request: ListChatsQuery = {
          from: input.from,
          size: input.size,
          status: input.status,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse[]>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data as IApiResponse<ListChatsResponse[]>;

        if (!data?.status || !data?.data) {
          this.listInChat = [];

          return [] as ListChatsResponse[];
        }

        this.listInChat = data.data;

        return data.data;
      } catch {
        this.listInChat = [];

        return [] as ListChatsResponse[];
      }
    },

    async updateChatsUser(input: UpdateChatsUserRequest): Promise<void> {
      try {
        this.loading = true;

        const response = await axios.put<IApiResponse<null>>(
          `/chat/user`,
          input
        );

        this.loading = false;

        const data = response?.data as IApiResponse<null>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return;
        }

        this.showSnackbar(this.i18n.t('chat.updateSuccess'), EColor.success);
      } catch {
        this.loading = false;

        this.showSnackbar(this.i18n.t('chat.updateError'), EColor.error);
      }
    },
  },
});
