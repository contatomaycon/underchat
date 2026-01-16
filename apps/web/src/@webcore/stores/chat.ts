import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { type AxiosRequestConfig, AxiosError } from 'axios';
import {
  ListChatsResponse,
  ListChatsResult,
} from '@core/schema/chat/listChats/response.schema';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { SearchChatsResponse } from '@core/schema/chat/searchChats/response.schema';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import {
  getUser,
  setUser,
  getPermissions,
  getSectors,
} from '../localStorage/user';
import type { ListChatWorkersResponse } from '@core/schema/chat/listChatWorkers/response.schema';
import type { ListChatUsersResponse } from '@core/schema/chat/listChatUsers/response.schema';
import type { ListChatSectorsResponse } from '@core/schema/chat/listChatSectors/response.schema';
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
import { IChatMessage, IReaction } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ViewLinkPreviewBody } from '@core/schema/chat/viewLinkPreview/request.schema';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { SearchMessagesResponse } from '@core/schema/chat/searchMessages/response.schema';
import { ListChatContactsFinalResponse } from '@core/schema/chat/listContacts/response.schema';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { ViewChatContactByPhoneResponse } from '@core/schema/chat/viewContactByPhone/response.schema';
import { ViewChatContactEmailResponse } from '@core/schema/chat/viewContactEmail/response.schema';
import { ViewChatContactPhoneResponse } from '@core/schema/chat/viewContactPhone/response.schema';
import { ViewChatContactDocumentResponse } from '@core/schema/chat/viewContactDocument/response.schema';
import { ListChatLabelTemplatesResponse } from '@core/schema/chat/listLabelTemplates/response.schema';
import {
  ListQuickMessageTemplatesFinalResponse,
  ListQuickMessageTemplatesResponse,
} from '@core/schema/chat/listQuickMessageTemplates/response.schema';
import { ListQuickMessageTemplatesRequest } from '@core/schema/chat/listQuickMessageTemplates/request.schema';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';
import { TransferUserResponse } from '@core/schema/chat/listTransferUsers/response.schema';
import { TransferSectorResponse } from '@core/schema/chat/listTransferSectors/response.schema';
import { TransferSectorUserResponse } from '@core/schema/chat/listTransferSectorUsers/response.schema';
import { ListTransferOptionsResponse } from '@core/schema/chat/listTransferOptions/response.schema';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';

