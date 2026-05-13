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
import {
  ListChatsQuery,
  MY_CHATS_STATUS,
} from '@core/schema/chat/listChats/request.schema';
import { SearchChatsResponse } from '@core/schema/chat/searchChats/response.schema';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import {
  getUser,
  setUser,
  getPermissions,
  getSectors,
  getChannels,
} from '../localStorage/user';
import type { ListChatWorkersResponse } from '@core/schema/chat/listChatWorkers/response.schema';
import type { ListChatUsersResponse } from '@core/schema/chat/listChatUsers/response.schema';
import type { ListChatSectorsResponse } from '@core/schema/chat/listChatSectors/response.schema';
import type { GenerateAiReplyResponse } from '@core/schema/chat/generateAiReply/response.schema';
import type { TranscribeAudioResponse } from '@core/schema/chat/transcribeAudio/response.schema';
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
import { ListChatContactChannelsResponse } from '@core/schema/chat/listContactChannels/response.schema';
import { ListKanbanResponse } from '@core/schema/chat/listKanban/response.schema';
import { ListKanbanQuery } from '@core/schema/chat/listKanban/request.schema';
import { ForwardMessageResponse } from '@core/schema/chat/forwardMessage/response.schema';
import { ViewChatAttendantsResponse } from '@core/schema/chat/viewChatAttendants/response.schema';
import { BulkActionChatRequest } from '@core/schema/chat/bulkAction/request.schema';
import { BulkActionChatResponse } from '@core/schema/chat/bulkAction/response.schema';
import { ViewChatAttendanceInactivityResponse } from '@core/schema/chat/viewChatAttendanceInactivity/response.schema';
import { UpdateChatAttendanceInactivityRequest } from '@core/schema/chat/updateChatAttendanceInactivity/request.schema';
import { extractFieldValue } from '@core/common/functions/extractFieldValue';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';
import type { FieldValue } from '@core/common/interfaces/IFieldValue';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

type LocalMessageState = {
  status: 'uploading' | 'error';
  progress: number;
  errorMessage?: string;
};

type UploadOptions = {
  onUploadProgress?: (progress: number) => void;
  skipLoading?: boolean;
};

type ChatFilters = {
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
};

type KanbanFilters = {
  filter_worker_id: string | null;
  filter_name: string | null;
  filter_phone: string | null;
};

type ChatCounts = {
  total: number;
  queue: number;
  in_chat: number;
  chatbot: number;
  closed?: number;
  my_chats: number;
};

type ResolveChatEndpointResult = {
  results: ListChatsResult[];
  counts: ChatCounts | null;
};

const pickDefinedFilters = <T extends Record<string, unknown>>(
  filters: T,
  keys: (keyof T)[]
): Partial<T> => {
  const result: Partial<T> = {};
  for (const key of keys) {
    if (filters[key] !== null && filters[key] !== undefined) {
      result[key] = filters[key];
    }
  }
  return result;
};

const FILTER_KEYS = [
  'filter_label_template_id',
  'filter_worker_id',
  'filter_user_id',
  'filter_sector_id',
  'filter_name',
  'filter_phone',
  'filter_protocol',
  'filter_date_start',
  'filter_date_end',
] as const;

const buildJwtActions = (
  permissions: EPermissionsRoles[]
): IJwtGroupHierarchy[] =>
  permissions.map((permission) => ({
    account_id: '',
    permission_role_id: '',
    role_name: '',
    module_name: '',
    action_name: permission,
  }));

const LIST_FILTER_KEYS = FILTER_KEYS.filter((k) => k !== 'filter_user_id');

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

const normalizeMessageDeliverySummary = (
  summary?: ListMessageResult['summary'] | IChatMessage['summary'] | null
): ListMessageResult['summary'] | null => {
  if (!summary) {
    return null;
  }

  const isSeen = summary.is_seen === true;
  const isDelivered = summary.is_delivered === true || isSeen;
  const isSent = summary.is_sent === true || isDelivered;

  return {
    is_sent: isSent,
    is_delivered: isDelivered,
    is_seen: isSeen,
    is_sent_to_internal: summary.is_sent_to_internal === true,
  };
};

