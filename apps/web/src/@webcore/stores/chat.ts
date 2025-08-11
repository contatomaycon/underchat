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
import { getUser, setUser } from '../localStorage/user';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import { ListMessageResponse } from '@core/schema/chat/listMessageChats/response.schema';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';

export const useChatStore = defineStore('chat', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    activeChat: null as ListChatsResponse | null,
    listMessages: [] as ListMessageResponse[],
    listQueue: [] as ListChatsResponse[],
    listInChat: [] as ListChatsResponse[],
    user: getUser(),
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
    addMessageActiveChat(message: IChatMessage) {
      const input: ListMessageResponse = {
        message_id: message.message_id,
        chat_id: message.chat_id,
        type_user: message.type_user,
        user: message.user,
        content: message.content,
        summary: message.summary,
        date: message.date,
      };

      this.listMessages.push(input);
    },
    addChat(chat: IChat) {
      const input: ListChatsResponse = {
        chat_id: chat.chat_id,
        summary: chat.summary,
        account: chat.account,
        worker: chat.worker,
        sector: chat.sector,
        user: chat.user,
        contact: chat.contact,
        photo: chat.photo,
        name: chat.name,
        phone: chat.phone,
        status: chat.status,
        date: chat.date,
      };

      if (chat.status === EChatStatus.queue) {
        this.listQueue.push(input);
      }

      if (chat.status === EChatStatus.in_chat) {
        this.listInChat.push(input);
      }
    },
    updateChatUserImmediate() {
      if (!this.user?.status) return;

      const chatUserUpdate = {
        chat_user_id: this.user?.chat_user?.chat_user_id ?? '',
        status: this.user?.chat_user?.status as EChatUserStatus,
        about: this.user?.chat_user?.about ?? '',
        notifications: this.user?.chat_user?.notifications ?? false,
      };

      setUser({ ...this.user, chat_user: chatUserUpdate });
      this.user.chat_user = chatUserUpdate as AuthUserResponse['chat_user'];
    },

    async updateChatUserDebounce() {
      if (!this.user?.status) return;

      const chatUserUpdate = {
        chat_user_id: this.user?.chat_user?.chat_user_id ?? '',
        status: this.user?.chat_user?.status as EChatUserStatus,
        about: this.user?.chat_user?.about ?? '',
        notifications: this.user?.chat_user?.notifications ?? false,
      };

      await this.updateChatsUser({
        about: chatUserUpdate.about,
        status: chatUserUpdate.status,
        notifications: chatUserUpdate.notifications,
      });
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
      } catch {
        this.loading = false;

        this.showSnackbar(
          this.i18n.global.t('chat_config_update_error'),
          EColor.error
        );
      }
    },

    async getChatById(query: ListMessageChatsQuery): Promise<void> {
      try {
        this.loading = true;
        this.listMessages = [];

        const response = await axios.get<IApiResponse<ListMessageResponse[]>>(
          `/chat/${this.activeChat?.chat_id}`,
          {
            params: query,
          }
        );

        const data = response?.data as IApiResponse<ListMessageResponse[]>;

        if (!data?.status || !data?.data) {
          this.listMessages = [];
          this.loading = false;

          return;
        }

        this.loading = false;

        this.listMessages = data.data;
      } catch {
        this.loading = false;
        this.listMessages = [];

        return;
      }
    },

    async createMessage(input: CreateMessageChatsBody): Promise<void> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          input
        );

        this.loading = false;

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return;
        }
      } catch {
        this.loading = false;

        this.showSnackbar(
          this.i18n.global.t('chat_message_create_error'),
          EColor.error
        );
      }
    },

    setActiveChat(chatId: string): void {
      this.activeChat = {} as ListChatsResponse;

      const chat = (this.listQueue.find((c) => c.chat_id === chatId) ||
        this.listInChat.find((c) => c.chat_id === chatId)) as ListChatsResponse;

      if (!chat.chat_id) {
        return;
      }

      this.activeChat = chat;
    },
  },
});