type FieldValue = string | { value: string } | null;

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
  if (!message?.content) {
    return;
  }
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
    loadingChats: false,
    skipChatStatusEventsUntil: {} as Record<string, number>,
    loadingMoreMessages: false,
    pendingStatusUpdateChatId: null as string | null,
    activeChat: null as ListChatsResult | null,
    listMessages: [] as ListMessageResult[],
    listQueue: [] as ListChatsResult[],
    listInChat: [] as ListChatsResult[],
    listChatbot: [] as ListChatsResult[],
    listClosed: [] as ListChatsResult[],
    queuePagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 25,
      count: 0,
      total: 0,
    },
    inChatPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 25,
      count: 0,
      total: 0,
    },
    chatbotPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 25,
      count: 0,
      total: 0,
    },
    closedPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 0,
      total: 0,
    },
    messageReply: null as ListMessageResult | null,
    user: getUser(),
    currentPage: 1,
    totalPages: 1,
    localMessageState: {} as Record<string, LocalMessageState>,
    chatContacts: {} as Record<string, ViewChatContactResponse | null>,
    loadingChatContacts: {} as Record<string, boolean>,
  }),
  actions: {
    showSnackbar(message: string, color: EColor) {
      if (!message || message.trim() === '') {
        return;
      }

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
      if (!hash) {
        return;
      }
      this.localMessageState[hash] = {
        status: 'uploading',
        progress: 0,
      };
    },
    updateLocalMessageProgress(hash: string, progress: number) {
      if (!hash) {
        return;
      }
      const target = this.localMessageState[hash];
      if (!target) {
        return;
      }
      target.progress = Math.max(0, Math.min(progress, 100));
    },
    markLocalMessageError(hash: string, errorMessage?: string) {
      if (!hash) {
        return;
      }
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
      if (!hash) {
        return;
      }
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
      if (!hash) {
        return;
      }
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

    removeChatIfNotAuthorized(chat: IChat): void {
      const wasInQueue = this.listQueue.some((c) => c.chat_id === chat.chat_id);
      const wasInInChat = this.listInChat.some(
        (c) => c.chat_id === chat.chat_id
      );

      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);

      if (wasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (wasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = null;
      }
    },

    shouldRemoveQueueChat(chat: IChat, userSectors: string[]): boolean {
      if (userSectors.length > 0) {
        const result =
          !chat.sector?.id || !userSectors.includes(chat.sector.id);
        return result;
      }
      const result = !!chat.sector?.id;
      return result;
    },

    addChat(chat: IChat, skipEvents = false) {
      const permissions = getPermissions();
      const wasInAnyList = this.isChatInAnyList(chat.chat_id);
      const shouldSkipEvents = skipEvents
        ? true
        : this.shouldSkipChatStatusEvents(chat.chat_id);
      const canViewOthersChats = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group ||
          perm === EChatPermissions.view_others_chats
      );
      const canListAllChatsWithoutSectorLimit = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group ||
          perm === EChatPermissions.list_all_chats_without_sector_limit
      );

      const hasPermissionToViewAll =
        canViewOthersChats || canListAllChatsWithoutSectorLimit;

      if (chat.status === EChatStatus.in_chat) {
        if (!hasPermissionToViewAll && chat.user?.id !== this.user?.user_id) {
          this.removeChatIfNotAuthorized(chat);
          return;
        }
      }

      if (!hasPermissionToViewAll) {
        if (chat.status === EChatStatus.queue) {
          if (chat.user?.id && chat.user.id !== this.user?.user_id) {
            this.removeChatIfNotAuthorized(chat);
            return;
          }

          if (!chat.user?.id) {
            const userSectors = getSectors();
            if (this.shouldRemoveQueueChat(chat, userSectors)) {
              this.removeChatIfNotAuthorized(chat);
              return;
            }
          }
        }
      }

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
        started_at: chat.started_at,
        closed_at: chat.closed_at,
        label: chat.label ?? null,
      };

      const isActiveChat = this.activeChat?.chat_id === chat.chat_id;
      this.updateActiveChatSummaryIfNeeded(chat, isActiveChat);

      if (this.pendingStatusUpdateChatId === chat.chat_id) {
        this.loading = false;
        this.pendingStatusUpdateChatId = null;
      }

      if (chat.status === EChatStatus.queue) {
        this.handleQueueStatusChat(input, chat, isActiveChat);
      } else if (chat.status === EChatStatus.in_chat) {
        this.handleInChatStatusChat(input, chat, isActiveChat);
      } else if (chat.status === EChatStatus.ura) {
        this.handleUraStatusChat(input, chat, isActiveChat);
      } else if (chat.status === EChatStatus.closed) {
        this.handleClosedStatusChat(input, chat, isActiveChat);
      }

      if (!shouldSkipEvents && !wasInAnyList) {
        this.markSkipChatStatusEvents(chat.chat_id);
        globalThis.dispatchEvent(
          new CustomEvent('chat-status-changed', {
            detail: { chat, reason: 'new' },
          })
        );
      }
    },

    updateActiveChatSummaryIfNeeded(chat: IChat, isActiveChat: boolean): void {
      if (!isActiveChat || !chat.summary || !this.activeChat?.summary) {
        return;
      }

      this.activeChat.summary = {
        ...this.activeChat.summary,
        last_date: chat.summary.last_date,
        last_message: chat.summary.last_message,
        unread_count: chat.summary.unread_count,
      };
    },

    getSummaryForActiveChat(
      input: ListChatsResult,
      existingSummary: ListChatsResult['summary']
    ): ListChatsResult['summary'] {
      if (!existingSummary) {
        return input.summary;
      }

      const result = {
        ...existingSummary,
        last_date: input.summary?.last_date ?? existingSummary.last_date,
        last_message:
          input.summary?.last_message ?? existingSummary.last_message,
        unread_count:
          input.summary?.unread_count ?? existingSummary.unread_count,
      };
      return result;
    },

    createUpdatedActiveChat(
      input: ListChatsResult,
      isActiveChat: boolean
    ): ListChatsResult {
      const result = {
        chat_id: input.chat_id,
        summary:
          isActiveChat && this.activeChat?.summary
            ? this.getSummaryForActiveChat(input, this.activeChat.summary)
            : input.summary,
        account: input.account,
        worker: input.worker,
        sector: input.sector,
        user: input.user,
        contact: input.contact,
        photo: input.photo,
        name: input.name,
        phone: input.phone,
        status: input.status,
        date: input.date,
        started_at: input.started_at,
        label: input.label,
        closed_at: input.closed_at,
      };
      return result;
    },

    removeFromList(arr: ListChatsResult[], chatId: string): void {
      const idx = arr.findIndex((c) => c.chat_id === chatId);
      if (idx !== -1) {
        arr.splice(idx, 1);
      }
    },

    isChatInAnyList(chatId: string): boolean {
      return (
        this.listQueue.some((c) => c.chat_id === chatId) ||
        this.listInChat.some((c) => c.chat_id === chatId) ||
        this.listChatbot.some((c) => c.chat_id === chatId) ||
        this.listClosed.some((c) => c.chat_id === chatId)
      );
    },

    markSkipChatStatusEvents(chatId: string, timeoutMs = 3000): void {
      if (!chatId) {
        return;
      }
      const expiresAt = Date.now() + timeoutMs;
      this.skipChatStatusEventsUntil[chatId] = expiresAt;

      setTimeout(() => {
        const current = this.skipChatStatusEventsUntil[chatId];
        if (current && current <= Date.now()) {
          delete this.skipChatStatusEventsUntil[chatId];
        }
      }, timeoutMs + 100);
    },

    shouldSkipChatStatusEvents(chatId: string): boolean {
      if (!chatId) {
        return false;
      }
      const expiresAt = this.skipChatStatusEventsUntil[chatId];
      if (!expiresAt) {
        return false;
      }
      if (expiresAt > Date.now()) {
        return true;
      }

      delete this.skipChatStatusEventsUntil[chatId];
      return false;
    },

    clearSkipChatStatusEvents(chatId: string): void {
      if (!chatId) {
        return;
      }
      delete this.skipChatStatusEventsUntil[chatId];
    },

    replaceOrPushInList(
      arr: ListChatsResult[],
      input: ListChatsResult,
      isActiveChat: boolean,
      status?: EChatStatus
    ): void {
      const idx = arr.findIndex((c) => c.chat_id === input.chat_id);

      if (idx !== -1) {
        const existingChat = arr[idx];
        const summaryToUse =
          isActiveChat && existingChat.summary
            ? this.getSummaryForActiveChat(input, existingChat.summary)
            : input.summary;

        arr[idx] = {
          ...input,
          summary: summaryToUse,
        };
        if (status) {
          this.sortChatList(arr, status);
        }
        return;
      }

      arr.push(input);
      if (status) {
        this.sortChatList(arr, status);
      }
    },

    getSortForStatus(status: EChatStatus): {
      sortBy: string;
      sortOrder: string;
    } {
      const chatUser = this.user?.chat_user;
      if (!chatUser) {
        return { sortBy: 'date', sortOrder: 'desc' };
      }

      if (status === EChatStatus.in_chat) {
        if (chatUser.sort_by_my_chats_order && chatUser.sort_my_chats_order) {
          return {
            sortBy: chatUser.sort_by_my_chats_order,
            sortOrder: chatUser.sort_my_chats_order,
          };
        }
      }

      if (status === EChatStatus.queue) {
        if (chatUser.sort_by_queue_order && chatUser.sort_queue_order) {
          return {
            sortBy: chatUser.sort_by_queue_order,
            sortOrder: chatUser.sort_queue_order,
          };
        }
      }

      if (status === EChatStatus.ura) {
        if (chatUser.sort_by_chatbot_order && chatUser.sort_chatbot_order) {
          return {
            sortBy: chatUser.sort_by_chatbot_order,
            sortOrder: chatUser.sort_chatbot_order,
          };
        }
      }

      if (chatUser.sort_by_chat_order && chatUser.sort_in_chat_order) {
        return {
          sortBy: chatUser.sort_by_chat_order,
          sortOrder: chatUser.sort_in_chat_order,
        };
      }

      return { sortBy: 'date', sortOrder: 'desc' };
    },

    getFieldValue(chat: ListChatsResult, field: string): any {
      if (field === 'summary.last_message') {
        return chat.summary?.last_message || '';
      }
      if (field === 'summary.last_date') {
        return chat.summary?.last_date || '';
      }
      if (field === 'account.name') {
        return chat.account?.name || '';
      }
      if (field === 'worker.name') {
        return chat.worker?.name || '';
      }
      if (field === 'user.name') {
        return chat.user?.name || '';
      }
      if (field === 'sector.name') {
        return chat.sector?.name || '';
      }
      if (field === 'name') {
        return chat.name || '';
      }
      if (field === 'phone') {
        return chat.phone || '';
      }
      if (field === 'status') {
        return chat.status || '';
      }
      if (field === 'date') {
        return chat.date || '';
      }
      if (field === 'started_at') {
        return chat.started_at || '';
      }
      if (field === 'closed_at') {
        return chat.closed_at || '';
      }
      return '';
    },

    sortChatList(arr: ListChatsResult[], status: EChatStatus): void {
      if (arr.length === 0) {
        return;
      }

      const { sortBy, sortOrder } = this.getSortForStatus(status);

      arr.sort((a, b) => {
        const aValue = this.getFieldValue(a, sortBy);
        const bValue = this.getFieldValue(b, sortBy);

        if (aValue === bValue) {
          return 0;
        }

        if (aValue === '' || aValue === null || aValue === undefined) {
          return 1;
        }
        if (bValue === '' || bValue === null || bValue === undefined) {
          return -1;
        }

        let comparison = 0;
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          comparison = aValue.localeCompare(bValue);
        } else if (typeof aValue === 'number' && typeof bValue === 'number') {
          comparison = aValue - bValue;
        } else {
          const aStr = String(aValue);
          const bStr = String(bValue);
          comparison = aStr.localeCompare(bStr);
        }

        return sortOrder === 'asc' ? comparison : -comparison;
      });
    },

    canViewChat(chat: IChat): boolean {
      const permissions = getPermissions();
      const canViewOthersChats = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group ||
          perm === EChatPermissions.view_others_chats
      );

      const canListAllChatsWithoutSectorLimit = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group ||
          perm === EChatPermissions.list_all_chats_without_sector_limit
      );

      const hasPermissionToViewAll =
        canViewOthersChats || canListAllChatsWithoutSectorLimit;

      if (chat.status === EChatStatus.in_chat) {
        if (hasPermissionToViewAll) {
          return true;
        }
        return chat.user?.id === this.user?.user_id;
      }

      const canViewChatbotMessages = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group ||
          perm === EChatPermissions.view_chatbot_messages
      );

      const isOwnChat = chat.user?.id === this.user?.user_id;

      if (chat.status === EChatStatus.ura) {
        return canViewChatbotMessages || isOwnChat;
      }

      return canViewOthersChats || isOwnChat;
    },

    handleQueueStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean
    ): void {
      const wasInQueue = this.listQueue.some((c) => c.chat_id === chat.chat_id);
      const wasInInChat = this.listInChat.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInChatbot = this.listChatbot.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInClosed = this.listClosed.some(
        (c) => c.chat_id === chat.chat_id
      );

      if (wasInInChat) {
        const isStillMine = chat.user?.id === this.user?.user_id;

        if (!isStillMine) {
          this.removeFromList(this.listInChat, chat.chat_id);
          this.removeFromList(this.listQueue, chat.chat_id);
          this.removeFromList(this.listChatbot, chat.chat_id);
          this.removeFromList(this.listClosed, chat.chat_id);

          if (this.inChatPagings.total > 0) {
            this.inChatPagings.total = Math.max(
              0,
              this.inChatPagings.total - 1
            );
          }

          if (wasInQueue && this.queuePagings.total > 0) {
            this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
          }

          if (wasInChatbot && this.chatbotPagings.total > 0) {
            this.chatbotPagings.total = Math.max(
              0,
              this.chatbotPagings.total - 1
            );
          }

          if (wasInClosed && this.closedPagings.total > 0) {
            this.closedPagings.total = Math.max(
              0,
              this.closedPagings.total - 1
            );
          }

          if (this.activeChat?.chat_id === chat.chat_id) {
            this.activeChat = null;
          }
          return;
        }
      }

      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);
      this.replaceOrPushInList(
        this.listQueue,
        input,
        isActiveChat,
        EChatStatus.queue
      );

      if (!wasInQueue) {
        this.queuePagings.total = (this.queuePagings.total || 0) + 1;
      }

      if (wasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (wasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (wasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = this.createUpdatedActiveChat(input, isActiveChat);
      }
    },

    handleInChatStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean
    ): void {
      if (!this.canViewChat(chat)) {
        const wasInInChat = this.listInChat.some(
          (c) => c.chat_id === chat.chat_id
        );
        const wasInQueue = this.listQueue.some(
          (c) => c.chat_id === chat.chat_id
        );
        const wasInChatbot = this.listChatbot.some(
          (c) => c.chat_id === chat.chat_id
        );
        const wasInClosed = this.listClosed.some(
          (c) => c.chat_id === chat.chat_id
        );

        this.removeFromList(this.listInChat, chat.chat_id);
        this.removeFromList(this.listQueue, chat.chat_id);
        this.removeFromList(this.listChatbot, chat.chat_id);
        this.removeFromList(this.listClosed, chat.chat_id);

        if (wasInInChat && this.inChatPagings.total > 0) {
          this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
        }

        if (wasInQueue && this.queuePagings.total > 0) {
          this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
        }

        if (wasInChatbot && this.chatbotPagings.total > 0) {
          this.chatbotPagings.total = Math.max(
            0,
            this.chatbotPagings.total - 1
          );
        }

        if (wasInClosed && this.closedPagings.total > 0) {
          this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
        }

        if (this.activeChat?.chat_id === chat.chat_id) {
          this.activeChat = null;
        }
        return;
      }

      const wasInQueue = this.listQueue.some((c) => c.chat_id === chat.chat_id);
      const wasInInChat = this.listInChat.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInChatbot = this.listChatbot.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInClosed = this.listClosed.some(
        (c) => c.chat_id === chat.chat_id
      );

      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);
      this.replaceOrPushInList(
        this.listInChat,
        input,
        isActiveChat,
        EChatStatus.in_chat
      );

      if (!wasInInChat) {
        this.inChatPagings.total = (this.inChatPagings.total || 0) + 1;
      }

      if (wasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (wasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (wasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = this.createUpdatedActiveChat(input, isActiveChat);
      }
    },

    handleUraStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean
    ): void {
      if (!this.canViewChat(chat)) {
        const wasInInChat = this.listInChat.some(
          (c) => c.chat_id === chat.chat_id
        );
        const wasInQueue = this.listQueue.some(
          (c) => c.chat_id === chat.chat_id
        );
        const wasInChatbot = this.listChatbot.some(
          (c) => c.chat_id === chat.chat_id
        );
        const wasInClosed = this.listClosed.some(
          (c) => c.chat_id === chat.chat_id
        );

        this.removeFromList(this.listChatbot, chat.chat_id);
        this.removeFromList(this.listInChat, chat.chat_id);
        this.removeFromList(this.listQueue, chat.chat_id);
        this.removeFromList(this.listClosed, chat.chat_id);

        if (wasInInChat && this.inChatPagings.total > 0) {
          this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
        }

        if (wasInQueue && this.queuePagings.total > 0) {
          this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
        }

        if (wasInChatbot && this.chatbotPagings.total > 0) {
          this.chatbotPagings.total = Math.max(
            0,
            this.chatbotPagings.total - 1
          );
        }

        if (wasInClosed && this.closedPagings.total > 0) {
          this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
        }

        if (this.activeChat?.chat_id === chat.chat_id) {
          this.activeChat = null;
        }
        return;
      }

      const wasInInChat = this.listInChat.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInQueue = this.listQueue.some((c) => c.chat_id === chat.chat_id);
      const wasInChatbot = this.listChatbot.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInClosed = this.listClosed.some(
        (c) => c.chat_id === chat.chat_id
      );

      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);
      this.replaceOrPushInList(
        this.listChatbot,
        input,
        isActiveChat,
        EChatStatus.ura
      );

      if (!wasInChatbot) {
        this.chatbotPagings.total = (this.chatbotPagings.total || 0) + 1;
      }

      if (wasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (wasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (wasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = this.createUpdatedActiveChat(input, isActiveChat);
      }
    },

    handleClosedStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean
    ): void {
      const wasInInChat = this.listInChat.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInQueue = this.listQueue.some((c) => c.chat_id === chat.chat_id);
      const wasInChatbot = this.listChatbot.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInClosed = this.listClosed.some(
        (c) => c.chat_id === chat.chat_id
      );

      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.replaceOrPushInList(
        this.listClosed,
        input,
        isActiveChat,
        EChatStatus.closed
      );

      if (!wasInClosed) {
        this.closedPagings.total = (this.closedPagings.total || 0) + 1;
      }

      if (wasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (wasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (wasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = null;
      }
    },
    updateChatUserImmediate() {
      if (!this.user?.status) {
        return;
      }

      const existingChatUser = this.user?.chat_user ?? undefined;
      const chatUserUpdate = {
        ...(existingChatUser ?? {}),
        chat_user_id: existingChatUser?.chat_user_id ?? '',
        status: existingChatUser?.status as EChatUserStatus,
        about: existingChatUser?.about ?? '',
        notifications: existingChatUser?.notifications ?? false,
      };

      setUser({ ...this.user, chat_user: chatUserUpdate });
      this.user.chat_user = chatUserUpdate as AuthUserResponse['chat_user'];
    },

    async updateChatUserDebounce() {
      if (!this.user?.status) {
        return;
      }

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

    async listQueueChats(
      input: ListChatsQuery,
      append = false
    ): Promise<ListChatsResponse | null> {
      try {
        this.loading = true;
        this.loadingChats = true;

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
          filter_status: input.filter_status,
          filter_label_template_id: input.filter_label_template_id,
          filter_worker_id: input.filter_worker_id,
          filter_sector_id: input.filter_sector_id,
          filter_name: input.filter_name,
          filter_phone: input.filter_phone,
          filter_protocol: input.filter_protocol,
          filter_date_start: input.filter_date_start,
          filter_date_end: input.filter_date_end,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;
        this.loadingChats = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          if (!append) {
            this.listQueue = [];
          }

          return null;
        }

        if (append) {
          this.listQueue = [...this.listQueue, ...data.data.results];
        } else {
          const filteredResults = data.data.results.filter((chat) => {
            const existingInQueue = this.listQueue.find(
              (c) => c.chat_id === chat.chat_id
            );
            const existingInInChat = this.listInChat.find(
              (c) => c.chat_id === chat.chat_id
            );

            if (
              existingInInChat &&
              existingInInChat.status === EChatStatus.in_chat
            ) {
              return false;
            }

            if (
              existingInQueue &&
              existingInQueue.status !== EChatStatus.queue
            ) {
              return false;
            }

            return true;
          });
          this.listQueue = filteredResults;
        }

        this.queuePagings = data.data.pagings;

        return data.data;
      } catch {
        if (!append) {
          this.listQueue = [];
        }
        this.loading = false;
        this.loadingChats = false;

        return null;
      }
    },

    async listInChatChats(
      input: ListChatsQuery,
      append = false
    ): Promise<ListChatsResponse | null> {
      try {
        this.loading = true;
        this.loadingChats = true;

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
          filter_status: input.filter_status,
          filter_label_template_id: input.filter_label_template_id,
          filter_worker_id: input.filter_worker_id,
          filter_sector_id: input.filter_sector_id,
          filter_name: input.filter_name,
          filter_phone: input.filter_phone,
          filter_protocol: input.filter_protocol,
          filter_date_start: input.filter_date_start,
          filter_date_end: input.filter_date_end,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;
        this.loadingChats = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          if (!append) {
            this.listInChat = [];
          }

          return null;
        }

        if (append) {
          this.listInChat = [...this.listInChat, ...data.data.results];
        } else {
          const existingInChatChats = this.listInChat.filter(
            (c) => c.status === EChatStatus.in_chat
          );
          const existingInChatIds = new Set(
            existingInChatChats.map((c) => c.chat_id)
          );

          const newInChatChats = data.data.results.filter(
            (c) => !existingInChatIds.has(c.chat_id)
          );

          this.listInChat = [...existingInChatChats, ...newInChatChats];
        }

        this.inChatPagings = data.data.pagings;

        return data.data;
      } catch {
        if (!append) {
          this.listInChat = [];
        }
        this.loading = false;
        this.loadingChats = false;

        return null;
      }
    },

    async listChatbotChats(
      input: ListChatsQuery,
      append = false
    ): Promise<ListChatsResponse | null> {
      try {
        this.loading = true;

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
          filter_status: input.filter_status,
          filter_label_template_id: input.filter_label_template_id,
          filter_worker_id: input.filter_worker_id,
          filter_sector_id: input.filter_sector_id,
          filter_name: input.filter_name,
          filter_phone: input.filter_phone,
          filter_protocol: input.filter_protocol,
          filter_date_start: input.filter_date_start,
          filter_date_end: input.filter_date_end,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          if (!append) {
            this.listChatbot = [];
          }

          return null;
        }

        this.chatbotPagings = data.data.pagings;

        if (append) {
          this.listChatbot = [...this.listChatbot, ...data.data.results];
          return data.data;
        }

        this.listChatbot = data.data.results;

        return data.data;
      } catch {
        if (!append) {
          this.listChatbot = [];
        }

        return null;
      }
    },

    async listClosedChats(
      input: ListChatsQuery,
      append = false
    ): Promise<ListChatsResponse | null> {
      try {
        this.loading = true;

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
          filter_status: input.filter_status,
          filter_label_template_id: input.filter_label_template_id,
          filter_worker_id: input.filter_worker_id,
          filter_sector_id: input.filter_sector_id,
          filter_name: input.filter_name,
          filter_phone: input.filter_phone,
          filter_protocol: input.filter_protocol,
          filter_date_start: input.filter_date_start,
          filter_date_end: input.filter_date_end,
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          if (!append) {
            this.listClosed = [];
          }
          return null;
        }

        if (append) {
          this.listClosed = [...this.listClosed, ...data.data.results];
          this.closedPagings = data.data.pagings;
          return data.data;
        }

        this.listClosed = data.data.results;
        this.closedPagings = data.data.pagings;

        return data.data;
      } catch {
        if (!append) {
          this.listClosed = [];
        }
        return null;
      }
    },

    async searchChats(
      input: SearchChatsQuery
    ): Promise<SearchChatsResponse | null> {
      try {
        this.loading = true;

        const params: Record<string, any> = {
          current_page: input.current_page ?? 1,
          per_page: input.per_page ?? 20,
          search: input.search || '',
        };

        if (input.filter_status) {
          params.filter_status = input.filter_status;
        }
        if (input.filter_label_template_id) {
          params.filter_label_template_id = input.filter_label_template_id;
        }
        if (input.filter_worker_id) {
          params.filter_worker_id = input.filter_worker_id;
        }
        if (input.filter_user_id) {
          params.filter_user_id = input.filter_user_id;
        }
        if (input.filter_sector_id) {
          params.filter_sector_id = input.filter_sector_id;
        }
        if (input.filter_name) {
          params.filter_name = input.filter_name;
        }
        if (input.filter_phone) {
          params.filter_phone = input.filter_phone;
        }
        if (input.filter_protocol) {
          params.filter_protocol = input.filter_protocol;
        }
        if (input.filter_date_start) {
          params.filter_date_start = input.filter_date_start;
        }
        if (input.filter_date_end) {
          params.filter_date_end = input.filter_date_end;
        }
        if (input.sort_field) {
          params.sort_field = input.sort_field;
        }
        if (input.sort_order) {
          params.sort_order = input.sort_order;
        }

        const response = await axios.get<IApiResponse<SearchChatsResponse>>(
          `/chat/search`,
          { params }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        const results = data.data.results.filter(
          (result) => result.chat_id && result.chat_id.trim().length > 0
        );

        const searchResponse = {
          ...data.data,
          results,
        };
        return searchResponse;
      } catch {
        this.loading = false;
        return null;
      }
    },

    async resolveChatEndpoint(
      status: EChatStatus | EChatStatus[],
      filters: {
        filter_status?: string | null;
        filter_label_template_id?: string | null;
        filter_worker_id?: string | null;
        filter_user_id?: string | null;
        filter_sector_id?: string | null;
        filter_name?: string | null;
        filter_phone?: string | null;
        filter_protocol?: string | null;
        filter_date_start?: string | null;
        filter_date_end?: string | null;
        sort_field?: string | null;
        sort_order?: string | null;
      },
      hasAppliedAdvancedFilters: boolean,
      pagination: { current_page: number; per_page: number },
      append = false
    ): Promise<{
      results: ListChatsResult[];
      counts: {
        queue: number;
        in_chat: number;
        chatbot: number;
        closed?: number;
        my_chats: number;
      } | null;
    }> {
      const statusArray = Array.isArray(status) ? status : [status];

      if (statusArray.length > 1) {
        try {
          this.loading = true;

          const params: Record<string, any> = {
            current_page: pagination.current_page,
            per_page: pagination.per_page,
            status: statusArray,
          };

          if (filters.filter_label_template_id) {
            params.filter_label_template_id = filters.filter_label_template_id;
          }
          if (filters.filter_worker_id) {
            params.filter_worker_id = filters.filter_worker_id;
          }
          if (filters.filter_sector_id) {
            params.filter_sector_id = filters.filter_sector_id;
          }
          if (filters.filter_name) {
            params.filter_name = filters.filter_name;
          }
          if (filters.filter_phone) {
            params.filter_phone = filters.filter_phone;
          }
          if (filters.filter_protocol) {
            params.filter_protocol = filters.filter_protocol;
          }
          if (filters.filter_date_start) {
            params.filter_date_start = filters.filter_date_start;
          }
          if (filters.filter_date_end) {
            params.filter_date_end = filters.filter_date_end;
          }

          const response = await axios.get<IApiResponse<ListChatsResponse>>(
            `/chat`,
            { params }
          );

          this.loading = false;

          const data = response?.data;

          if (!data?.status || !data?.data) {
            return { results: [], counts: null };
          }

          if (statusArray.includes(EChatStatus.queue)) {
            if (append) {
              this.listQueue.push(
                ...data.data.results.filter(
                  (c) => c.status === EChatStatus.queue
                )
              );
            } else {
              this.listQueue = data.data.results.filter(
                (c) => c.status === EChatStatus.queue
              );
            }
            this.queuePagings = data.data.pagings;
          }

          if (statusArray.includes(EChatStatus.in_chat)) {
            if (append) {
              this.listInChat.push(
                ...data.data.results.filter(
                  (c) => c.status === EChatStatus.in_chat
                )
              );
            } else {
              this.listInChat = data.data.results.filter(
                (c) => c.status === EChatStatus.in_chat
              );
            }
            this.inChatPagings = data.data.pagings;
          }

          return { results: data.data.results, counts: data.data.counts };
        } catch {
          this.loading = false;
          return { results: [], counts: null };
        }
      }

      const singleStatus = statusArray[0];

      if (hasAppliedAdvancedFilters) {
        const request: SearchChatsQuery = {
          current_page: pagination.current_page,
          per_page: pagination.per_page,
          search: '',
          filter_status: singleStatus,
          filter_label_template_id: filters.filter_label_template_id,
          filter_worker_id: filters.filter_worker_id,
          filter_user_id: filters.filter_user_id,
          filter_sector_id: filters.filter_sector_id,
          filter_name: filters.filter_name,
          filter_phone: filters.filter_phone,
          filter_protocol: filters.filter_protocol,
          filter_date_start: filters.filter_date_start,
          filter_date_end: filters.filter_date_end,
          sort_field: filters.sort_field,
          sort_order: filters.sort_order,
        };

        const result = await this.searchChats(request);
        if (!result) {
          return { results: [], counts: null };
        }

        return { results: result.results, counts: result.counts };
      }

      const request: ListChatsQuery = {
        current_page: pagination.current_page,
        per_page: pagination.per_page,
        status: singleStatus,
        filter_label_template_id: filters.filter_label_template_id,
        filter_worker_id: filters.filter_worker_id,
        filter_sector_id: filters.filter_sector_id,
        filter_name: filters.filter_name,
        filter_phone: filters.filter_phone,
        filter_protocol: filters.filter_protocol,
        filter_date_start: filters.filter_date_start,
        filter_date_end: filters.filter_date_end,
      };

      if (singleStatus === EChatStatus.queue) {
        const response = await this.listQueueChats(request, append);
        return { results: this.listQueue, counts: response?.counts ?? null };
      }

      if (singleStatus === EChatStatus.in_chat) {
        const response = await this.listInChatChats(request, append);
        return { results: this.listInChat, counts: response?.counts ?? null };
      }

      if (singleStatus === EChatStatus.ura) {
        const response = await this.listChatbotChats(request, append);
        return { results: this.listChatbot, counts: response?.counts ?? null };
      }

      if (singleStatus === EChatStatus.closed) {
        const response = await this.listClosedChats(request, append);
        return { results: this.listClosed, counts: response?.counts ?? null };
      }

      return { results: [], counts: null };
    },

    async reloadAllChatLists(hasAppliedAdvancedFilters = false): Promise<void> {
      await Promise.all([
        this.resolveChatEndpoint(
          EChatStatus.queue,
          {},
          hasAppliedAdvancedFilters,
          {
            current_page: 1,
            per_page: this.queuePagings.per_page,
          },
          false
        ),
        this.resolveChatEndpoint(
          EChatStatus.in_chat,
          {},
          hasAppliedAdvancedFilters,
          {
            current_page: 1,
            per_page: this.inChatPagings.per_page,
          },
          false
        ),
        this.resolveChatEndpoint(
          EChatStatus.ura,
          {},
          hasAppliedAdvancedFilters,
          {
            current_page: 1,
            per_page: this.chatbotPagings.per_page,
          },
          false
        ),
      ]);
    },

    async updateChatsUser(input: UpdateChatsUserRequest): Promise<void> {
      try {
        this.loading = true;

        const response = await axios.put<IApiResponse<null>>(
          `/chat/user`,
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const errorMessage =
            data?.message || this.i18n.global.t('chat_config_update_error');
          this.showSnackbar(errorMessage, EColor.error);

          return;
        }

        if (this.user?.chat_user) {
          const updatedChatUser = {
            ...this.user.chat_user,
            sort_by_chat_order:
              input.sort_by_chat_order ??
              this.user.chat_user.sort_by_chat_order,
            sort_in_chat_order:
              input.sort_in_chat_order ??
              this.user.chat_user.sort_in_chat_order,
            sort_by_my_chats_order:
              input.sort_by_my_chats_order ??
              this.user.chat_user.sort_by_my_chats_order,
            sort_my_chats_order:
              input.sort_my_chats_order ??
              this.user.chat_user.sort_my_chats_order,
            sort_by_queue_order:
              input.sort_by_queue_order ??
              this.user.chat_user.sort_by_queue_order,
            sort_queue_order:
              input.sort_queue_order ?? this.user.chat_user.sort_queue_order,
            sort_by_chatbot_order:
              input.sort_by_chatbot_order ??
              this.user.chat_user.sort_by_chatbot_order,
            sort_chatbot_order:
              input.sort_chatbot_order ??
              this.user.chat_user.sort_chatbot_order,
          };
          this.user.chat_user =
            updatedChatUser as AuthUserResponse['chat_user'];
          setUser({ ...this.user, chat_user: updatedChatUser });
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

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.listMessages = [];
          this.loading = false;

          return;
        }

        this.loading = false;

        this.listMessages = [...data.data.results].reverse();
        this.currentPage = data.data.pagings.current_page;
        this.totalPages = data.data.pagings.total_pages;
      } catch (error) {
        this.loading = false;
        this.listMessages = [];

        if (error instanceof Error) {
          this.showSnackbar(error.message, EColor.error);
        }

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

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.loadingMoreMessages = false;

          return false;
        }

        this.currentPage = data.data.pagings.current_page;
        const reversedResults = data.data.results.toReversed();
        this.listMessages = [...reversedResults, ...this.listMessages];
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

        const data = response?.data;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        this.loading = false;

        return false;
      }
    },

    async updateChatStatus(chatId: string, status: string): Promise<boolean> {
      try {
        this.loading = true;
        this.pendingStatusUpdateChatId = chatId;
        const shouldSkipStatusEvents = status === EChatStatus.in_chat;

        if (shouldSkipStatusEvents) {
          this.markSkipChatStatusEvents(chatId);
        }

        const response = await axios.patch<IApiResponse<IChat>>(
          `/chat/${chatId}/status`,
          { status }
        );

        const data = response?.data;

        if (!data?.status) {
          this.loading = false;
          this.pendingStatusUpdateChatId = null;
          const errorMessage =
            data?.message || this.i18n.global.t('chat_status_update_error');
          this.showSnackbar(errorMessage, EColor.error);

          if (shouldSkipStatusEvents) {
            this.clearSkipChatStatusEvents(chatId);
          }

          return false;
        }

        if (data.data) {
          const isActiveChat = this.activeChat?.chat_id === chatId;

          this.addChat(data.data, true);

          if (isActiveChat) {
            const input: ListChatsResult = {
              chat_id: data.data.chat_id,
              summary: data.data.summary,
              account: data.data.account,
              worker: data.data.worker,
              sector: data.data.sector,
              user: data.data.user,
              contact: data.data.contact,
              photo: data.data.photo,
              name: data.data.name,
              phone: data.data.phone,
              status: data.data.status,
              date: data.data.date,
              started_at: data.data.started_at,
              closed_at: data.data.closed_at,
              label: data.data.label ?? null,
            };

            this.activeChat = this.createUpdatedActiveChat(input, true);
          }
        }

        setTimeout(() => {
          if (this.pendingStatusUpdateChatId === chatId) {
            this.loading = false;
            this.pendingStatusUpdateChatId = null;
          }
        }, 3000);

        return true;
      } catch (error) {
        this.loading = false;
        this.pendingStatusUpdateChatId = null;
        const shouldSkipStatusEvents = status === EChatStatus.in_chat;

        if (shouldSkipStatusEvents) {
          this.clearSkipChatStatusEvents(chatId);
        }

        let errorMessage = this.i18n.global.t('chat_status_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async transferChat(
      chatId: string,
      userId?: string | null,
      sectorId?: string | null,
      annotation?: string | null,
      hasAppliedAdvancedFilters = false
    ): Promise<boolean> {
      void hasAppliedAdvancedFilters;
      try {
        this.loading = true;
        this.markSkipChatStatusEvents(chatId);

        const response = await axios.post<
          IApiResponse<{ chat_id: string; status: boolean }>
        >(`/chat/${chatId}/transfer`, {
          user_id: userId ?? undefined,
          sector_id: sectorId ?? undefined,
          annotation: annotation?.trim() ?? undefined,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const errorMessage =
            data?.message || this.i18n.global.t('chat_transfer_error');
          this.showSnackbar(errorMessage, EColor.error);
          this.clearSkipChatStatusEvents(chatId);

          return false;
        }

        return true;
      } catch (error) {
        this.loading = false;
        this.clearSkipChatStatusEvents(chatId);

        let errorMessage = this.i18n.global.t('chat_transfer_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async clearChatSummary(chatId: string): Promise<boolean> {
      if (!chatId) return false;

      try {
        await axios.post(`/chat/${chatId}/clear-summary`, {});

        return true;
      } catch {
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

        const data = response?.data;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        if (shouldHandleLoading) {
          this.loading = false;
        }

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

        const data = response?.data;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        if (shouldHandleLoading) {
          this.loading = false;
        }

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

        const data = response?.data;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        if (shouldHandleLoading) {
          this.loading = false;
        }

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

        const data = response?.data;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        if (shouldHandleLoading) {
          this.loading = false;
        }

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

        const data = response?.data;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        if (shouldHandleLoading) {
          this.loading = false;
        }

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

        const data = response?.data;

        if (!data?.status) {
          return false;
        }

        return true;
      } catch {
        if (shouldHandleLoading) {
          this.loading = false;
        }

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

        const data = response?.data;

        if (!data?.status) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;

        return null;
      }
    },

    setActiveChat(chatId: string): void {
      if (this.activeChat?.chat_id === chatId) return;

      const chat = (this.listQueue.find((c) => c.chat_id === chatId) ??
        this.listInChat.find((c) => c.chat_id === chatId) ??
        this.listChatbot.find((c) => c.chat_id === chatId) ??
        this.listClosed.find((c) => c.chat_id === chatId)) as ListChatsResult;

      if (!chat?.chat_id) {
        this.activeChat = null;
        return;
      }

      this.activeChat = {
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
        label: chat.label ?? null,
      };
    },

    ensureActiveChatUnreadCountIsZero(): void {
      if (!this.activeChat?.chat_id) {
        return;
      }

      if (this.activeChat.status !== EChatStatus.in_chat) {
        return;
      }

      const chatId = this.activeChat.chat_id;

      if (this.activeChat.summary) {
        this.activeChat.summary = {
          ...this.activeChat.summary,
          unread_count: 0,
        };
      }

      const chatInQueue = this.listQueue.find((c) => c.chat_id === chatId);
      if (chatInQueue?.summary) {
        chatInQueue.summary = {
          ...chatInQueue.summary,
          unread_count: 0,
        };
      }

      const chatInList = this.listInChat.find((c) => c.chat_id === chatId);
      if (chatInList?.summary) {
        chatInList.summary = {
          ...chatInList.summary,
          unread_count: 0,
        };
      }
    },

    clearActiveChatUnreadCountLocally(): void {
      if (!this.activeChat?.chat_id) {
        return;
      }

      const chatId = this.activeChat.chat_id;

      if (this.activeChat.summary) {
        this.activeChat.summary = {
          ...this.activeChat.summary,
          unread_count: 0,
        };
      }

      const chatInQueue = this.listQueue.find((c) => c.chat_id === chatId);
      if (chatInQueue?.summary) {
        chatInQueue.summary = {
          ...chatInQueue.summary,
          unread_count: 0,
        };
      }

      const chatInList = this.listInChat.find((c) => c.chat_id === chatId);
      if (chatInList?.summary) {
        chatInList.summary = {
          ...chatInList.summary,
          unread_count: 0,
        };
      }
    },

    setMessageReply(m: ListMessageResult) {
      this.messageReply = m;
    },

    clearMessageReply() {
      this.messageReply = null;
    },

    updateMessageReaction(messageId: string, emoji: string) {
      const messageIndex = this.listMessages.findIndex(
        (message) => message.message_id === messageId
      );

      if (messageIndex === -1) return;

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
    },
    revertMessageReaction(
      messageId: string,
      previousReactions: IReaction[] | null
    ) {
      const messageIndex = this.listMessages.findIndex(
        (message) => message.message_id === messageId
      );

      if (messageIndex === -1) return;

      const message = this.listMessages[messageIndex];
      const baseContent: ContentMessageChat = message.content
        ? { ...message.content }
        : {
            type: EMessageType.text,
          };

      const updatedMessage: ListMessageResult = {
        ...message,
        content: {
          ...baseContent,
          reactions: previousReactions,
        },
      };

      this.listMessages.splice(messageIndex, 1, updatedMessage);
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

    markMessageAsDeleted(messageId: string) {
      const idx = this.listMessages.findIndex(
        (item) => item.message_id === messageId
      );
      if (idx !== -1) {
        this.listMessages[idx] = {
          ...this.listMessages[idx],
          deleted: true,
        };
      }
    },
    unmarkMessageAsDeleted(messageId: string) {
      const idx = this.listMessages.findIndex(
        (item) => item.message_id === messageId
      );
      if (idx !== -1) {
        this.listMessages[idx] = {
          ...this.listMessages[idx],
          deleted: false,
        };
      }
    },
    async editMessage(
      chatId: string,
      messageId: string,
      newMessage: string
    ): Promise<boolean> {
      try {
        const response = await axios.post(
          `/chat/${chatId}/message/${messageId}/edit`,
          { message: newMessage }
        );

        const data = response?.data as IApiResponse<boolean>;

        return data?.status ?? false;
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

    async searchMessages(
      chatId: string,
      search: string,
      currentPage: number = 1,
      perPage: number = 50
    ): Promise<SearchMessagesResponse> {
      try {
        const response = await axios.get<IApiResponse<SearchMessagesResponse>>(
          `/chat/${chatId}/search`,
          {
            params: { search, current_page: currentPage, per_page: perPage },
          }
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const pagings = {
            current_page: 1,
            total_pages: 0,
            per_page: perPage,
            count: 0,
            total: 0,
          };
          return {
            results: [],
            pagings,
          };
        }

        return data.data;
      } catch {
        const pagings = {
          current_page: 1,
          total_pages: 0,
          per_page: perPage,
          count: 0,
          total: 0,
        };
        return {
          results: [],
          pagings,
        };
      }
    },

    async listChatContacts(
      page: number = 1,
      perPage: number = 50,
      search?: string,
      filters?: {
        filter_label_template_id?: string;
        filter_phone_ddi?: string;
        filter_phone?: string;
        filter_name?: string;
        filter_last_name?: string;
        filter_nickname?: string;
        filter_email?: string;
        filter_birthday?: string;
        filter_document?: string;
        filter_user_id?: string;
        sort_field?: string;
        sort_order?: string;
      }
    ): Promise<ListChatContactsFinalResponse | null> {
      try {
        const params: Record<string, any> = {
          current_page: page,
          per_page: perPage,
        };

        if (search) {
          params.search = search;
        }

        if (filters) {
          if (filters.filter_label_template_id) {
            params.filter_label_template_id = filters.filter_label_template_id;
          }
          if (filters.filter_phone_ddi) {
            params.filter_phone_ddi = filters.filter_phone_ddi;
          }
          if (filters.filter_phone) {
            params.filter_phone = filters.filter_phone;
          }
          if (filters.filter_name) {
            params.filter_name = filters.filter_name;
          }
          if (filters.filter_last_name) {
            params.filter_last_name = filters.filter_last_name;
          }
          if (filters.filter_nickname) {
            params.filter_nickname = filters.filter_nickname;
          }
          if (filters.filter_email) {
            params.filter_email = filters.filter_email;
          }
          if (filters.filter_birthday) {
            params.filter_birthday = filters.filter_birthday;
          }
          if (filters.filter_document) {
            params.filter_document = filters.filter_document;
          }
          if (filters.filter_user_id) {
            params.filter_user_id = filters.filter_user_id;
          }
          if (filters.sort_field) {
            params.sort_field = filters.sort_field;
          }
          if (filters.sort_order) {
            params.sort_order = filters.sort_order;
          }
        }

        const response = await axios.get<
          IApiResponse<ListChatContactsFinalResponse>
        >('/chat/contacts', {
          params,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async getChatContactById(
      contactId: string,
      force = false
    ): Promise<ViewChatContactResponse | null> {
      if (!force && this.chatContacts[contactId]) {
        return this.chatContacts[contactId];
      }

      if (this.loadingChatContacts[contactId]) {
        return null;
      }

      this.loadingChatContacts[contactId] = true;

      try {
        const response = await axios.get<IApiResponse<ViewChatContactResponse>>(
          `/chat/contacts/${contactId}`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          delete this.loadingChatContacts[contactId];
          return null;
        }

        this.chatContacts[contactId] = data.data;
        delete this.loadingChatContacts[contactId];

        return data.data;
      } catch {
        delete this.loadingChatContacts[contactId];
        return null;
      }
    },

    async getChatContactByPhone(
      phone: string,
      phoneDdi: string
    ): Promise<ViewChatContactByPhoneResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewChatContactByPhoneResponse>
        >('/chat/contacts/by-phone', {
          params: {
            phone,
            phone_ddi: phoneDdi,
          },
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async getChatContactsByIds(
      contactIds: string[]
    ): Promise<ViewChatContactResponse[]> {
      if (!contactIds.length) {
        return [];
      }

      try {
        const response = await axios.post<
          IApiResponse<ViewChatContactResponse[]>
        >('/chat/contacts/batch', {
          contact_ids: contactIds,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        for (const contact of data.data) {
          this.chatContacts[contact.contact_id] = contact;
        }

        return data.data;
      } catch {
        return [];
      }
    },

    async getChatContactEmailDecrypted(
      contactId: string
    ): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewChatContactEmailResponse>
        >(`/chat/contacts/${contactId}/email`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.email;
      } catch {
        return null;
      }
    },

    async getChatContactPhoneDecrypted(
      contactId: string
    ): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewChatContactPhoneResponse>
        >(`/chat/contacts/${contactId}/phone`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.phone;
      } catch {
        return null;
      }
    },

    async getChatContactDocumentDecrypted(
      contactId: string
    ): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewChatContactDocumentResponse>
        >(`/chat/contacts/${contactId}/document`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.document;
      } catch {
        return null;
      }
    },

    async listChatLabelTemplates(): Promise<ListChatLabelTemplatesResponse[]> {
      try {
        const response = await axios.get<
          IApiResponse<ListChatLabelTemplatesResponse[]>
        >('/chat/label-templates');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        return [];
      }
    },

    async listQuickMessageTemplates(
      command?: string | null
    ): Promise<ListQuickMessageTemplatesResponse[]> {
      try {
        const request: ListQuickMessageTemplatesRequest = {
          command: command ?? null,
        };

        const response = await axios.get<
          IApiResponse<ListQuickMessageTemplatesFinalResponse>
        >(`/chat/quick-message-templates`, {
          params: request,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data.results;
      } catch (error) {
        if (error instanceof AxiosError) {
          console.error('Error fetching quick message templates:', error);
        }

        return [];
      }
    },

    async createChatContact(
      payload: CreateContactRequest,
      photoFile?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = new FormData();
        const labelTemplateIds = extractArrayFieldValue(
          payload.label_template_ids as
            | string[]
            | Array<{ value: string }>
            | { value: string }
            | { value: string[] }
            | null
            | undefined
        );
        for (const labelTemplateId of labelTemplateIds) {
          formData.append('label_template_ids', labelTemplateId);
        }
        formData.append(
          'name',
          extractFieldValue(payload.name as string | { value: string })
        );
        const lastName = extractFieldValue(payload.last_name as FieldValue);
        if (lastName) {
          formData.append('last_name', lastName);
        }
        const email = extractFieldValue(payload.email as FieldValue);
        if (email) {
          formData.append('email', email);
        }
        formData.append(
          'phone_ddi',
          extractFieldValue(payload.phone_ddi as string | { value: string })
        );
        formData.append(
          'phone',
          extractFieldValue(payload.phone as string | { value: string })
        );
        const nickname = extractFieldValue(payload.nickname as FieldValue);
        if (nickname) {
          formData.append('nickname', nickname);
        }
        const birthday = extractFieldValue(payload.birthday as FieldValue);
        if (birthday) {
          formData.append('birthday', birthday);
        }
        const notes = extractFieldValue(payload.notes as FieldValue);
        if (notes) {
          formData.append('notes', notes);
        }
        const contactDocumentTypeId = extractFieldValue(
          payload.contact_document_type_id as FieldValue
        );
        if (contactDocumentTypeId) {
          formData.append('contact_document_type_id', contactDocumentTypeId);
        }
        const document = extractFieldValue(payload.document as FieldValue);
        if (document) {
          formData.append('document', document);
        }
        const imageUrl = extractFieldValue(payload.image_url as FieldValue);
        if (imageUrl) {
          formData.append('image_url', imageUrl);
        } else if (photoFile) {
          formData.append('photo', photoFile);
        }
        const chatId = extractFieldValue(payload.chat_id as FieldValue);
        if (chatId) {
          formData.append('chat_id', chatId);
        }
        if (payload.user_id !== undefined) {
          if (
            typeof payload.user_id === 'object' &&
            payload.user_id !== null &&
            'value' in payload.user_id &&
            payload.user_id.value === null
          ) {
            formData.append('user_id', '');
          } else {
            const userId = extractFieldValue(payload.user_id as FieldValue);
            if (userId) {
              formData.append('user_id', userId);
            }
          }
        }
        if (payload.ignore !== undefined) {
          const ignoreValue = extractFieldValue(payload.ignore as FieldValue);
          if (ignoreValue) {
            formData.append('ignore', ignoreValue);
          }
        }

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/contacts`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateChatContact(
      payload: EditContactParamsRequest,
      body: UpdateContactRequest,
      photoFile?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = new FormData();
        if (body.label_template_ids !== undefined) {
          const labelTemplateIds = extractArrayFieldValue(
            body.label_template_ids as
              | string[]
              | Array<{ value: string }>
              | { value: string }
              | { value: string[] }
              | null
              | undefined
          );
          if (labelTemplateIds.length === 0) {
            formData.append('label_template_ids', '');
          } else {
            for (const labelTemplateId of labelTemplateIds) {
              formData.append('label_template_ids', labelTemplateId);
            }
          }
        }
        const name = extractFieldValue(body.name as FieldValue);
        if (name) {
          formData.append('name', name);
        }
        const lastName = extractFieldValue(body.last_name as FieldValue);
        if (lastName) {
          formData.append('last_name', lastName);
        }
        const email = extractFieldValue(body.email as FieldValue);
        if (email) {
          formData.append('email', email);
        }
        const phoneDdi = extractFieldValue(body.phone_ddi as FieldValue);
        if (phoneDdi) {
          formData.append('phone_ddi', phoneDdi);
        }
        const phone = extractFieldValue(body.phone as FieldValue);
        if (phone) {
          formData.append('phone', phone);
        }
        const nickname = extractFieldValue(body.nickname as FieldValue);
        if (nickname) {
          formData.append('nickname', nickname);
        }
        const birthday = extractFieldValue(body.birthday as FieldValue);
        if (birthday) {
          formData.append('birthday', birthday);
        }
        const notes = extractFieldValue(body.notes as FieldValue);
        if (notes) {
          formData.append('notes', notes);
        }
        const contactDocumentTypeId = extractFieldValue(
          body.contact_document_type_id as FieldValue
        );
        if (
          contactDocumentTypeId !== undefined &&
          contactDocumentTypeId !== null
        ) {
          formData.append('contact_document_type_id', contactDocumentTypeId);
        }
        const document = extractFieldValue(body.document as FieldValue);
        if (document !== undefined && document !== null) {
          formData.append('document', document);
        }
        const imageUrl = extractFieldValue(body.image_url as FieldValue);
        if (imageUrl) {
          formData.append('image_url', imageUrl);
        } else if (photoFile) {
          formData.append('photo', photoFile);
        }
        if (body.user_id !== undefined) {
          const userIdValue = extractFieldValue(body.user_id as FieldValue);
          formData.append('user_id', userIdValue);
        }
        if (body.ignore !== undefined) {
          const ignoreValue = extractFieldValue(body.ignore as FieldValue);
          formData.append('ignore', ignoreValue);
        }

        const response = await axios.patch<IApiResponse<boolean>>(
          `/chat/contacts/${payload.contact_id}`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        await this.getChatContactById(payload.contact_id, true);

        this.showSnackbar(
          this.i18n.global.t('contact_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deleteChatContactPhoto(contactId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/chat/contacts/${contactId}/photo`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_photo_delete_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_photo_deleted_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_photo_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async removeChatContactLabelTemplate(
      contactId: string,
      labelTemplateId: string
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/chat/contacts/${contactId}/labels/${labelTemplateId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('contact_label_template_remove_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        await this.getChatContactById(contactId, true);

        this.showSnackbar(
          this.i18n.global.t('contact_label_template_removed_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'contact_label_template_remove_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async validateChatContact(contactId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/chat/contacts/${contactId}/validate`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('contact_validation_failed');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('contact_validation_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('contact_validation_failed');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async listTransferUsers(): Promise<TransferUserResponse[]> {
      try {
        const response = await axios.get<IApiResponse<TransferUserResponse[]>>(
          '/chat/transfer/users'
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage = this.i18n.global.t('error_loading_transfer_users');
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listTransferSectors(): Promise<TransferSectorResponse[]> {
      try {
        const response = await axios.get<
          IApiResponse<TransferSectorResponse[]>
        >('/chat/transfer/sectors');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage = this.i18n.global.t(
          'error_loading_transfer_sectors'
        );
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listTransferSectorUsers(
      sectorId: string
    ): Promise<TransferSectorUserResponse[]> {
      try {
        const response = await axios.get<
          IApiResponse<TransferSectorUserResponse[]>
        >(`/chat/transfer/sectors/${sectorId}/users`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return [];
        }

        return data.data;
      } catch {
        const errorMessage =
          this.i18n.global.t('transfer_sector_users_error') ||
          'Erro ao carregar usuários do setor';
        this.showSnackbar(errorMessage, EColor.error);
        return [];
      }
    },

    async listTransferOptions(): Promise<ListTransferOptionsResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListTransferOptionsResponse>
        >('/chat/transfer-options');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const errorMessage = this.i18n.global.t(
            'error_loading_transfer_options'
          );
          this.showSnackbar(errorMessage, EColor.error);
          return null;
        }

        return data.data;
      } catch {
        const errorMessage = this.i18n.global.t(
          'error_loading_transfer_options'
        );
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },

    async startChatWithContact(
      contactId: string,
      workerId: string,
      sectorId?: string | null
    ): Promise<IChat | null> {
      try {
        this.loading = true;

        const requestBody: {
          contact_id: string;
          worker_id: string;
          sector_id?: string;
        } = {
          contact_id: contactId,
          worker_id: workerId,
        };

        if (sectorId) {
          requestBody.sector_id = sectorId;
        }

        const response = await axios.post<IApiResponse<IChat>>(
          '/chat/start-with-contact',
          requestBody
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const errorMessage =
            data?.message || this.i18n.global.t('chat_creation_error');
          this.showSnackbar(errorMessage, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('chat_creation_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },

    async listLabelTemplates(): Promise<
      ListChatLabelTemplatesResponse[] | null
    > {
      try {
        const response = await axios.get<
          IApiResponse<ListChatLabelTemplatesResponse[]>
        >('/chat/label-templates');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        this.showSnackbar(
          this.i18n.global.t('label_template_all_list_error'),
          EColor.error
        );

        return null;
      }
    },

    async updateChatLabel(
      chatId: string,
      labelTemplateIds?: string[] | null,
      labelData?: ListChatsResult['label'] | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const body: {
          label_template_ids?:
            | Array<{ value: string }>
            | { value: string | null }
            | undefined;
        } = {};

        if (labelTemplateIds === null || labelTemplateIds === undefined) {
          body.label_template_ids = { value: null };
        } else if (labelTemplateIds.length === 0) {
          body.label_template_ids = { value: null };
        } else {
          body.label_template_ids = labelTemplateIds.map((id) => ({
            value: id,
          }));
        }

        const response = await axios.patch<IApiResponse<{ success: boolean }>>(
          `/chat/${chatId}/label`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const errorMessage =
            data?.message || this.i18n.global.t('chat_label_update_error');
          this.showSnackbar(errorMessage, EColor.error);

          return false;
        }

        if (this.activeChat?.chat_id === chatId) {
          let label: ListChatsResult['label'] | null = null;

          if (labelData !== undefined && labelData !== null) {
            label =
              labelData.length > 0
                ? labelData.map((lt) => ({
                    label_template_id: lt.label_template_id,
                    label: lt.label,
                    color: lt.color,
                  }))
                : null;
          } else if (labelTemplateIds && labelTemplateIds.length > 0) {
            const labels = await this.listLabelTemplates();
            const labelTemplates = labels?.filter((l) =>
              labelTemplateIds.includes(l.label_template_id)
            );

            if (labelTemplates && labelTemplates.length > 0) {
              label = labelTemplates.map((lt) => ({
                label_template_id: lt.label_template_id,
                label: lt.label,
                color: lt.color,
              }));
            }
          }

          const normalizedLabel = label && label.length > 0 ? [...label] : null;

          if (this.activeChat?.chat_id === chatId) {
            const updated: ListChatsResult = {
              chat_id: this.activeChat.chat_id,
              summary: this.activeChat.summary,
              account: this.activeChat.account,
              worker: this.activeChat.worker,
              sector: this.activeChat.sector,
              user: this.activeChat.user,
              contact: this.activeChat.contact,
              photo: this.activeChat.photo,
              name: this.activeChat.name,
              phone: this.activeChat.phone,
              status: this.activeChat.status,
              date: this.activeChat.date,
              started_at: this.activeChat.started_at,
              closed_at: this.activeChat.closed_at,
              label: normalizedLabel,
            };
            this.activeChat = updated;
          }

          const updateChatInList = (
            list: ListChatsResult[],
            chatId: string
          ) => {
            const idx = list.findIndex((c) => c.chat_id === chatId);
            if (idx !== -1) {
              const updatedChat = {
                ...list[idx],
                label: normalizedLabel,
              };
              list.splice(idx, 1, updatedChat);
            }
          };

          updateChatInList(this.listQueue, chatId);
          updateChatInList(this.listInChat, chatId);
          updateChatInList(this.listChatbot, chatId);
          updateChatInList(this.listClosed, chatId);
        }

        this.showSnackbar(
          this.i18n.global.t('chat_label_update_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;

        let errorMessage = this.i18n.global.t('chat_label_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async listChatWorkers(): Promise<ListChatWorkersResponse | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListChatWorkersResponse>>(
            '/chat/workers'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async listChatUsers(): Promise<ListChatUsersResponse | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListChatUsersResponse>>('/chat/users');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async listChatSectors(): Promise<ListChatSectorsResponse | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListChatSectorsResponse>>(
            '/chat/sectors'
          );

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