const mergeMessageDeliverySummary = (
  incoming?: ListMessageResult['summary'] | IChatMessage['summary'] | null,
  existing?: ListMessageResult['summary'] | IChatMessage['summary'] | null
): ListMessageResult['summary'] | null => {
  const normalizedIncoming = normalizeMessageDeliverySummary(incoming);
  const normalizedExisting = normalizeMessageDeliverySummary(existing);

  if (!normalizedIncoming && !normalizedExisting) {
    return null;
  }
  if (!normalizedIncoming) {
    return normalizedExisting;
  }
  if (!normalizedExisting) {
    return normalizedIncoming;
  }

  const isSeen = normalizedIncoming.is_seen || normalizedExisting.is_seen;
  const isDelivered =
    normalizedIncoming.is_delivered ||
    normalizedExisting.is_delivered ||
    isSeen;
  const isSent =
    normalizedIncoming.is_sent || normalizedExisting.is_sent || isDelivered;
  const hasDeliveryFailure =
    normalizedIncoming.is_sent_to_internal === false ||
    normalizedExisting.is_sent_to_internal === false;

  if (hasDeliveryFailure) {
    return {
      is_sent: false,
      is_delivered: false,
      is_seen: false,
      is_sent_to_internal: false,
    };
  }

  return {
    is_sent: isSent,
    is_delivered: isDelivered,
    is_seen: isSeen,
    is_sent_to_internal: true,
  };
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
    listScheduled: [] as ListChatsResult[],
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
    scheduledPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 0,
      total: 0,
    },
    myChatsTotal: null as number | null,
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
    kanbanChatbot: [] as ListChatsResult[],
    kanbanQueue: [] as ListChatsResult[],
    kanbanInChat: [] as ListChatsResult[],
    kanbanClosed: [] as ListChatsResult[],
    kanbanChatbotPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 0,
      total: 0,
    },
    kanbanQueuePagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 0,
      total: 0,
    },
    kanbanInChatPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 0,
      total: 0,
    },
    kanbanClosedPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 50,
      count: 0,
      total: 0,
    },
    kanbanFilters: {
      filter_worker_id: null,
      filter_name: null,
      filter_phone: null,
    } as KanbanFilters,
    loadingKanban: false,
    loadingKanbanColumn: null as string | null,
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
    sanitizeKanbanFilterValue(value: string | null | undefined): string | null {
      if (typeof value !== 'string') {
        return null;
      }

      const trimmedValue = value.trim();
      if (!trimmedValue) {
        return null;
      }

      return trimmedValue;
    },
    normalizeKanbanFilters(filters?: Partial<ChatFilters>): KanbanFilters {
      return {
        filter_worker_id: this.sanitizeKanbanFilterValue(
          filters?.filter_worker_id
        ),
        filter_name: this.sanitizeKanbanFilterValue(filters?.filter_name),
        filter_phone: this.sanitizeKanbanFilterValue(filters?.filter_phone),
      };
    },
    setKanbanFilters(filters?: Partial<ChatFilters>): KanbanFilters {
      const normalizedFilters = this.normalizeKanbanFilters(filters);
      this.kanbanFilters = normalizedFilters;
      return normalizedFilters;
    },
    getKanbanFilters(): KanbanFilters {
      return {
        ...this.kanbanFilters,
      };
    },
    hasActiveKanbanFilters(): boolean {
      return Boolean(
        this.kanbanFilters.filter_worker_id ||
        this.kanbanFilters.filter_name ||
        this.kanbanFilters.filter_phone
      );
    },
    applyKanbanFiltersToQuery(
      params: ListKanbanQuery,
      filters: KanbanFilters
    ): void {
      if (filters.filter_worker_id) {
        params.filter_worker_id = filters.filter_worker_id;
      }

      if (filters.filter_name) {
        params.filter_name = filters.filter_name;
      }

      if (filters.filter_phone) {
        params.filter_phone = filters.filter_phone;
      }
    },
    async loadKanbanInitial(filters?: Partial<ChatFilters>): Promise<void> {
      if (this.loadingKanban) return;

      this.loadingKanban = true;
      try {
        const resolvedFilters = filters
          ? this.setKanbanFilters(filters)
          : this.getKanbanFilters();
        const params: ListKanbanQuery = {
          chatbot_page: 1,
          queue_page: 1,
          in_chat_page: 1,
          closed_page: 1,
          per_page: 50,
        };
        this.applyKanbanFiltersToQuery(params, resolvedFilters);

        const response = await axios.get<IApiResponse<ListKanbanResponse>>(
          '/chat/kanban',
          { params }
        );

        const data = response?.data;
        if (!data?.status || !data?.data) {
          this.loadingKanban = false;
          return;
        }

        const d = data.data;

        this.kanbanChatbot = d.chatbot.results;
        this.kanbanQueue = d.queue.results;
        this.kanbanInChat = d.in_chat.results;
        this.kanbanClosed = d.closed.results;
        this.kanbanChatbotPagings = { ...d.chatbot.pagings };
        this.kanbanQueuePagings = { ...d.queue.pagings };
        this.kanbanInChatPagings = { ...d.in_chat.pagings };
        this.kanbanClosedPagings = { ...d.closed.pagings };
      } catch {
        this.showSnackbar(
          this.i18n.global.t('chat_list_not_found'),
          EColor.error
        );
      } finally {
        this.loadingKanban = false;
      }
    },
    async loadMoreKanbanColumn(
      column: 'chatbot' | 'queue' | 'in_chat' | 'closed'
    ): Promise<void> {
      if (this.loadingKanbanColumn) return;
      const columnToKey: Record<
        'chatbot' | 'queue' | 'in_chat' | 'closed',
        {
          list:
            | 'kanbanChatbot'
            | 'kanbanQueue'
            | 'kanbanInChat'
            | 'kanbanClosed';
          pagings:
            | 'kanbanChatbotPagings'
            | 'kanbanQueuePagings'
            | 'kanbanInChatPagings'
            | 'kanbanClosedPagings';
        }
      > = {
        chatbot: { list: 'kanbanChatbot', pagings: 'kanbanChatbotPagings' },
        queue: { list: 'kanbanQueue', pagings: 'kanbanQueuePagings' },
        in_chat: { list: 'kanbanInChat', pagings: 'kanbanInChatPagings' },
        closed: { list: 'kanbanClosed', pagings: 'kanbanClosedPagings' },
      };
      const { list: listKey, pagings: pagingsKey } = columnToKey[column];
      const pagings = this[pagingsKey];
      if (pagings.current_page >= pagings.total_pages) return;
      this.loadingKanbanColumn = column;
      const nextPage = pagings.current_page + 1;

      try {
        const activeKanbanFilters = this.getKanbanFilters();
        const params: ListKanbanQuery = {
          chatbot_page: column === 'chatbot' ? nextPage : 1,
          queue_page: column === 'queue' ? nextPage : 1,
          in_chat_page: column === 'in_chat' ? nextPage : 1,
          closed_page: column === 'closed' ? nextPage : 1,
          per_page: 50,
        };
        this.applyKanbanFiltersToQuery(params, activeKanbanFilters);
        const response = await axios.get<IApiResponse<ListKanbanResponse>>(
          '/chat/kanban',
          { params }
        );
        const data = response?.data;
        if (!data?.status || !data?.data) {
          this.loadingKanbanColumn = null;
          return;
        }
        const d = data.data;
        const col = d[column];
        const existingIds = new Set(
          (this[listKey] as ListChatsResult[]).map((c) => c.chat_id)
        );
        const newItems = col.results.filter((c) => !existingIds.has(c.chat_id));
        (this[listKey] as ListChatsResult[]).push(...newItems);
        this[pagingsKey] = { ...col.pagings };
      } catch {
        this.showSnackbar(
          this.i18n.global.t('chat_list_not_found'),
          EColor.error
        );
      } finally {
        this.loadingKanbanColumn = null;
      }
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
        this.listMessages.push({
          ...message,
          summary: normalizeMessageDeliverySummary(message.summary),
        });
        return;
      }

      const idx = this.listMessages.findIndex(
        (item) => item.hash === message.hash
      );
      if (idx !== -1) {
        const existing = this.listMessages[idx];
        const next: ListMessageResult = {
          ...message,
          summary: mergeMessageDeliverySummary(
            message.summary,
            existing.summary
          ),
        };
        cleanupMessageMedia(this.listMessages[idx]);
        this.listMessages.splice(idx, 1, next);
        return;
      }
      this.listMessages.push({
        ...message,
        summary: normalizeMessageDeliverySummary(message.summary),
      });
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
        summary: normalizeMessageDeliverySummary(message.summary),
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
        const existing = this.listMessages[existingIndex];
        const next: ListMessageResult = {
          ...input,
          summary: mergeMessageDeliverySummary(input.summary, existing.summary),
        };
        const [removed] = this.listMessages.splice(existingIndex, 1, next);
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

    removeChatFromListsByRestriction(
      chat: IChat,
      previousWasInQueue: boolean,
      previousWasInChatbot: boolean,
      previousWasInScheduled: boolean,
      previousWasInClosed: boolean
    ): void {
      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listScheduled, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);

      if (this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (previousWasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (previousWasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (previousWasInScheduled && this.scheduledPagings.total > 0) {
        this.scheduledPagings.total = Math.max(
          0,
          this.scheduledPagings.total - 1
        );
      }

      if (previousWasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = null;
      }
    },

    removeChatIfNotAuthorized(chat: IChat): void {
      const previousChat =
        this.activeChat?.chat_id === chat.chat_id
          ? this.activeChat
          : this.findChatInLists(chat.chat_id);
      const previousStatus = previousChat?.status ?? null;
      const previousWasParticipant =
        this.isCurrentUserParticipant(previousChat);
      const wasInQueue = this.listQueue.some((c) => c.chat_id === chat.chat_id);
      const wasInInChat = this.listInChat.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInChatbot = this.listChatbot.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInScheduled = this.listScheduled.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInClosed = this.listClosed.some(
        (c) => c.chat_id === chat.chat_id
      );

      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listScheduled, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);

      if (wasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (wasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (wasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (wasInScheduled && this.scheduledPagings.total > 0) {
        this.scheduledPagings.total = Math.max(
          0,
          this.scheduledPagings.total - 1
        );
      }

      if (wasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (previousStatus) {
        this.updateMyChatsTotalFromTransition(
          previousStatus,
          previousWasParticipant,
          '',
          false
        );
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = null;
      }
    },

    shouldRemoveQueueChat(
      chat: IChat,
      userSectors: string[],
      canListAllChatsInSector = false
    ): boolean {
      const userChannels = getChannels();
      if (userChannels.length > 0) {
        const channelIds = userChannels.map((c) => c.id);
        if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
          return true;
        }
      }

      if (canListAllChatsInSector && !chat.sector?.id) {
        return false;
      }
      if (userSectors.length > 0) {
        const result =
          !chat.sector?.id || !userSectors.includes(chat.sector.id);
        return result;
      }
      const result = !!chat.sector?.id;
      return result;
    },

    normalizeSecondaryUsers(
      users:
        | ListChatsResult['secondary_users']
        | IChat['secondary_users']
        | null
        | undefined
    ): NonNullable<ListChatsResult['secondary_users']> {
      if (!Array.isArray(users)) {
        return [];
      }

      return users
        .filter((user) => !!user?.id)
        .map((user) => ({
          id: user.id,
          name: user.name,
          photo: user.photo ?? null,
          entered_at: user.entered_at ?? null,
        }));
    },

    isCurrentUserPrimary(
      chat:
        | Pick<ListChatsResult, 'user'>
        | Pick<IChat, 'user'>
        | null
        | undefined
    ): boolean {
      const currentUserId = this.user?.user_id ?? null;
      if (!currentUserId || !chat?.user?.id) {
        return false;
      }

      return chat.user.id === currentUserId;
    },

    isCurrentUserParticipant(
      chat:
        | Pick<ListChatsResult, 'user' | 'secondary_users'>
        | Pick<IChat, 'user' | 'secondary_users'>
        | null
        | undefined
    ): boolean {
      if (!chat) {
        return false;
      }

      if (this.isCurrentUserPrimary(chat)) {
        return true;
      }

      const currentUserId = this.user?.user_id ?? null;
      if (!currentUserId) {
        return false;
      }

      return this.normalizeSecondaryUsers(chat.secondary_users).some(
        (secondaryUser) => secondaryUser.id === currentUserId
      );
    },

    hasAnyParticipants(
      chat:
        | Pick<ListChatsResult, 'user' | 'secondary_users'>
        | Pick<IChat, 'user' | 'secondary_users'>
        | null
        | undefined
    ): boolean {
      if (!chat) {
        return false;
      }

      return (
        !!chat.user?.id ||
        this.normalizeSecondaryUsers(chat.secondary_users).length > 0
      );
    },

    resolveChatSnapshot(
      incomingChat: IChat,
      snapshot: ListChatsResult | null
    ): IChat {
      if (!snapshot) {
        return incomingChat;
      }

      const isPartialUpdate =
        typeof incomingChat.account === 'undefined' ||
        typeof incomingChat.worker === 'undefined' ||
        typeof incomingChat.name === 'undefined' ||
        typeof incomingChat.phone === 'undefined' ||
        typeof incomingChat.date === 'undefined';

      const resolveOptionalPartialNull = <T>(
        incoming: T | null | undefined,
        fallback: T | null | undefined
      ) => {
        if (typeof incoming === 'undefined') {
          return fallback;
        }
        if (incoming === null && isPartialUpdate) {
          return fallback;
        }
        return incoming;
      };
      const resolveRequired = <T>(incoming: T | undefined, fallback: T): T =>
        typeof incoming === 'undefined' ? fallback : incoming;

      return {
        ...incomingChat,
        summary: resolveOptionalPartialNull(
          incomingChat.summary,
          snapshot.summary
        ),
        account: resolveRequired(incomingChat.account, snapshot.account),
        worker: resolveRequired(incomingChat.worker, snapshot.worker),
        sector: resolveOptionalPartialNull(
          incomingChat.sector,
          snapshot.sector
        ),
        user: resolveOptionalPartialNull(incomingChat.user, snapshot.user),
        secondary_users: this.normalizeSecondaryUsers(
          resolveOptionalPartialNull(
            incomingChat.secondary_users,
            snapshot.secondary_users
          )
        ),
        contact: resolveOptionalPartialNull(
          incomingChat.contact,
          snapshot.contact
        ),
        photo: resolveOptionalPartialNull(incomingChat.photo, snapshot.photo),
        name: resolveRequired(incomingChat.name, snapshot.name),
        phone: resolveRequired(incomingChat.phone, snapshot.phone),
        date: resolveRequired(incomingChat.date, snapshot.date),
        started_at: resolveOptionalPartialNull(
          incomingChat.started_at,
          snapshot.started_at
        ),
        closed_at: resolveOptionalPartialNull(
          incomingChat.closed_at,
          snapshot.closed_at
        ),
        protocol_ura: resolveOptionalPartialNull(
          incomingChat.protocol_ura,
          snapshot.protocol_ura
        ),
        protocol_start: resolveOptionalPartialNull(
          incomingChat.protocol_start,
          snapshot.protocol_start
        ),
        protocol_transfer: resolveOptionalPartialNull(
          incomingChat.protocol_transfer,
          snapshot.protocol_transfer
        ),
        label: resolveOptionalPartialNull(incomingChat.label, snapshot.label),
        forward_to_output_chatbot: resolveOptionalPartialNull(
          incomingChat.forward_to_output_chatbot,
          snapshot.forward_to_output_chatbot
        ),
      };
    },

    handleQueueAuthorization(params: {
      resolvedChat: IChat;
      incomingChat: IChat;
      existingSnapshot: ListChatsResult | null;
      permissions: EPermissionsRoles[];
      canViewOthersChats: boolean;
      canListAllChatsInSector: boolean;
      canListAllChatsWithoutSectorLimit: boolean;
      hasPermissionToViewAll: boolean;
    }): boolean {
      const { resolvedChat, canListAllChatsInSector } = params;

      const userChannels = getChannels();
      if (userChannels.length > 0) {
        const channelIds = userChannels.map((c) => c.id);
        if (
          !resolvedChat.worker?.id ||
          !channelIds.includes(resolvedChat.worker.id)
        ) {
          this.removeChatIfNotAuthorized(resolvedChat);
          return false;
        }
      }

      const isCurrentUserParticipant =
        this.isCurrentUserParticipant(resolvedChat);
      const hasParticipants = this.hasAnyParticipants(resolvedChat);

      if (hasParticipants && !isCurrentUserParticipant) {
        this.removeChatIfNotAuthorized(resolvedChat);
        return false;
      }

      if (hasParticipants) {
        return true;
      }

      const userSectors = getSectors();
      if (
        !this.shouldRemoveQueueChat(
          resolvedChat,
          userSectors,
          canListAllChatsInSector
        )
      ) {
        return true;
      }

      const sectorId = resolvedChat.sector?.id ?? null;
      const isChatInUserSectors =
        (!!sectorId && userSectors.includes(sectorId)) ||
        (canListAllChatsInSector && !sectorId);
      const isAlreadyVisible =
        this.activeChat?.chat_id === resolvedChat.chat_id ||
        this.isChatInAnyList(resolvedChat.chat_id);

      if (canListAllChatsInSector && sectorId && !isChatInUserSectors) {
        if (isAlreadyVisible) {
          return true;
        }
      }

      this.removeChatIfNotAuthorized(resolvedChat);
      return false;
    },

    addChat(chat: IChat, skipEvents = false) {
      const permissions = getPermissions();
      const previousChat = this.findChatInLists(chat.chat_id);
      const wasInAnyList = !!previousChat;
      const shouldSkipEvents = skipEvents
        ? true
        : this.shouldSkipChatStatusEvents(chat.chat_id);
      const isActiveChat = this.activeChat?.chat_id === chat.chat_id;
      const existingSnapshot = isActiveChat ? this.activeChat : previousChat;

      if (this.shouldIgnoreChatUpdate(existingSnapshot, chat, skipEvents)) {
        return;
      }

      const resolvedChat = this.resolveChatSnapshot(chat, existingSnapshot);
      if (!this.canViewChat(resolvedChat)) {
        this.removeChatIfNotAuthorized(resolvedChat);
        return;
      }

      const canViewOthersChats = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group
      );
      const canListAllChatsInSector = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group ||
          perm === EChatPermissions.list_all_chats_in_sector
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

      const userChannels = getChannels();
      if (userChannels.length > 0) {
        const channelIds = userChannels.map((c) => c.id);
        if (
          !resolvedChat.worker?.id ||
          !channelIds.includes(resolvedChat.worker.id)
        ) {
          this.removeChatIfNotAuthorized(resolvedChat);
          return;
        }
      }

      if (resolvedChat.status === EChatStatus.in_chat) {
        if (
          !hasPermissionToViewAll &&
          !this.isCurrentUserParticipant(resolvedChat)
        ) {
          const userSectors = getSectors();
          const isAlreadyVisible =
            this.activeChat?.chat_id === resolvedChat.chat_id ||
            this.isChatInAnyList(resolvedChat.chat_id);
          const isChatInUserSectors =
            (userSectors.length > 0 &&
              resolvedChat.sector?.id &&
              userSectors.includes(resolvedChat.sector.id)) ||
            (userSectors.length === 0 && !resolvedChat.sector?.id) ||
            (canListAllChatsInSector && !resolvedChat.sector?.id);
          const canViewBySector =
            canListAllChatsInSector &&
            (isChatInUserSectors || isAlreadyVisible);
          if (!canViewBySector) {
            this.removeChatIfNotAuthorized(resolvedChat);
            return;
          }
        }
      }

      if (!hasPermissionToViewAll) {
        if (resolvedChat.status === EChatStatus.queue) {
          const canContinue = this.handleQueueAuthorization({
            resolvedChat,
            incomingChat: chat,
            existingSnapshot,
            permissions,
            canViewOthersChats,
            canListAllChatsInSector,
            canListAllChatsWithoutSectorLimit,
            hasPermissionToViewAll,
          });

          if (!canContinue) {
            return;
          }
        }
      }

      const previousStatus = isActiveChat
        ? (this.activeChat?.status ?? previousChat?.status ?? null)
        : (previousChat?.status ?? null);
      const previousWasParticipant = isActiveChat
        ? this.isCurrentUserParticipant(this.activeChat ?? previousChat)
        : this.isCurrentUserParticipant(previousChat);
      const nextIsParticipant = this.isCurrentUserParticipant(resolvedChat);

      const input: ListChatsResult = {
        chat_id: resolvedChat.chat_id,
        summary: resolvedChat.summary,
        account: resolvedChat.account,
        worker: resolvedChat.worker,
        sector: resolvedChat.sector,
        user: resolvedChat.user,
        secondary_users: this.normalizeSecondaryUsers(
          resolvedChat.secondary_users
        ),
        contact: resolvedChat.contact,
        photo: resolvedChat.photo,
        name: resolvedChat.name,
        phone: resolvedChat.phone,
        status: resolvedChat.status,
        date: resolvedChat.date,
        started_at: resolvedChat.started_at,
        closed_at: resolvedChat.closed_at,
        protocol_ura: resolvedChat.protocol_ura ?? null,
        protocol_start: resolvedChat.protocol_start ?? null,
        protocol_transfer: resolvedChat.protocol_transfer ?? null,
        label: resolvedChat.label ?? null,
        forward_to_output_chatbot: resolvedChat.forward_to_output_chatbot,
      };

      this.updateActiveChatSummaryIfNeeded(resolvedChat, isActiveChat);

      if (this.pendingStatusUpdateChatId === resolvedChat.chat_id) {
        this.loading = false;
        this.pendingStatusUpdateChatId = null;
      }

      if (resolvedChat.status === EChatStatus.queue) {
        this.handleQueueStatusChat(
          input,
          resolvedChat,
          isActiveChat,
          previousStatus
        );
      } else if (resolvedChat.status === EChatStatus.in_chat) {
        this.handleInChatStatusChat(
          input,
          resolvedChat,
          isActiveChat,
          previousStatus
        );
      } else if (this.isChatbotStatus(resolvedChat.status)) {
        this.handleUraStatusChat(
          input,
          resolvedChat,
          isActiveChat,
          previousStatus
        );
      } else if (this.isScheduledStatus(resolvedChat.status)) {
        this.handleScheduledStatusChat(
          input,
          resolvedChat,
          isActiveChat,
          previousStatus
        );
      } else if (resolvedChat.status === EChatStatus.closed) {
        this.handleClosedStatusChat(
          input,
          resolvedChat,
          isActiveChat,
          previousStatus
        );
      }

      this.syncChatToKanbanLists(input);

      this.updateMyChatsTotalFromTransition(
        previousStatus,
        previousWasParticipant,
        resolvedChat.status,
        nextIsParticipant
      );

      if (!shouldSkipEvents && !wasInAnyList) {
        this.markSkipChatStatusEvents(resolvedChat.chat_id);
        globalThis.dispatchEvent(
          new CustomEvent('chat-status-changed', {
            detail: { chat: resolvedChat, reason: 'new' },
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
        operator_reply_pending_since:
          chat.summary.operator_reply_pending_since ??
          this.activeChat.summary.operator_reply_pending_since ??
          null,
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
        operator_reply_pending_since:
          input.summary?.operator_reply_pending_since ??
          existingSummary.operator_reply_pending_since ??
          null,
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
        secondary_users: this.normalizeSecondaryUsers(input.secondary_users),
        contact: input.contact,
        photo: input.photo,
        name: input.name,
        phone: input.phone,
        status: input.status,
        date: input.date,
        started_at: input.started_at,
        label: input.label,
        closed_at: input.closed_at,
        protocol_ura: input.protocol_ura ?? null,
        protocol_start: input.protocol_start ?? null,
        protocol_transfer: input.protocol_transfer ?? null,
        forward_to_output_chatbot: input.forward_to_output_chatbot,
      };
      return result;
    },

    removeFromList(arr: ListChatsResult[], chatId: string): void {
      const idx = arr.findIndex((c) => c.chat_id === chatId);
      if (idx !== -1) {
        arr.splice(idx, 1);
      }
    },

    syncChatToKanbanLists(chat: ListChatsResult): void {
      const chatId = chat.chat_id;
      this.removeFromList(this.kanbanChatbot, chatId);
      this.removeFromList(this.kanbanQueue, chatId);
      this.removeFromList(this.kanbanInChat, chatId);
      this.removeFromList(this.kanbanClosed, chatId);
      if (this.isChatbotStatus(chat.status)) {
        this.kanbanChatbot.push(chat);
        this.sortChatList(this.kanbanChatbot, EChatStatus.ura);
        return;
      }
      if (chat.status === EChatStatus.queue) {
        this.kanbanQueue.push(chat);
        this.sortChatList(this.kanbanQueue, EChatStatus.queue);
        return;
      }
      if (chat.status === EChatStatus.in_chat) {
        this.kanbanInChat.push(chat);
        this.sortChatList(this.kanbanInChat, EChatStatus.in_chat);
        return;
      }
      if (chat.status === EChatStatus.closed) {
        this.kanbanClosed.push(chat);
        this.sortChatList(this.kanbanClosed, EChatStatus.closed);
      }
    },

    updateMyChatsTotal(delta: number): void {
      if (this.myChatsTotal === null) {
        return;
      }
      this.myChatsTotal = Math.max(0, this.myChatsTotal + delta);
    },

    isMyChatStatus(status: string | null | undefined): boolean {
      return status === EChatStatus.queue || status === EChatStatus.in_chat;
    },

    isChatbotStatus(status: string | null | undefined): boolean {
      return (
        status === EChatStatus.ura ||
        status === EChatStatus.ura_output ||
        status === EChatStatus.ura_webhook
      );
    },

    isScheduledStatus(status: string | null | undefined): boolean {
      return status === EChatStatus.ura_schedule;
    },

    findChatInLists(chatId: string): ListChatsResult | null {
      return (
        this.listQueue.find((c) => c.chat_id === chatId) ||
        this.listInChat.find((c) => c.chat_id === chatId) ||
        this.listChatbot.find((c) => c.chat_id === chatId) ||
        this.listScheduled.find((c) => c.chat_id === chatId) ||
        this.listClosed.find((c) => c.chat_id === chatId) ||
        null
      );
    },

    updateMyChatsTotalFromTransition(
      previousStatus: string | null,
      previousWasParticipant: boolean,
      nextStatus: string,
      nextIsParticipant: boolean
    ): void {
      if (this.myChatsTotal === null) {
        return;
      }

      const wasMyChat =
        previousWasParticipant && this.isMyChatStatus(previousStatus);
      const isMyChatNow = nextIsParticipant && this.isMyChatStatus(nextStatus);

      if (wasMyChat === isMyChatNow) {
        return;
      }

      this.updateMyChatsTotal(isMyChatNow ? 1 : -1);
    },

    getChatUpdateTimestamp(
      chat:
        | {
            summary?: { last_date?: string | null } | null;
            date?: string | null;
          }
        | null
        | undefined
    ): number | null {
      if (!chat) {
        return null;
      }

      const summary = (chat as any).summary as
        | {
            last_date?: string | null;
            last_date_epoch_millis?: number | string;
          }
        | null
        | undefined;

      const epoch = summary?.last_date_epoch_millis;
      if (typeof epoch === 'number' && Number.isFinite(epoch)) {
        return epoch;
      }
      if (typeof epoch === 'string') {
        const parsedEpoch = Number(epoch);
        if (Number.isFinite(parsedEpoch)) {
          return parsedEpoch;
        }
      }

      if (summary?.last_date) {
        const parsedDate = Date.parse(summary.last_date);
        if (!Number.isNaN(parsedDate)) {
          return parsedDate;
        }
      }

      if (chat.date) {
        const parsedDate = Date.parse(chat.date);
        if (!Number.isNaN(parsedDate)) {
          return parsedDate;
        }
      }

      return null;
    },

    getStatusRank(status: string | null | undefined): number | null {
      if (!status) {
        return null;
      }

      const ranks: Record<string, number> = {
        [EChatStatus.ura]: 0,
        [EChatStatus.ura_output]: 0,
        [EChatStatus.ura_schedule]: 0,
        [EChatStatus.ura_webhook]: 0,
        [EChatStatus.queue]: 1,
        [EChatStatus.in_chat]: 2,
        [EChatStatus.closed]: 3,
        [EChatStatus.transmission]: 0,
      };

      const rank = ranks[status];
      return typeof rank === 'number' ? rank : null;
    },

    shouldIgnoreChatUpdate(
      existingChat: ListChatsResult | null,
      incomingChat: IChat,
      skipEvents: boolean
    ): boolean {
      if (skipEvents || !existingChat) {
        return false;
      }

      const existingStatus = existingChat.status ?? null;
      const incomingStatus = incomingChat.status ?? null;

      if (
        incomingStatus &&
        (this.isChatbotStatus(incomingStatus) ||
          this.isScheduledStatus(incomingStatus) ||
          incomingStatus === EChatStatus.transmission) &&
        (existingStatus === EChatStatus.queue ||
          existingStatus === EChatStatus.in_chat ||
          existingStatus === EChatStatus.closed)
      ) {
        return true;
      }

      if (
        existingStatus === EChatStatus.in_chat &&
        incomingStatus === EChatStatus.queue &&
        incomingChat.forward_to_output_chatbot === true
      ) {
        return false;
      }

      const existingRank = this.getStatusRank(existingChat.status);
      const incomingRank = this.getStatusRank(incomingChat.status);

      if (existingRank === null || incomingRank === null) {
        return false;
      }

      if (incomingRank >= existingRank) {
        return false;
      }

      const existingTimestamp = this.getChatUpdateTimestamp(existingChat);
      const incomingTimestamp = this.getChatUpdateTimestamp(incomingChat);

      if (existingTimestamp === null || incomingTimestamp === null) {
        return false;
      }

      return incomingTimestamp <= existingTimestamp;
    },

    isChatInAnyList(chatId: string): boolean {
      return (
        this.listQueue.some((c) => c.chat_id === chatId) ||
        this.listInChat.some((c) => c.chat_id === chatId) ||
        this.listChatbot.some((c) => c.chat_id === chatId) ||
        this.listScheduled.some((c) => c.chat_id === chatId) ||
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
    ): boolean {
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
        return false;
      }

      arr.push(input);
      if (status) {
        this.sortChatList(arr, status);
      }
      return true;
    },

    getSortForStatus(status: EChatStatus): {
      sortBy: string;
      sortOrder: string;
    } {
      const chatUser = this.user?.chat_user;
      const fallbackSort = {
        sortBy: 'summary.last_message',
        sortOrder: 'desc',
      };
      if (!chatUser) {
        return fallbackSort;
      }

      // "Em Atendimento" individual - usa preferências de "Todos"
      if (status === EChatStatus.in_chat) {
        return {
          sortBy: chatUser.sort_by_chat_order ?? fallbackSort.sortBy,
          sortOrder: chatUser.sort_in_chat_order ?? fallbackSort.sortOrder,
        };
      }

      // "Fechado" segue as mesmas preferências de "Todos" no backend
      if (status === EChatStatus.closed) {
        return {
          sortBy: chatUser.sort_by_chat_order ?? fallbackSort.sortBy,
          sortOrder: chatUser.sort_in_chat_order ?? fallbackSort.sortOrder,
        };
      }

      // "Aguardando atendimento"
      if (status === EChatStatus.queue) {
        return {
          sortBy: chatUser.sort_by_queue_order ?? fallbackSort.sortBy,
          sortOrder: chatUser.sort_queue_order ?? fallbackSort.sortOrder,
        };
      }

      if (this.isChatbotStatus(status)) {
        return {
          sortBy: chatUser.sort_by_chatbot_order ?? fallbackSort.sortBy,
          sortOrder: chatUser.sort_chatbot_order ?? fallbackSort.sortOrder,
        };
      }

      return fallbackSort;
    },

    getFieldValue(chat: ListChatsResult, field: string): any {
      if (field === 'summary.last_message') {
        return chat.summary?.last_date || chat.summary?.last_message || '';
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
      const userSectors = getSectors();
      const userChannels = getChannels();

      return canReadChatByPolicy({
        chat,
        userId: this.user?.user_id ?? '',
        actions: buildJwtActions(permissions),
        userSectors,
        userChannels,
      });
    },

    revalidateChannelAccess(): void {
      const userChannels = getChannels();
      if (userChannels.length === 0) {
        return;
      }

      const channelIds = new Set(userChannels.map((c) => c.id));
      const shouldRemove = (
        chat: ListChatsResult | null | undefined
      ): boolean => !chat?.worker?.id || !channelIds.has(chat.worker.id);

      const chatsToRemove = new Map<string, IChat>();

      const collect = (chat: ListChatsResult): void => {
        if (shouldRemove(chat)) {
          chatsToRemove.set(chat.chat_id, chat as IChat);
        }
      };

      this.listQueue.forEach(collect);
      this.listInChat.forEach(collect);
      this.listChatbot.forEach(collect);
      this.listScheduled.forEach(collect);
      this.listClosed.forEach(collect);

      if (this.activeChat && shouldRemove(this.activeChat)) {
        chatsToRemove.set(this.activeChat.chat_id, this.activeChat as IChat);
      }

      for (const chat of chatsToRemove.values()) {
        this.removeChatIfNotAuthorized(chat);
      }
    },

    handleQueueStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean,
      previousStatus: string | null
    ): void {
      const permissions = getPermissions();
      const canViewOthersChats = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group
      );
      const canListAllChatsInSector = permissions.some(
        (perm: EPermissionsRoles) =>
          perm === EGeneralPermissions.full_access ||
          perm === EGeneralPermissions.full_access_group ||
          perm === EChatPermissions.chat_group ||
          perm === EChatPermissions.list_all_chats_in_sector
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
      const existingInQueue = this.listQueue.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInInChat = this.listInChat.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInChatbot = this.listChatbot.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInScheduled = this.listScheduled.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInClosed = this.listClosed.find(
        (c) => c.chat_id === chat.chat_id
      );

      const wasInQueue = !!existingInQueue;
      const wasInInChat = !!existingInInChat;
      const wasInChatbot = !!existingInChatbot;
      const wasInScheduled = !!existingInScheduled;
      const wasInClosed = !!existingInClosed;
      const previousWasInQueue =
        wasInQueue || previousStatus === EChatStatus.queue;
      const previousWasInInChat =
        wasInInChat || previousStatus === EChatStatus.in_chat;
      const previousWasInChatbot =
        wasInChatbot || this.isChatbotStatus(previousStatus);
      const previousWasInScheduled =
        wasInScheduled || this.isScheduledStatus(previousStatus);
      const previousWasInClosed =
        wasInClosed || previousStatus === EChatStatus.closed;

      if (wasInInChat) {
        const isStillMine = this.isCurrentUserParticipant(chat);

        if (!isStillMine && !hasPermissionToViewAll) {
          const userChannels = getChannels();
          const channelIds = userChannels.map((c) => c.id);
          const isChatOutsideUserChannels =
            userChannels.length > 0 &&
            (!chat.worker?.id || !channelIds.includes(chat.worker.id));

          if (isChatOutsideUserChannels) {
            this.removeChatFromListsByRestriction(
              chat,
              previousWasInQueue,
              previousWasInChatbot,
              previousWasInScheduled,
              previousWasInClosed
            );
            return;
          }

          const userSectors = getSectors();
          const sectorId = chat.sector?.id ?? null;
          const isChatInUserSectors =
            (!!sectorId && userSectors.includes(sectorId)) ||
            (canListAllChatsInSector && !sectorId);
          const canViewBySector =
            canListAllChatsInSector && (isChatInUserSectors || wasInInChat);

          if (!canViewBySector) {
            this.removeChatFromListsByRestriction(
              chat,
              previousWasInQueue,
              previousWasInChatbot,
              previousWasInScheduled,
              previousWasInClosed
            );
            return;
          }
        }
      }

      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listScheduled, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);
      const wasAdded = this.replaceOrPushInList(
        this.listQueue,
        input,
        isActiveChat,
        EChatStatus.queue
      );

      if (wasAdded && !previousWasInQueue) {
        this.queuePagings.total = (this.queuePagings.total || 0) + 1;
      }

      if (previousWasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (previousWasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (previousWasInScheduled && this.scheduledPagings.total > 0) {
        this.scheduledPagings.total = Math.max(
          0,
          this.scheduledPagings.total - 1
        );
      }

      if (previousWasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = this.createUpdatedActiveChat(input, isActiveChat);
      }
    },

    handleInChatStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean,
      previousStatus: string | null
    ): void {
      const existingInQueue = this.listQueue.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInInChat = this.listInChat.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInChatbot = this.listChatbot.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInScheduled = this.listScheduled.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInClosed = this.listClosed.find(
        (c) => c.chat_id === chat.chat_id
      );

      const wasInQueue = !!existingInQueue;
      const wasInInChat = !!existingInInChat;
      const wasInChatbot = !!existingInChatbot;
      const wasInScheduled = !!existingInScheduled;
      const wasInClosed = !!existingInClosed;
      const previousWasInQueue =
        wasInQueue || previousStatus === EChatStatus.queue;
      const previousWasInInChat =
        wasInInChat || previousStatus === EChatStatus.in_chat;
      const previousWasInChatbot =
        wasInChatbot || this.isChatbotStatus(previousStatus);
      const previousWasInScheduled =
        wasInScheduled || this.isScheduledStatus(previousStatus);
      const previousWasInClosed =
        wasInClosed || previousStatus === EChatStatus.closed;

      if (!this.canViewChat(chat)) {
        this.removeFromList(this.listInChat, chat.chat_id);
        this.removeFromList(this.listQueue, chat.chat_id);
        this.removeFromList(this.listChatbot, chat.chat_id);
        this.removeFromList(this.listScheduled, chat.chat_id);
        this.removeFromList(this.listClosed, chat.chat_id);

        if (previousWasInInChat && this.inChatPagings.total > 0) {
          this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
        }

        if (previousWasInQueue && this.queuePagings.total > 0) {
          this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
        }

        if (previousWasInChatbot && this.chatbotPagings.total > 0) {
          this.chatbotPagings.total = Math.max(
            0,
            this.chatbotPagings.total - 1
          );
        }

        if (previousWasInScheduled && this.scheduledPagings.total > 0) {
          this.scheduledPagings.total = Math.max(
            0,
            this.scheduledPagings.total - 1
          );
        }

        if (previousWasInClosed && this.closedPagings.total > 0) {
          this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
        }

        if (this.activeChat?.chat_id === chat.chat_id) {
          this.activeChat = null;
        }
        return;
      }

      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listScheduled, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);
      const wasAdded = this.replaceOrPushInList(
        this.listInChat,
        input,
        isActiveChat,
        EChatStatus.in_chat
      );

      if (wasAdded && !previousWasInInChat) {
        this.inChatPagings.total = (this.inChatPagings.total || 0) + 1;
      }

      if (previousWasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (previousWasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (previousWasInScheduled && this.scheduledPagings.total > 0) {
        this.scheduledPagings.total = Math.max(
          0,
          this.scheduledPagings.total - 1
        );
      }

      if (previousWasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = this.createUpdatedActiveChat(input, isActiveChat);
      }
    },

    handleUraStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean,
      previousStatus: string | null
    ): void {
      const existingInInChat = this.listInChat.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInQueue = this.listQueue.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInChatbot = this.listChatbot.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInScheduled = this.listScheduled.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInClosed = this.listClosed.find(
        (c) => c.chat_id === chat.chat_id
      );

      const wasInInChat = !!existingInInChat;
      const wasInQueue = !!existingInQueue;
      const wasInChatbot = !!existingInChatbot;
      const wasInScheduled = !!existingInScheduled;
      const wasInClosed = !!existingInClosed;
      const previousWasInInChat =
        wasInInChat || previousStatus === EChatStatus.in_chat;
      const previousWasInQueue =
        wasInQueue || previousStatus === EChatStatus.queue;
      const previousWasInChatbot =
        wasInChatbot || this.isChatbotStatus(previousStatus);
      const previousWasInScheduled =
        wasInScheduled || this.isScheduledStatus(previousStatus);
      const previousWasInClosed =
        wasInClosed || previousStatus === EChatStatus.closed;

      if (!this.canViewChat(chat)) {
        this.removeFromList(this.listChatbot, chat.chat_id);
        this.removeFromList(this.listInChat, chat.chat_id);
        this.removeFromList(this.listQueue, chat.chat_id);
        this.removeFromList(this.listScheduled, chat.chat_id);
        this.removeFromList(this.listClosed, chat.chat_id);

        if (previousWasInInChat && this.inChatPagings.total > 0) {
          this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
        }

        if (previousWasInQueue && this.queuePagings.total > 0) {
          this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
        }

        if (previousWasInChatbot && this.chatbotPagings.total > 0) {
          this.chatbotPagings.total = Math.max(
            0,
            this.chatbotPagings.total - 1
          );
        }

        if (previousWasInScheduled && this.scheduledPagings.total > 0) {
          this.scheduledPagings.total = Math.max(
            0,
            this.scheduledPagings.total - 1
          );
        }

        if (previousWasInClosed && this.closedPagings.total > 0) {
          this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
        }

        if (this.activeChat?.chat_id === chat.chat_id) {
          this.activeChat = null;
        }
        return;
      }

      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listScheduled, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);
      const wasAdded = this.replaceOrPushInList(
        this.listChatbot,
        input,
        isActiveChat,
        EChatStatus.ura
      );

      if (wasAdded && !previousWasInChatbot) {
        this.chatbotPagings.total = (this.chatbotPagings.total || 0) + 1;
      }

      if (previousWasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (previousWasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (previousWasInScheduled && this.scheduledPagings.total > 0) {
        this.scheduledPagings.total = Math.max(
          0,
          this.scheduledPagings.total - 1
        );
      }

      if (previousWasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = this.createUpdatedActiveChat(input, isActiveChat);
      }
    },

    handleScheduledStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean,
      previousStatus: string | null
    ): void {
      const existingInInChat = this.listInChat.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInQueue = this.listQueue.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInChatbot = this.listChatbot.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInScheduled = this.listScheduled.find(
        (c) => c.chat_id === chat.chat_id
      );
      const existingInClosed = this.listClosed.find(
        (c) => c.chat_id === chat.chat_id
      );

      const wasInInChat = !!existingInInChat;
      const wasInQueue = !!existingInQueue;
      const wasInChatbot = !!existingInChatbot;
      const wasInScheduled = !!existingInScheduled;
      const wasInClosed = !!existingInClosed;
      const previousWasInInChat =
        wasInInChat || previousStatus === EChatStatus.in_chat;
      const previousWasInQueue =
        wasInQueue || previousStatus === EChatStatus.queue;
      const previousWasInChatbot =
        wasInChatbot || this.isChatbotStatus(previousStatus);
      const previousWasInScheduled =
        wasInScheduled || this.isScheduledStatus(previousStatus);
      const previousWasInClosed =
        wasInClosed || previousStatus === EChatStatus.closed;

      if (!this.canViewChat(chat)) {
        this.removeFromList(this.listChatbot, chat.chat_id);
        this.removeFromList(this.listInChat, chat.chat_id);
        this.removeFromList(this.listQueue, chat.chat_id);
        this.removeFromList(this.listScheduled, chat.chat_id);
        this.removeFromList(this.listClosed, chat.chat_id);

        if (previousWasInInChat && this.inChatPagings.total > 0) {
          this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
        }

        if (previousWasInQueue && this.queuePagings.total > 0) {
          this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
        }

        if (previousWasInChatbot && this.chatbotPagings.total > 0) {
          this.chatbotPagings.total = Math.max(
            0,
            this.chatbotPagings.total - 1
          );
        }

        if (previousWasInScheduled && this.scheduledPagings.total > 0) {
          this.scheduledPagings.total = Math.max(
            0,
            this.scheduledPagings.total - 1
          );
        }

        if (previousWasInClosed && this.closedPagings.total > 0) {
          this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
        }

        if (this.activeChat?.chat_id === chat.chat_id) {
          this.activeChat = null;
        }
        return;
      }

      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listClosed, chat.chat_id);
      const wasAdded = this.replaceOrPushInList(
        this.listScheduled,
        input,
        isActiveChat,
        EChatStatus.ura_schedule
      );

      if (wasAdded && !previousWasInScheduled) {
        this.scheduledPagings.total = (this.scheduledPagings.total || 0) + 1;
      }

      if (previousWasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (previousWasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (previousWasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (previousWasInClosed && this.closedPagings.total > 0) {
        this.closedPagings.total = Math.max(0, this.closedPagings.total - 1);
      }

      if (this.activeChat?.chat_id === chat.chat_id) {
        this.activeChat = this.createUpdatedActiveChat(input, isActiveChat);
      }
    },

    handleClosedStatusChat(
      input: ListChatsResult,
      chat: IChat,
      isActiveChat: boolean,
      previousStatus: string | null
    ): void {
      const wasInInChat = this.listInChat.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInQueue = this.listQueue.some((c) => c.chat_id === chat.chat_id);
      const wasInChatbot = this.listChatbot.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInScheduled = this.listScheduled.some(
        (c) => c.chat_id === chat.chat_id
      );
      const wasInClosed = this.listClosed.some(
        (c) => c.chat_id === chat.chat_id
      );
      const previousWasInInChat =
        wasInInChat || previousStatus === EChatStatus.in_chat;
      const previousWasInQueue =
        wasInQueue || previousStatus === EChatStatus.queue;
      const previousWasInChatbot =
        wasInChatbot || this.isChatbotStatus(previousStatus);
      const previousWasInScheduled =
        wasInScheduled || this.isScheduledStatus(previousStatus);
      const previousWasInClosed =
        wasInClosed || previousStatus === EChatStatus.closed;

      this.removeFromList(this.listInChat, chat.chat_id);
      this.removeFromList(this.listQueue, chat.chat_id);
      this.removeFromList(this.listChatbot, chat.chat_id);
      this.removeFromList(this.listScheduled, chat.chat_id);
      const wasAdded = this.replaceOrPushInList(
        this.listClosed,
        input,
        isActiveChat,
        EChatStatus.closed
      );

      if (wasAdded && !previousWasInClosed) {
        this.closedPagings.total = (this.closedPagings.total || 0) + 1;
      }

      if (previousWasInInChat && this.inChatPagings.total > 0) {
        this.inChatPagings.total = Math.max(0, this.inChatPagings.total - 1);
      }

      if (previousWasInQueue && this.queuePagings.total > 0) {
        this.queuePagings.total = Math.max(0, this.queuePagings.total - 1);
      }

      if (previousWasInChatbot && this.chatbotPagings.total > 0) {
        this.chatbotPagings.total = Math.max(0, this.chatbotPagings.total - 1);
      }

      if (previousWasInScheduled && this.scheduledPagings.total > 0) {
        this.scheduledPagings.total = Math.max(
          0,
          this.scheduledPagings.total - 1
        );
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
        notifications_sound: existingChatUser?.notifications_sound ?? true,
        notifications_toast: existingChatUser?.notifications_toast ?? true,
        notifications_browser: existingChatUser?.notifications_browser ?? true,
        notifications_push: existingChatUser?.notifications_push ?? true,
        notifications_status_update:
          existingChatUser?.notifications_status_update ?? true,
        notifications_status_queue:
          existingChatUser?.notifications_status_queue ?? false,
        notifications_status_in_chat:
          existingChatUser?.notifications_status_in_chat ?? true,
        notifications_status_chatbot:
          existingChatUser?.notifications_status_chatbot ?? false,
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
        notifications_sound: this.user?.chat_user?.notifications_sound ?? true,
        notifications_toast: this.user?.chat_user?.notifications_toast ?? true,
        notifications_browser:
          this.user?.chat_user?.notifications_browser ?? true,
        notifications_push: this.user?.chat_user?.notifications_push ?? true,
        notifications_status_update:
          this.user?.chat_user?.notifications_status_update ?? true,
        notifications_status_queue:
          this.user?.chat_user?.notifications_status_queue ?? false,
        notifications_status_in_chat:
          this.user?.chat_user?.notifications_status_in_chat ?? true,
        notifications_status_chatbot:
          this.user?.chat_user?.notifications_status_chatbot ?? false,
      };

      await this.updateChatsUser({
        about: chatUserUpdate.about,
        status: chatUserUpdate.status,
        notifications: chatUserUpdate.notifications,
        notifications_sound: chatUserUpdate.notifications_sound,
        notifications_toast: chatUserUpdate.notifications_toast,
        notifications_browser: chatUserUpdate.notifications_browser,
        notifications_push: chatUserUpdate.notifications_push,
        notifications_status_update: chatUserUpdate.notifications_status_update,
        notifications_status_queue: chatUserUpdate.notifications_status_queue,
        notifications_status_in_chat:
          chatUserUpdate.notifications_status_in_chat,
        notifications_status_chatbot:
          chatUserUpdate.notifications_status_chatbot,
      });
    },

    async listQueueChats(
      input: ListChatsQuery,
      append = false
    ): Promise<ListChatsResponse | null> {
      try {
        this.loading = true;
        if (!append) {
          this.loadingChats = true;
        }

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
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
          const existingIds = new Set(this.listQueue.map((c) => c.chat_id));
          const newResults = data.data.results.filter(
            (c) => !existingIds.has(c.chat_id)
          );
          this.listQueue = [...this.listQueue, ...newResults];
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
        if (!append) {
          this.loadingChats = true;
        }

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
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
          const existingIds = new Set(this.listInChat.map((c) => c.chat_id));
          const newResults = data.data.results.filter(
            (c) => !existingIds.has(c.chat_id)
          );
          this.listInChat = [...this.listInChat, ...newResults];
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
      this.loading = true;

      try {
        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
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

        const data = response?.data;

        if (!data?.status || !data?.data) {
          if (!append) {
            this.listChatbot = [];
          }

          return null;
        }

        this.chatbotPagings = data.data.pagings;

        if (append) {
          const existingIds = new Set(this.listChatbot.map((c) => c.chat_id));
          const newResults = data.data.results.filter(
            (c) => !existingIds.has(c.chat_id)
          );
          this.listChatbot = [...this.listChatbot, ...newResults];
          return data.data;
        }

        this.listChatbot = data.data.results;

        return data.data;
      } catch {
        if (!append) {
          this.listChatbot = [];
        }

        return null;
      } finally {
        this.loading = false;
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
          const existingIds = new Set(this.listClosed.map((c) => c.chat_id));
          const newResults = data.data.results.filter(
            (c) => !existingIds.has(c.chat_id)
          );
          this.listClosed = [...this.listClosed, ...newResults];
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

    async listScheduledChats(
      input: ListChatsQuery,
      append = false
    ): Promise<ListChatsResponse | null> {
      try {
        this.loading = true;

        const request: ListChatsQuery = {
          current_page: input.current_page,
          per_page: input.per_page,
          status: input.status,
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
            this.listScheduled = [];
          }
          return null;
        }

        if (append) {
          const existingIds = new Set(this.listScheduled.map((c) => c.chat_id));
          const newResults = data.data.results.filter(
            (c) => !existingIds.has(c.chat_id)
          );
          this.listScheduled = [...this.listScheduled, ...newResults];
          this.scheduledPagings = data.data.pagings;
          return data.data;
        }

        this.listScheduled = data.data.results;
        this.scheduledPagings = data.data.pagings;

        return data.data;
      } catch {
        if (!append) {
          this.listScheduled = [];
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
        if (input.status !== null && input.status !== undefined) {
          params.status = input.status;
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

    async searchForwardTargetChats(input: {
      filter_worker_id: string;
      status: EChatStatus.in_chat | EChatStatus.queue;
      search?: string;
      current_page?: number;
      per_page?: number;
    }): Promise<SearchChatsResponse | null> {
      try {
        const params: Record<string, any> = {
          current_page: input.current_page ?? 1,
          per_page: input.per_page ?? 20,
          search: input.search ?? '',
          status: input.status,
          filter_worker_id: input.filter_worker_id,
        };

        const response = await axios.get<IApiResponse<SearchChatsResponse>>(
          '/chat/search',
          { params }
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

    async searchForwardTargetContacts(input: {
      filter_channel_id: string;
      search?: string;
      current_page?: number;
      per_page?: number;
    }): Promise<ListChatContactsFinalResponse | null> {
      try {
        const params: Record<string, any> = {
          current_page: input.current_page ?? 1,
          per_page: input.per_page ?? 20,
          search: input.search ?? '',
          filter_channel_id: input.filter_channel_id,
          filter_is_valided: true,
        };

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

    async resolveChatEndpoint(
      status: EChatStatus | EChatStatus[] | typeof MY_CHATS_STATUS,
      filters: ChatFilters,
      hasAppliedAdvancedFilters: boolean,
      pagination: { current_page: number; per_page: number },
      append = false,
      search?: string | null
    ): Promise<ResolveChatEndpointResult> {
      const statusArray = Array.isArray(status) ? status : [status];
      const normalizedSearch = typeof search === 'string' ? search.trim() : '';
      const shouldUseSearchEndpoint =
        hasAppliedAdvancedFilters || normalizedSearch.length > 0;

      const baseFilters = pickDefinedFilters(filters, [...FILTER_KEYS]);

      if (shouldUseSearchEndpoint) {
        const searchFilters: Partial<ChatFilters> = { ...baseFilters };

        if (hasAppliedAdvancedFilters) {
          if (filters.sort_field !== null && filters.sort_field !== undefined) {
            searchFilters.sort_field = filters.sort_field;
          }

          if (filters.sort_order !== null && filters.sort_order !== undefined) {
            searchFilters.sort_order = filters.sort_order;
          }
        }

        return this.handleSearchEndpoint(
          statusArray as EChatStatus[],
          normalizedSearch,
          searchFilters,
          pagination,
          append,
          hasAppliedAdvancedFilters
        );
      }

      const isMyChats =
        status === MY_CHATS_STATUS ||
        (statusArray.length === 1 && statusArray[0] === MY_CHATS_STATUS);

      if (isMyChats) {
        return this.handleMyChatsListEndpoint(baseFilters, pagination, append);
      }

      if (statusArray.length > 1) {
        return this.handleMultiStatusListEndpoint(
          statusArray as EChatStatus[],
          baseFilters,
          pagination,
          append
        );
      }

      return this.handleSingleStatusListEndpoint(
        statusArray[0] as EChatStatus,
        baseFilters,
        pagination,
        append
      );
    },

    async handleMyChatsListEndpoint(
      filters: Partial<ChatFilters>,
      pagination: { current_page: number; per_page: number },
      append: boolean
    ): Promise<ResolveChatEndpointResult> {
      try {
        this.loading = true;

        const params = {
          current_page: pagination.current_page,
          per_page: pagination.per_page,
          status: MY_CHATS_STATUS,
          ...pickDefinedFilters(filters, [...LIST_FILTER_KEYS]),
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          { params }
        );

        this.loading = false;

        const data = response?.data;
        if (!data?.status || !data?.data) {
          return { results: [], counts: null };
        }

        this.updateListsByStatus(
          [EChatStatus.queue, EChatStatus.in_chat],
          data.data.results,
          append
        );

        this.queuePagings = { ...data.data.pagings };
        this.inChatPagings = { ...data.data.pagings };

        return {
          results: data.data.results,
          counts: data.data.counts,
        };
      } catch {
        this.loading = false;
        return { results: [], counts: null };
      }
    },

    async handleSearchEndpoint(
      statusArray: EChatStatus[],
      search: string,
      filters: Partial<ChatFilters>,
      pagination: { current_page: number; per_page: number },
      append: boolean,
      hasAppliedAdvancedFilters: boolean
    ): Promise<ResolveChatEndpointResult> {
      const request: SearchChatsQuery = {
        current_page: pagination.current_page,
        per_page: pagination.per_page,
        search,
        ...pickDefinedFilters(filters, [...FILTER_KEYS]),
      };

      if (hasAppliedAdvancedFilters) {
        if (statusArray.length === 1) {
          request.status = statusArray[0];
        } else {
          request.status = statusArray;
        }
      }

      if (filters.sort_field !== null && filters.sort_field !== undefined) {
        request.sort_field = filters.sort_field;
      }

      if (filters.sort_order !== null && filters.sort_order !== undefined) {
        request.sort_order = filters.sort_order;
      }

      const result = await this.searchChats(request);
      if (!result) {
        return { results: [], counts: null };
      }

      this.updateListsByStatus(statusArray, result.results, append);
      this.updatePagingsByStatus(statusArray, result.pagings);

      return { results: result.results, counts: result.counts };
    },

    updatePagingsByStatus(
      statusArray: EChatStatus[],
      pagings: {
        current_page: number;
        total_pages: number;
        per_page: number;
        count: number;
        total: number;
      }
    ): void {
      if (statusArray.includes(EChatStatus.queue)) {
        this.queuePagings = { ...pagings };
      }
      if (statusArray.includes(EChatStatus.in_chat)) {
        this.inChatPagings = { ...pagings };
      }
      if (statusArray.some((s) => this.isChatbotStatus(s))) {
        this.chatbotPagings = { ...pagings };
      }
      if (statusArray.some((s) => this.isScheduledStatus(s))) {
        this.scheduledPagings = { ...pagings };
      }
      if (statusArray.includes(EChatStatus.closed)) {
        this.closedPagings = { ...pagings };
      }
    },

    async handleMultiStatusListEndpoint(
      statusArray: EChatStatus[],
      filters: Partial<ChatFilters>,
      pagination: { current_page: number; per_page: number },
      append: boolean
    ): Promise<ResolveChatEndpointResult> {
      try {
        this.loading = true;

        const params = {
          current_page: pagination.current_page,
          per_page: pagination.per_page,
          status: statusArray,
          ...pickDefinedFilters(filters, [...LIST_FILTER_KEYS]),
        };

        const response = await axios.get<IApiResponse<ListChatsResponse>>(
          `/chat`,
          { params }
        );

        this.loading = false;

        const data = response?.data;
        if (!data?.status || !data?.data) {
          return { results: [], counts: null };
        }

        this.updateListsByStatus(statusArray, data.data.results, append);

        const counts = data.data.counts;
        const isMultiStatus = statusArray.length > 1;

        if (statusArray.includes(EChatStatus.queue)) {
          this.queuePagings = {
            ...data.data.pagings,
            total:
              isMultiStatus && counts ? counts.queue : data.data.pagings.total,
          };
        }
        if (statusArray.includes(EChatStatus.in_chat)) {
          this.inChatPagings = {
            ...data.data.pagings,
            total:
              isMultiStatus && counts
                ? counts.in_chat
                : data.data.pagings.total,
          };
        }
        if (statusArray.some((s) => this.isChatbotStatus(s))) {
          this.chatbotPagings = {
            ...data.data.pagings,
            total:
              isMultiStatus && counts
                ? counts.chatbot
                : data.data.pagings.total,
          };
        }
        if (statusArray.some((s) => this.isScheduledStatus(s))) {
          const scheduleCount = (counts as { schedule?: number })?.schedule;
          this.scheduledPagings = {
            ...data.data.pagings,
            total:
              isMultiStatus && scheduleCount !== undefined
                ? scheduleCount
                : data.data.pagings.total,
          };
        }
        if (statusArray.includes(EChatStatus.closed)) {
          const closedCount = (counts as { closed?: number })?.closed;
          this.closedPagings = {
            ...data.data.pagings,
            total:
              isMultiStatus && closedCount !== undefined
                ? closedCount
                : data.data.pagings.total,
          };
        }

        return { results: data.data.results, counts };
      } catch {
        this.loading = false;
        return { results: [], counts: null };
      }
    },

    async handleSingleStatusListEndpoint(
      status: EChatStatus,
      filters: Partial<ChatFilters>,
      pagination: { current_page: number; per_page: number },
      append: boolean
    ): Promise<ResolveChatEndpointResult> {
      const request: ListChatsQuery = {
        current_page: pagination.current_page,
        per_page: pagination.per_page,
        status: this.isChatbotStatus(status)
          ? [EChatStatus.ura, EChatStatus.ura_output, EChatStatus.ura_webhook]
          : status,
        ...pickDefinedFilters(filters, [...LIST_FILTER_KEYS]),
      };

      const chatbotHandler = {
        fetch: (req: ListChatsQuery, append: boolean) =>
          this.listChatbotChats(req, append),
        getList: () => this.listChatbot,
      };
      const scheduledHandler = {
        fetch: (req: ListChatsQuery, append: boolean) =>
          this.listScheduledChats(req, append),
        getList: () => this.listScheduled,
      };
      const handlers: Partial<
        Record<
          EChatStatus,
          {
            fetch: (
              req: ListChatsQuery,
              append: boolean
            ) => Promise<ListChatsResponse | null>;
            getList: () => ListChatsResult[];
          }
        >
      > = {
        [EChatStatus.queue]: {
          fetch: (req, app) => this.listQueueChats(req, app),
          getList: () => this.listQueue,
        },
        [EChatStatus.in_chat]: {
          fetch: (req, app) => this.listInChatChats(req, app),
          getList: () => this.listInChat,
        },
        [EChatStatus.ura]: chatbotHandler,
        [EChatStatus.ura_output]: chatbotHandler,
        [EChatStatus.ura_schedule]: scheduledHandler,
        [EChatStatus.ura_webhook]: chatbotHandler,
        [EChatStatus.closed]: {
          fetch: (req, app) => this.listClosedChats(req, app),
          getList: () => this.listClosed,
        },
      };

      const handler = handlers[status];
      if (!handler) {
        return { results: [], counts: null };
      }

      const response = await handler.fetch(request, append);
      return { results: handler.getList(), counts: response?.counts ?? null };
    },

    updateListsByStatus(
      statusArray: EChatStatus[],
      results: ListChatsResult[],
      append: boolean
    ): void {
      const updateList = (
        targetStatus: EChatStatus,
        getCurrentList: () => ListChatsResult[],
        setList: (items: ListChatsResult[]) => void
      ) => {
        const shouldRun =
          statusArray.includes(targetStatus) ||
          (this.isChatbotStatus(targetStatus) &&
            statusArray.some((s) => this.isChatbotStatus(s)));
        if (!shouldRun) return;

        const statusesToInclude = this.isChatbotStatus(targetStatus)
          ? [EChatStatus.ura, EChatStatus.ura_output, EChatStatus.ura_webhook]
          : [targetStatus];
        const filtered = results.filter((c) =>
          statusesToInclude.includes(c.status as EChatStatus)
        );
        if (append) {
          const currentList = getCurrentList();
          const existingIds = new Set(currentList.map((c) => c.chat_id));
          const newItems = filtered.filter((c) => !existingIds.has(c.chat_id));
          currentList.push(...newItems);
        } else {
          setList(filtered);
        }
      };

      updateList(
        EChatStatus.queue,
        () => this.listQueue,
        (items) => (this.listQueue = items)
      );
      updateList(
        EChatStatus.in_chat,
        () => this.listInChat,
        (items) => (this.listInChat = items)
      );
      updateList(
        EChatStatus.ura,
        () => this.listChatbot,
        (items) => (this.listChatbot = items)
      );
      updateList(
        EChatStatus.ura_schedule,
        () => this.listScheduled,
        (items) => (this.listScheduled = items)
      );
      updateList(
        EChatStatus.closed,
        () => this.listClosed,
        (items) => (this.listClosed = items)
      );
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
            notifications:
              input.notifications ?? this.user.chat_user.notifications,
            notifications_sound:
              input.notifications_sound ??
              this.user.chat_user.notifications_sound ??
              true,
            notifications_toast:
              input.notifications_toast ??
              this.user.chat_user.notifications_toast ??
              true,
            notifications_browser:
              input.notifications_browser ??
              this.user.chat_user.notifications_browser ??
              true,
            notifications_push:
              input.notifications_push ??
              this.user.chat_user.notifications_push ??
              true,
            notifications_status_update:
              input.notifications_status_update ??
              this.user.chat_user.notifications_status_update ??
              true,
            notifications_status_queue:
              input.notifications_status_queue ??
              this.user.chat_user.notifications_status_queue ??
              false,
            notifications_status_in_chat:
              input.notifications_status_in_chat ??
              this.user.chat_user.notifications_status_in_chat ??
              true,
            notifications_status_chatbot:
              input.notifications_status_chatbot ??
              this.user.chat_user.notifications_status_chatbot ??
              false,
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

    async getChatById(
      query: ListMessageChatsQuery,
      chatId?: string
    ): Promise<void> {
      try {
        const targetChatId = chatId ?? this.activeChat?.chat_id;
        if (!targetChatId) {
          this.listMessages = [];
          return;
        }

        const existingSummaries = new Map<
          string,
          ListMessageResult['summary'] | null
        >(
          this.listMessages.map((message) => [
            message.message_id,
            normalizeMessageDeliverySummary(message.summary),
          ])
        );

        this.loading = true;
        this.listMessages = [];
        this.currentPage = 1;

        const response = await axios.get<IApiResponse<ListMessageResponse>>(
          `/chat/${targetChatId}`,
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

        this.listMessages = [...data.data.results].reverse().map((message) => ({
          ...message,
          summary: mergeMessageDeliverySummary(
            message.summary,
            existingSummaries.get(message.message_id) ?? null
          ),
        }));
        this.currentPage = data.data.pagings.current_page;
        this.totalPages = data.data.pagings.total_pages;
      } catch (error) {
        this.loading = false;
        this.listMessages = [];

        if (error instanceof AxiosError) {
          if (error.response?.status === 404) {
            return;
          }
          const errorMessage = error.response?.data?.message ?? error.message;
          this.showSnackbar(errorMessage, EColor.error);
          return;
        }

        if (error instanceof Error) {
          this.showSnackbar(error.message, EColor.error);
        }

        return;
      }
    },

    async getChatMessagesById(
      chatId: string,
      query: ListMessageChatsQuery
    ): Promise<ListMessageResponse | null> {
      try {
        const response = await axios.get<IApiResponse<ListMessageResponse>>(
          `/chat/${chatId}`,
          {
            params: query,
          }
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        if (error instanceof AxiosError) {
          if (error.response?.status === 404) {
            return null;
          }
          const errorMessage = error.response?.data?.message ?? error.message;
          this.showSnackbar(errorMessage, EColor.error);
          return null;
        }

        if (error instanceof Error) {
          this.showSnackbar(error.message, EColor.error);
        }

        return null;
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

    async updateChatStatus(
      chatId: string,
      status: string,
      options?: {
        send_message_on_finish_attendance?: boolean;
        closure_comment?: string;
      }
    ): Promise<boolean> {
      try {
        this.loading = true;
        this.pendingStatusUpdateChatId = chatId;
        const shouldSkipStatusEvents = status === EChatStatus.in_chat;
        const isClosing = status === EChatStatus.closed;

        if (shouldSkipStatusEvents) {
          this.markSkipChatStatusEvents(chatId);
        }

        const response = await axios.patch<IApiResponse<IChat>>(
          `/chat/${chatId}/status`,
          {
            status,
            send_message_on_finish_attendance:
              options?.send_message_on_finish_attendance,
            closure_comment: options?.closure_comment,
          }
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

          if (isActiveChat && isClosing) {
            this.activeChat = null;
          }

          if (isActiveChat && !isClosing) {
            const input: ListChatsResult = {
              chat_id: data.data.chat_id,
              summary: data.data.summary,
              account: data.data.account,
              worker: data.data.worker,
              sector: data.data.sector,
              user: data.data.user,
              secondary_users: this.normalizeSecondaryUsers(
                data.data.secondary_users
              ),
              contact: data.data.contact,
              photo: data.data.photo,
              name: data.data.name,
              phone: data.data.phone,
              status: data.data.status,
              date: data.data.date,
              started_at: data.data.started_at,
              closed_at: data.data.closed_at,
              protocol_ura: data.data.protocol_ura ?? null,
              protocol_start: data.data.protocol_start ?? null,
              protocol_transfer: data.data.protocol_transfer ?? null,
              label: data.data.label ?? null,
              forward_to_output_chatbot: data.data.forward_to_output_chatbot,
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
      hasAppliedAdvancedFilters = false,
      workerId?: string | null,
      keepInChat = false,
      sendMessageOnTransfer?: boolean
    ): Promise<boolean> {
      void hasAppliedAdvancedFilters;
      try {
        this.loading = true;
        this.markSkipChatStatusEvents(chatId);

        const response = await axios.post<
          IApiResponse<{ chat_id: string; status: boolean }>
        >(`/chat/${chatId}/transfer`, {
          worker_id: workerId ?? undefined,
          user_id: userId ?? undefined,
          sector_id: sectorId ?? undefined,
          annotation: annotation?.trim() ?? undefined,
          keep_in_chat: keepInChat,
          send_message_on_transfer: sendMessageOnTransfer,
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

    async bulkActionChats(
      input: BulkActionChatRequest
    ): Promise<BulkActionChatResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<BulkActionChatResponse>>(
          '/chat/bulk-action',
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const errorMessage =
            data?.message || this.i18n.global.t('chat_bulk_action_all_failed');
          this.showSnackbar(errorMessage, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        this.loading = false;

        let errorMessage = this.i18n.global.t('chat_bulk_action_all_failed');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async joinChat(chatId: string): Promise<boolean> {
      if (!chatId) {
        return false;
      }

      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<ListChatsResult>>(
          `/chat/${chatId}/join`,
          {}
        );

        this.loading = false;

        const data = response?.data;
        if (!data?.status || !data.data) {
          const errorMessage =
            data?.message || this.i18n.global.t('join_conversation_error');
          this.showSnackbar(errorMessage, EColor.error);
          return false;
        }

        this.addChat(data.data as unknown as IChat, true);

        if (this.activeChat?.chat_id === chatId) {
          this.activeChat = this.createUpdatedActiveChat(data.data, true);
        }

        return true;
      } catch (error) {
        this.loading = false;

        let errorMessage = this.i18n.global.t('join_conversation_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async leaveChat(chatId: string): Promise<boolean> {
      if (!chatId) {
        return false;
      }

      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<ListChatsResult>>(
          `/chat/${chatId}/leave`,
          {}
        );

        this.loading = false;

        const data = response?.data;
        if (!data?.status || !data.data) {
          const errorMessage =
            data?.message || this.i18n.global.t('leave_conversation_error');
          this.showSnackbar(errorMessage, EColor.error);
          return false;
        }

        this.addChat(data.data as unknown as IChat, true);

        if (this.activeChat?.chat_id === chatId) {
          this.activeChat = this.createUpdatedActiveChat(data.data, true);
        }

        return true;
      } catch (error) {
        this.loading = false;

        let errorMessage = this.i18n.global.t('leave_conversation_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async viewChatAttendants(
      chatId: string
    ): Promise<ViewChatAttendantsResponse | null> {
      if (!chatId) {
        return null;
      }

      try {
        const response = await axios.get<
          IApiResponse<ViewChatAttendantsResponse>
        >(`/chat/${chatId}/attendants`);

        const data = response?.data;
        if (!data?.status || !data.data) {
          const errorMessage =
            data?.message || this.i18n.global.t('attendants_info_error');
          this.showSnackbar(errorMessage, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('attendants_info_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return null;
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

    setActiveChat(chatId: string, fallbackChat?: ListChatsResult): void {
      if (this.activeChat?.chat_id === chatId) return;

      const chat = ((fallbackChat?.chat_id === chatId ? fallbackChat : null) ??
        this.listQueue.find((c) => c.chat_id === chatId) ??
        this.listInChat.find((c) => c.chat_id === chatId) ??
        this.listChatbot.find((c) => c.chat_id === chatId) ??
        this.listScheduled.find((c) => c.chat_id === chatId) ??
        this.listClosed.find((c) => c.chat_id === chatId) ??
        this.kanbanQueue.find((c) => c.chat_id === chatId) ??
        this.kanbanInChat.find((c) => c.chat_id === chatId) ??
        this.kanbanChatbot.find((c) => c.chat_id === chatId) ??
        this.kanbanClosed.find((c) => c.chat_id === chatId)) as
        | ListChatsResult
        | undefined;

      if (!chat?.chat_id) {
        this.activeChat = null;
        return;
      }

      if (!this.canViewChat(chat as IChat)) {
        this.activeChat = null;
        this.removeChatIfNotAuthorized(chat as IChat);
        return;
      }

      this.activeChat = {
        chat_id: chat.chat_id,
        summary: chat.summary,
        account: chat.account,
        worker: chat.worker,
        sector: chat.sector,
        user: chat.user,
        secondary_users: this.normalizeSecondaryUsers(chat.secondary_users),
        contact: chat.contact,
        photo: chat.photo,
        name: chat.name,
        phone: chat.phone,
        status: chat.status,
        date: chat.date,
        started_at: chat.started_at,
        closed_at: chat.closed_at,
        protocol_ura: chat.protocol_ura ?? null,
        protocol_start: chat.protocol_start ?? null,
        protocol_transfer: chat.protocol_transfer ?? null,
        label: chat.label ?? null,
        forward_to_output_chatbot: chat.forward_to_output_chatbot,
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

    async forwardMessage(
      chatId: string,
      messageId: string,
      payload: {
        target_chat_ids?: string[];
        target_contact_ids?: string[];
        worker_id?: string;
      }
    ): Promise<ForwardMessageResponse | null> {
      try {
        const response = await axios.post<IApiResponse<ForwardMessageResponse>>(
          `/chat/${chatId}/message/${messageId}/forward`,
          payload
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message || this.i18n.global.t('chat_forward_error');
          this.showSnackbar(message, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('chat_forward_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);
        return null;
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

      const uniqueIds = Array.from(new Set(contactIds)).filter(Boolean);
      const contactIdsToLoad = uniqueIds.filter(
        (contactId) =>
          !this.chatContacts[contactId] && !this.loadingChatContacts[contactId]
      );

      if (!contactIdsToLoad.length) {
        return [];
      }

      for (const contactId of contactIdsToLoad) {
        this.loadingChatContacts[contactId] = true;
      }

      try {
        const response = await axios.post<
          IApiResponse<ViewChatContactResponse[]>
        >('/chat/contacts/batch', {
          contact_ids: contactIdsToLoad,
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
      } finally {
        for (const contactId of contactIdsToLoad) {
          delete this.loadingChatContacts[contactId];
        }
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

    async listContactChannels(): Promise<ListChatContactChannelsResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListChatContactChannelsResponse>
        >('/chat/contact-channels');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('chat_contact_channels_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'chat_contact_channels_list_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async viewContactChannelsByContactId(
      contactId: string
    ): Promise<string[] | null> {
      try {
        const response = await axios.get<IApiResponse<string[]>>(
          `/chat/contacts/${contactId}/channels`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('chat_contact_channels_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'chat_contact_channels_view_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async listQuickMessageTemplates(
      command?: string | null,
      channelId?: string | null
    ): Promise<ListQuickMessageTemplatesResponse[]> {
      try {
        const request: ListQuickMessageTemplatesRequest = {
          command: command ?? null,
          channel_id: channelId ?? null,
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
        const channelIds = extractArrayFieldValue(
          payload.channel_ids as
            | string[]
            | Array<{ value: string }>
            | { value: string[] }
            | null
            | undefined
        );
        for (let i = 0; i < channelIds.length; i += 1) {
          formData.append(`channel_ids[${i}]`, channelIds[i]);
        }
        const labelTemplateIds = extractArrayFieldValue(
          payload.label_template_ids as
            | string[]
            | Array<{ value: string }>
            | { value: string }
            | { value: string[] }
            | null
            | undefined
        );
        for (let i = 0; i < labelTemplateIds.length; i += 1) {
          formData.append(`label_template_ids[${i}]`, labelTemplateIds[i]);
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
        if (body.channel_ids !== undefined) {
          const channelIds = extractArrayFieldValue(
            body.channel_ids as
              | string[]
              | Array<{ value: string }>
              | { value: string[] }
              | { value: string[] | null }
              | null
              | undefined
          );
          if (channelIds.length === 0) {
            formData.append('channel_ids', '');
          } else {
            for (let i = 0; i < channelIds.length; i += 1) {
              formData.append(`channel_ids[${i}]`, channelIds[i]);
            }
          }
        }
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
            for (let i = 0; i < labelTemplateIds.length; i += 1) {
              formData.append(`label_template_ids[${i}]`, labelTemplateIds[i]);
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

    async listTransferUsers(
      chatId?: string,
      channelId?: string
    ): Promise<TransferUserResponse[]> {
      try {
        const params = {
          chat_id: chatId ?? undefined,
          channel_id: channelId ?? undefined,
        };
        const response = await axios.get<IApiResponse<TransferUserResponse[]>>(
          '/chat/transfer/users',
          { params }
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
      sectorId: string,
      chatId?: string,
      channelId?: string
    ): Promise<TransferSectorUserResponse[]> {
      try {
        const params = {
          chat_id: chatId ?? undefined,
          channel_id: channelId ?? undefined,
        };
        const response = await axios.get<
          IApiResponse<TransferSectorUserResponse[]>
        >(`/chat/transfer/sectors/${sectorId}/users`, { params });

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

        this.addChat(data.data);

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
              secondary_users: this.normalizeSecondaryUsers(
                this.activeChat.secondary_users
              ),
              contact: this.activeChat.contact,
              photo: this.activeChat.photo,
              name: this.activeChat.name,
              phone: this.activeChat.phone,
              status: this.activeChat.status,
              date: this.activeChat.date,
              started_at: this.activeChat.started_at,
              closed_at: this.activeChat.closed_at,
              protocol_ura: this.activeChat.protocol_ura ?? null,
              protocol_start: this.activeChat.protocol_start ?? null,
              protocol_transfer: this.activeChat.protocol_transfer ?? null,
              label: normalizedLabel,
              forward_to_output_chatbot:
                this.activeChat.forward_to_output_chatbot,
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

    async updateForwardToOutputChatbot(
      chatId: string,
      forwardToOutputChatbot: boolean
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<{ success: boolean }>>(
          `/chat/${chatId}/forward-to-output-chatbot`,
          { forward_to_output_chatbot: forwardToOutputChatbot }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const errorMessage =
            data?.message ||
            this.i18n.global.t('chat_forward_to_output_chatbot_update_failed');
          this.showSnackbar(errorMessage, EColor.error);

          return false;
        }

        if (this.activeChat?.chat_id === chatId) {
          this.activeChat = {
            ...this.activeChat,
            forward_to_output_chatbot: forwardToOutputChatbot,
          };
        }

        const updateInList = (list: ListChatsResult[]) => {
          const idx = list.findIndex((c) => c.chat_id === chatId);
          if (idx !== -1) {
            list.splice(idx, 1, {
              ...list[idx],
              forward_to_output_chatbot: forwardToOutputChatbot,
            });
          }
        };

        updateInList(this.listQueue);
        updateInList(this.listInChat);
        updateInList(this.listChatbot);
        updateInList(this.listClosed);

        return true;
      } catch (error) {
        this.loading = false;

        let errorMessage = this.i18n.global.t(
          'chat_forward_to_output_chatbot_update_failed'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async viewAttendanceInactivityByChat(
      chatId: string
    ): Promise<ViewChatAttendanceInactivityResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewChatAttendanceInactivityResponse>
        >(`/chat/${chatId}/attendance-inactivity`);

        const data = response?.data;
        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateAttendanceInactivityByChat(
      chatId: string,
      body: UpdateChatAttendanceInactivityRequest
    ): Promise<boolean> {
      try {
        const response = await axios.patch<IApiResponse<{ success: boolean }>>(
          `/chat/${chatId}/attendance-inactivity`,
          body
        );

        const data = response?.data;
        if (!data?.status) {
          const errorMessage =
            data?.message ||
            this.i18n.global.t('chat_attendance_inactivity_update_failed');
          this.showSnackbar(errorMessage, EColor.error);
          return false;
        }

        const successKey = body.disabled
          ? 'chat_attendance_inactivity_update_success'
          : 'chat_attendance_inactivity_update_enable_success';

        this.showSnackbar(this.i18n.global.t(successKey), EColor.success);

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'chat_attendance_inactivity_update_failed'
        );
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

    async generateAiReply(
      chatId: string,
      messageId: string,
      responseType: 'text' | 'audio',
      instructions?: string | null
    ): Promise<GenerateAiReplyResponse | null> {
      if (!chatId || !messageId) return null;

      try {
        const response = await axios.post<
          IApiResponse<GenerateAiReplyResponse>
        >(`/chat/${chatId}/ai-generate`, {
          message_id: messageId,
          response_type: responseType,
          instructions: instructions || undefined,
        });

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const errorMessage =
            data?.message || this.i18n.global.t('chat_ai_reply_error');
          this.showSnackbar(errorMessage, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('chat_ai_reply_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },

    async transcribeAudio(
      chatId: string,
      messageId: string
    ): Promise<TranscribeAudioResponse | null> {
      if (!chatId || !messageId) return null;

      try {
        const response = await axios.post<
          IApiResponse<TranscribeAudioResponse>
        >(`/chat/${chatId}/message/${messageId}/transcribe`, {});

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const errorMessage =
            data?.message || this.i18n.global.t('chat_transcribe_error');
          this.showSnackbar(errorMessage, EColor.error);
          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('chat_transcribe_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
  },
});
