import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { isAxiosError, type AxiosRequestConfig } from 'axios';
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
import { EMessageType } from '@core/common/enums/EMessageType';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ViewLinkPreviewBody } from '@core/schema/chat/viewLinkPreview/request.schema';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';

type LocalMessageState = {
  status: 'uploading' | 'error';
  progress: number;
  errorMessage?: string;
};

type UploadOptions = {
  onUploadProgress?: (progress: number) => void;
  skipLoading?: boolean;
};

const revokeIfBlob = (url?: string | null) => {
  if (url && typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};

const cleanupMessageMedia = (message?: ListMessageResult) => {
  if (!message?.content) return;
  revokeIfBlob(message.content.image?.url ?? undefined);
  revokeIfBlob(message.content.video?.url ?? undefined);
  revokeIfBlob(message.content.audio?.url ?? undefined);
  revokeIfBlob(message.content.document?.url ?? undefined);
};

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
    localMessageState: {} as Record<string, LocalMessageState>,
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
    updateUser() {
      this.user = getUser();
    },
    clearUser() {
      this.user = null;
    },
    initializeLocalMessageState(hash: string) {
      if (!hash) return;
      this.localMessageState[hash] = {
        status: 'uploading',
        progress: 0,
      };
    },
    updateLocalMessageProgress(hash: string, progress: number) {
      if (!hash) return;
      const target = this.localMessageState[hash];
      if (!target) return;
      target.progress = Math.max(0, Math.min(progress, 100));
    },
    markLocalMessageError(hash: string, errorMessage?: string) {
      if (!hash) return;
      const target = this.localMessageState[hash];
      if (!target) {
        this.localMessageState[hash] = {
          status: 'error',
          progress: 0,
          errorMessage,
        };
        return;
      }
      target.status = 'error';
      target.errorMessage = errorMessage;
    },
    clearLocalMessageState(hash?: string | null) {
      if (!hash) return;
      delete this.localMessageState[hash];
    },
    upsertLocalMessage(message: ListMessageResult) {
      if (!message.hash) {
        this.listMessages.push(message);
        return;
      }

      const idx = this.listMessages.findIndex(
        (item) => item.hash === message.hash
      );
      if (idx !== -1) {
        cleanupMessageMedia(this.listMessages[idx]);
        this.listMessages.splice(idx, 1, message);
        return;
      }
      this.listMessages.push(message);
    },
    removeMessageByHash(hash: string) {
      if (!hash) return;
      const idx = this.listMessages.findIndex((item) => item.hash === hash);
      if (idx !== -1) {
        const [removed] = this.listMessages.splice(idx, 1);
        cleanupMessageMedia(removed);
      }
      this.clearLocalMessageState(hash);
    },
    addMessageActiveChat(message: IChatMessage): 'created' | 'updated' {
      const input: ListMessageResult = {
        message_id: message.message_id,
        chat_id: message.chat_id,
        message_key: message.message_key,
        type_user: message.type_user,
        user: message.user,
        content: message.content as ContentMessageChat,
        summary: message.summary,
        date: message.date,
        deleted: message.deleted ?? false,
        has_quoted: message.has_quoted ?? false,
        hash: message.hash ?? null,
      };

      let existingIndex = -1;
      if (message.hash) {
        existingIndex = this.listMessages.findIndex(
          (item) => item.hash === message.hash
        );
      }

      if (existingIndex === -1) {
        existingIndex = this.listMessages.findIndex(
          (item) => item.message_id === input.message_id
        );
      }

      if (existingIndex !== -1) {
        const [removed] = this.listMessages.splice(existingIndex, 1, input);
        cleanupMessageMedia(removed);
        if (message.hash) {
          this.clearLocalMessageState(message.hash);
        }
        return 'updated';
      }

      this.listMessages.push(input);
      if (message.hash) {
        this.clearLocalMessageState(message.hash);
      }
      return 'created';
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
      if (this.loadingMoreMessages || this.currentPage >= this.totalPages) {
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
        this.listMessages = [
          ...data.data.results.reverse(),
          ...this.listMessages,
        ];
        this.loadingMoreMessages = false;

        return true;
      } catch {
        this.loadingMoreMessages = false;

        return false;
      }
    },

    async createMessage(input: CreateMessageChatsBody): Promise<boolean> {
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

          return false;
        }

        return true;
      } catch {
        this.loading = false;

        this.showSnackbar(
          this.i18n.global.t('chat_message_create_error'),
          EColor.error
        );

        return false;
      }
    },

    async createMessageWithImages(
      formData: FormData,
      options?: UploadOptions
    ): Promise<boolean> {
      const shouldHandleLoading = !options?.skipLoading;

      try {
        if (shouldHandleLoading) {
          this.loading = true;
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        if (options?.onUploadProgress) {
          config.onUploadProgress = (event) => {
            if (!event.total) {
              options.onUploadProgress?.(0);

              return;
            }

            const progress = Math.min(
              99,
              Math.round((event.loaded / event.total) * 100)
            );
            options.onUploadProgress?.(progress);
          };
        }

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          formData,
          config
        );

        if (shouldHandleLoading) {
          this.loading = false;
        }

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return false;
        }

        return true;
      } catch (error) {
        if (shouldHandleLoading) {
          this.loading = false;
        }

        const message =
          isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
            ? (error.response.data.message as string)
            : this.i18n.global.t('chat_message_create_error');

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },

    async createMessageWithDocuments(
      formData: FormData,
      options?: UploadOptions
    ): Promise<boolean> {
      const shouldHandleLoading = !options?.skipLoading;

      try {
        if (shouldHandleLoading) {
          this.loading = true;
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        if (options?.onUploadProgress) {
          config.onUploadProgress = (event) => {
            if (!event.total) {
              options.onUploadProgress?.(0);

              return;
            }

            const progress = Math.min(
              99,
              Math.round((event.loaded / event.total) * 100)
            );
            options.onUploadProgress?.(progress);
          };
        }

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          formData,
          config
        );

        if (shouldHandleLoading) {
          this.loading = false;
        }

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return false;
        }

        return true;
      } catch (error) {
        if (shouldHandleLoading) {
          this.loading = false;
        }

        const message =
          isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
            ? (error.response.data.message as string)
            : this.i18n.global.t('chat_message_create_error');

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },

    async createMessageWithVideos(
      formData: FormData,
      options?: UploadOptions
    ): Promise<boolean> {
      const shouldHandleLoading = !options?.skipLoading;

      try {
        if (shouldHandleLoading) {
          this.loading = true;
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        if (options?.onUploadProgress) {
          config.onUploadProgress = (event) => {
            if (!event.total) {
              options.onUploadProgress?.(0);

              return;
            }

            const progress = Math.min(
              99,
              Math.round((event.loaded / event.total) * 100)
            );
            options.onUploadProgress?.(progress);
          };
        }

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          formData,
          config
        );

        if (shouldHandleLoading) {
          this.loading = false;
        }

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return false;
        }

        return true;
      } catch (error) {
        if (shouldHandleLoading) {
          this.loading = false;
        }

        const message =
          isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
            ? (error.response.data.message as string)
            : this.i18n.global.t('chat_message_create_error');

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },
    async createMessageWithAudios(
      formData: FormData,
      options?: UploadOptions
    ): Promise<boolean> {
      const shouldHandleLoading = !options?.skipLoading;

      try {
        if (shouldHandleLoading) {
          this.loading = true;
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        if (options?.onUploadProgress) {
          config.onUploadProgress = (event) => {
            if (!event.total) {
              options.onUploadProgress?.(0);

              return;
            }

            const progress = Math.min(
              99,
              Math.round((event.loaded / event.total) * 100)
            );
            options.onUploadProgress?.(progress);
          };
        }

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          formData,
          config
        );

        if (shouldHandleLoading) {
          this.loading = false;
        }

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return false;
        }

        return true;
      } catch (error) {
        if (shouldHandleLoading) {
          this.loading = false;
        }

        const message =
          isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
            ? (error.response.data.message as string)
            : this.i18n.global.t('chat_message_create_error');

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },

    async createMessageWithLocation(
      formData: FormData,
      options?: UploadOptions
    ): Promise<boolean> {
      const shouldHandleLoading = !options?.skipLoading;

      try {
        if (shouldHandleLoading) {
          this.loading = true;
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          formData,
          config
        );

        if (shouldHandleLoading) {
          this.loading = false;
        }

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return false;
        }

        return true;
      } catch {
        if (shouldHandleLoading) {
          this.loading = false;
        }

        this.showSnackbar(
          this.i18n.global.t('chat_message_create_error'),
          EColor.error
        );

        return false;
      }
    },

    async createMessageWithContacts(
      formData: FormData,
      options?: UploadOptions
    ): Promise<boolean> {
      const shouldHandleLoading = !options?.skipLoading;

      try {
        if (shouldHandleLoading) {
          this.loading = true;
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/${this.activeChat?.chat_id}`,
          formData,
          config
        );

        if (shouldHandleLoading) {
          this.loading = false;
        }

        const data = response?.data as IApiResponse<boolean>;

        if (!data?.status) {
          this.showSnackbar(data.message, EColor.error);

          return false;
        }

        return true;
      } catch (error) {
        if (shouldHandleLoading) {
          this.loading = false;
        }

        const message =
          isAxiosError(error) &&
          typeof error.response?.data?.message === 'string'
            ? (error.response.data.message as string)
            : this.i18n.global.t('chat_message_create_error');

        this.showSnackbar(message, EColor.error);

        return false;
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

        const messageIndex = this.listMessages.findIndex(
          (message) => message.message_id === messageId
        );

        if (messageIndex !== -1) {
          const message = this.listMessages[messageIndex];
          const reactions = message.content?.reactions ?? [];
          const workerId = this.activeChat?.worker?.id ?? '';
          const workerName = this.activeChat?.worker?.name ?? '';
          const reactionsWithoutUser = reactions.filter(
            (reaction) => reaction?.user_id !== workerId
          );
          let updatedReactions = reactionsWithoutUser;
          if (emoji) {
            updatedReactions = [
              ...reactionsWithoutUser,
              {
                emoji,
                user_id: workerId,
                user_name: workerName,
              },
            ];
          }

          const reactionsValue =
            updatedReactions.length > 0 ? updatedReactions : null;

          const baseContent: ContentMessageChat = message.content
            ? { ...message.content }
            : {
                type: EMessageType.text,
              };

          const updatedMessage: ListMessageResult = {
            ...message,
            content: {
              ...baseContent,
              reactions: reactionsValue,
            },
          };

          this.listMessages.splice(messageIndex, 1, updatedMessage);
        }

        return true;
      } catch {
        return false;
      }
    },

    async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
      try {
        const response = await axios.post(
          `/chat/${chatId}/message/${messageId}/delete`,
          {}
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
