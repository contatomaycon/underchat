import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import {
  ListChatsResponse,
  ListChatsResult,
} from '@core/schema/chat/listChats/response.schema';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { getUser, setUser } from '../localStorage/user';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import {
  ContentMessageChat,
  ListMessageResponse,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ViewLinkPreviewBody } from '@core/schema/chat/viewLinkPreview/request.schema';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';

export const useChatStore = defineStore('chat', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    loadingMoreMessages: false,
    activeChat: null as ListChatsResult | null,
    listMessages: [] as ListMessageResult[],
    listQueue: [] as ListChatsResult[],
    listInChat: [] as ListChatsResult[],
    messageReply: null as ListMessageResult | null,
    user: getUser(),
    currentPage: 1,
    totalPages: 1,
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
      const input: ListMessageResult = {
        message_id: message.message_id,
        chat_id: message.chat_id,
        message_key: message.message_key,
        type_user: message.type_user,
        user: message.user,
        content: message.content as ContentMessageChat,
        summary: message.summary,
        date: message.date,
      };

      const existingIndex = this.listMessages.findIndex(
        (item) => item.message_id === input.message_id
      );

      if (existingIndex !== -1) {
        this.listMessages.splice(existingIndex, 1, input);

        return;
      }

      this.listMessages.push(input);
    },
    addChat(chat: IChat) {
      const input: ListChatsResult = {
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

      const replaceOrPush = (arr: ListChatsResult[]) => {
        const idx = arr.findIndex((c) => c.chat_id === input.chat_id);

        if (idx !== -1) {
          arr.splice(idx, 1, input);

          return;
        }

        arr.push(input);
      };

      if (chat.status === EChatStatus.queue) {
        replaceOrPush(this.listQueue);

        return;
      }

      if (chat.status === EChatStatus.in_chat) {
        replaceOrPush(this.listInChat);
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

    async listQueueChats(input: ListChatsQuery): Promise<ListChatsResult[]> {
      try {
        this.loading = true;

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data as IApiResponse<ListChatsResponse>;

        if (!data?.status || !data?.data) {
          this.listQueue = [];

          return [] as ListChatsResult[];
        }

        this.listQueue = data.data.results;

        return data.data.results;
      } catch {
        this.listQueue = [];

        return [] as ListChatsResult[];
      }
    },

    async listInChatChats(input: ListChatsQuery): Promise<ListChatsResult[]> {
      try {
        this.loading = true;

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data as IApiResponse<ListChatsResponse>;

        if (!data?.status || !data?.data) {
          this.listInChat = [];

          return [] as ListChatsResult[];
        }

        this.listInChat = data.data.results;

        return data.data.results;
      } catch {
        this.listInChat = [];

        return [] as ListChatsResult[];
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
        this.currentPage = 1;

        const response = await axios.get<IApiResponse<ListMessageResponse>>(
          `/chat/${this.activeChat?.chat_id}`,
          {
            params: query,
          }
        );

        const data = response?.data as IApiResponse<ListMessageResponse>;

        if (!data?.status || !data?.data) {
          this.listMessages = [];
          this.loading = false;

          return;
        }

        this.loading = false;

        this.listMessages = [...data.data.results].reverse();
        this.currentPage = data.data.pagings.current_page;
        this.totalPages = data.data.pagings.total_pages;
      } catch {
        this.loading = false;
        this.listMessages = [];

        return;
      }
    },

    async loadMoreMessages(): Promise<boolean> {
      if (
        this.loadingMoreMessages ||
        this.currentPage >= this.totalPages
      ) {
        return false;
      }

      try {
        this.loadingMoreMessages = true;

        const response = await axios.get<IApiResponse<ListMessageResponse>>(
          `/chat/${this.activeChat?.chat_id}`,
          {
            params: {
              current_page: this.currentPage + 1,
              per_page: 10,
            },
          }
        );

        const data = response?.data as IApiResponse<ListMessageResponse>;

        if (!data?.status || !data?.data) {
          this.loadingMoreMessages = false;

          return false;
        }

        this.currentPage = data.data.pagings.current_page;
        this.listMessages = [...data.data.results.reverse(), ...this.listMessages];
        this.loadingMoreMessages = false;

        return true;
      } catch {
        this.loadingMoreMessages = false;

        return false;
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

    async createMessageWithImages(formData: FormData): Promise<void> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          }
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

    async generateLinkPreview(
      input: ViewLinkPreviewBody
    ): Promise<ViewLinkPreviewResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<ViewLinkPreviewResponse>
        >(`/chat/link-preview`, input);

        this.loading = false;

        const data = response?.data as IApiResponse<ViewLinkPreviewResponse>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return null;
        }

        return data.data;
      } catch {
        this.loading = false;

        this.showSnackbar(
          this.i18n.global.t('chat_message_create_error'),
          EColor.error
        );

        return null;
      }
    },

    setActiveChat(chatId: string): void {
      this.activeChat = {} as ListChatsResult;

      const chat = (this.listQueue.find((c) => c.chat_id === chatId) ??
        this.listInChat.find((c) => c.chat_id === chatId)) as ListChatsResult;

      if (!chat.chat_id) {
        return;
      }

      this.activeChat = chat;
    },

    setMessageReply(m: ListMessageResult) {
      this.messageReply = m;
    },

    clearMessageReply() {
      this.messageReply = null;
    },

    async reactToMessage(
      chatId: string,
      messageId: string,
      emoji: string
    ): Promise<boolean> {
      try {
        const response = await axios.post(
          `/chat/${chatId}/message/${messageId}/react`,
          { emoji }
        );

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
  },
});
