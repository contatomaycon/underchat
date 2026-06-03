import { defineStore } from 'pinia';
import axios from '@webcore/axios';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { getI18n } from '@/plugins/i18n';
import { getUser, setUser } from '@/@webcore/localStorage/user';
import type { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import type { ListConversationsQuery } from '@core/schema/internalChat/listConversations/request.schema';
import type { ListConversationsResponse } from '@core/schema/internalChat/listConversations/response.schema';
import type { ListUsersQuery } from '@core/schema/internalChat/listUsers/request.schema';
import type { ListUsersResponse } from '@core/schema/internalChat/listUsers/response.schema';
import type { ListInternalChatContactsResponse } from '@core/schema/internalChat/listContacts/response.schema';
import type { ViewInternalChatContactPhoneResponse } from '@core/schema/internalChat/viewContactPhone/response.schema';
import type { ListMessagesQuery } from '@core/schema/internalChat/listMessages/request.schema';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';
import type { SearchInternalChatMessagesResponse } from '@core/schema/internalChat/searchMessages/response.schema';
import type { MessageHistoryResponse } from '@core/schema/internalChat/messageHistory/response.schema';
import type { CreateMessageBody } from '@core/schema/internalChat/createMessage/request.schema';
import type { ListGroupMembersResponse } from '@core/schema/internalChat/listGroupMembers/response.schema';
import type { ViewInternalChatLinkPreviewBody } from '@core/schema/internalChat/viewLinkPreview/request.schema';
import type { ViewInternalChatLinkPreviewResponse } from '@core/schema/internalChat/viewLinkPreview/response.schema';
import type { InternalChatNotificationSettingsRequest } from '@core/schema/internalChat/notificationSettings/request.schema';
import type {
  InternalChatNotificationSettingsData,
  InternalChatNotificationSettingsResponse,
} from '@core/schema/internalChat/notificationSettings/response.schema';
import type { InternalChatUnreadSummaryData } from '@core/schema/internalChat/unreadSummary/response.schema';
import { EInternalChatActivityState } from '@core/common/enums/internalChat/EInternalChatActivityState';
import { EMessageType } from '@core/common/enums/EMessageType';

type Paging = {
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
};

type InternalConversation =
  ListConversationsResponse['data']['results'][number];
type InternalUser = ListUsersResponse['data']['results'][number];
type InternalMessage = ListMessagesResponse['data']['results'][number];
type InternalMessageHistoryItem =
  MessageHistoryResponse['data']['results'][number];
type InternalParticipant = ListGroupMembersResponse['data'][number];
type LocalMessageState = {
  status: 'uploading' | 'error';
  progress: number;
  errorMessage?: string;
};
type InternalReaction = {
  emoji: string;
  user_id?: string | null;
  user_name?: string | null;
};

type RemoteActivity = {
  conversation_id: string;
  user_id: string;
  user_name: string | null;
  user_photo: string | null;
  state: EInternalChatActivityState;
  updated_at: number;
};

const makePaging = (perPage = 20): Paging => ({
  current_page: 1,
  total_pages: 1,
  per_page: perPage,
  count: 0,
  total: 0,
});

const normalizeMessagePreview = (message: InternalMessage): string | null => {
  if (message.content?.type === EMessageType.system) {
    return 'internal_chat_preview_group_event';
  }

  if (message.content?.type === EMessageType.text) {
    return message.content.message ?? null;
  }

  if (message.content?.type === EMessageType.image) {
    return 'internal_chat_preview_image';
  }
  if (message.content?.type === EMessageType.video) {
    return 'internal_chat_preview_video';
  }
  if (message.content?.type === EMessageType.audio) {
    return 'internal_chat_preview_audio';
  }
  if (message.content?.type === EMessageType.document) {
    return 'internal_chat_preview_document';
  }
  if (message.content?.type === EMessageType.location) {
    return 'internal_chat_preview_location';
  }
  if (message.content?.type === EMessageType.contact_card) {
    return 'internal_chat_preview_contact';
  }
  if (message.content?.type === EMessageType.contacts) {
    return 'internal_chat_preview_contacts';
  }

  return message.content?.message ?? null;
};

const parseDate = (value?: string | null): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const useInternalChatStore = defineStore('internalChat', {
  state: () => ({
    i18n: getI18n(),
    user: getUser() as AuthUserResponse | null,
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    loadingConversations: false,
    loadingUsers: false,
    loadingMessages: false,
    loadingUnreadSummary: false,
    unreadSummaryCount: 0,
    loadingGroupMembers: false,
    sendingMessage: false,
    conversationSearch: '',
    conversationType: undefined as ListConversationsQuery['type'] | undefined,
    userSearch: '',
    conversations: [] as InternalConversation[],
    users: [] as InternalUser[],
    messages: [] as InternalMessage[],
    groupMembers: [] as InternalParticipant[],
    activeConversation: null as InternalConversation | null,
    conversationsPaging: makePaging(20),
    usersPaging: makePaging(20),
    messagesPaging: makePaging(10),
    remoteActivities: {} as Record<string, RemoteActivity>,
    localMessageState: {} as Record<string, LocalMessageState>,
    refreshConversationsTimer: null as ReturnType<typeof setTimeout> | null,
    unreadSummaryRefreshTimer: null as ReturnType<typeof setTimeout> | null,
  }),
  getters: {
    currentUserId: (state): string | null => state.user?.user_id ?? null,
    hasOpenConversations: (state): boolean => state.conversations.length > 0,
  },
  actions: {
    showSnackbar(message: string, color: EColor) {
      if (!message?.trim()) return;
      this.snackbar.message = message;
      this.snackbar.color = color;
      this.snackbar.status = true;
    },

    hideSnackbar() {
      this.snackbar.status = false;
    },

    setUnreadSummaryCount(count: number): void {
      const normalizedCount = Number.isFinite(count)
        ? Math.max(0, Math.trunc(count))
        : 0;

      this.unreadSummaryCount = normalizedCount;
    },

    adjustUnreadSummaryCount(delta: number): void {
      if (!Number.isFinite(delta) || delta === 0) {
        return;
      }

      this.setUnreadSummaryCount(this.unreadSummaryCount + delta);
    },

    resetUnreadSummary(): void {
      if (this.unreadSummaryRefreshTimer) {
        clearTimeout(this.unreadSummaryRefreshTimer);
        this.unreadSummaryRefreshTimer = null;
      }

      this.unreadSummaryCount = 0;
      this.loadingUnreadSummary = false;
    },

    scheduleUnreadSummaryRefresh(delayMs = 700): void {
      if (this.unreadSummaryRefreshTimer) {
        return;
      }

      this.unreadSummaryRefreshTimer = setTimeout(() => {
        this.unreadSummaryRefreshTimer = null;
        void this.viewUnreadSummary();
      }, delayMs);
    },

    async viewUnreadSummary(): Promise<number> {
      if (this.loadingUnreadSummary) {
        return this.unreadSummaryCount;
      }

      this.loadingUnreadSummary = true;

      try {
        const response = await axios.get<
          IApiResponse<InternalChatUnreadSummaryData>
        >('/internal-chat/unread-summary');
        this.setUnreadSummaryCount(response.data?.data?.unread_count ?? 0);
      } catch {
        // The menu badge is opportunistic; navigation must not be blocked by it.
      } finally {
        this.loadingUnreadSummary = false;
      }

      return this.unreadSummaryCount;
    },

    patchChatUser(input: Partial<NonNullable<AuthUserResponse['chat_user']>>) {
      if (!this.user) return;

      const existingChatUser = this.user.chat_user ?? undefined;
      const chatUser = {
        chat_user_id:
          input.chat_user_id ?? existingChatUser?.chat_user_id ?? '',
        about: input.about ?? existingChatUser?.about ?? null,
        status:
          input.status ?? existingChatUser?.status ?? EChatUserStatus.offline,
        notifications:
          input.notifications ?? existingChatUser?.notifications ?? true,
        notifications_sound:
          input.notifications_sound ??
          existingChatUser?.notifications_sound ??
          true,
        notifications_toast:
          input.notifications_toast ??
          existingChatUser?.notifications_toast ??
          true,
        notifications_browser:
          input.notifications_browser ??
          existingChatUser?.notifications_browser ??
          true,
        notifications_push:
          input.notifications_push ??
          existingChatUser?.notifications_push ??
          true,
        notifications_status_update:
          input.notifications_status_update ??
          existingChatUser?.notifications_status_update ??
          true,
        notifications_status_queue:
          input.notifications_status_queue ??
          existingChatUser?.notifications_status_queue ??
          false,
        notifications_status_in_chat:
          input.notifications_status_in_chat ??
          existingChatUser?.notifications_status_in_chat ??
          true,
        notifications_status_chatbot:
          input.notifications_status_chatbot ??
          existingChatUser?.notifications_status_chatbot ??
          false,
        notifications_message_queue:
          input.notifications_message_queue ??
          existingChatUser?.notifications_message_queue ??
          false,
        notifications_message_in_chat:
          input.notifications_message_in_chat ??
          existingChatUser?.notifications_message_in_chat ??
          true,
        notifications_message_chatbot:
          input.notifications_message_chatbot ??
          existingChatUser?.notifications_message_chatbot ??
          false,
        notifications_transfer:
          input.notifications_transfer ??
          existingChatUser?.notifications_transfer ??
          true,
        notifications_internal_chat:
          input.notifications_internal_chat ??
          existingChatUser?.notifications_internal_chat ??
          true,
        notifications_internal_chat_direct:
          input.notifications_internal_chat_direct ??
          existingChatUser?.notifications_internal_chat_direct ??
          true,
        notifications_internal_chat_group:
          input.notifications_internal_chat_group ??
          existingChatUser?.notifications_internal_chat_group ??
          true,
        notifications_internal_chat_sound:
          input.notifications_internal_chat_sound ??
          existingChatUser?.notifications_internal_chat_sound ??
          true,
        notifications_internal_chat_toast:
          input.notifications_internal_chat_toast ??
          existingChatUser?.notifications_internal_chat_toast ??
          true,
        notifications_internal_chat_browser:
          input.notifications_internal_chat_browser ??
          existingChatUser?.notifications_internal_chat_browser ??
          true,
        notifications_internal_chat_push:
          input.notifications_internal_chat_push ??
          existingChatUser?.notifications_internal_chat_push ??
          true,
        sort_by_chat_order:
          input.sort_by_chat_order ?? existingChatUser?.sort_by_chat_order,
        sort_in_chat_order:
          input.sort_in_chat_order ?? existingChatUser?.sort_in_chat_order,
        sort_by_my_chats_order:
          input.sort_by_my_chats_order ??
          existingChatUser?.sort_by_my_chats_order,
        sort_my_chats_order:
          input.sort_my_chats_order ?? existingChatUser?.sort_my_chats_order,
        sort_by_queue_order:
          input.sort_by_queue_order ?? existingChatUser?.sort_by_queue_order,
        sort_queue_order:
          input.sort_queue_order ?? existingChatUser?.sort_queue_order,
        sort_by_chatbot_order:
          input.sort_by_chatbot_order ??
          existingChatUser?.sort_by_chatbot_order,
        sort_chatbot_order:
          input.sort_chatbot_order ?? existingChatUser?.sort_chatbot_order,
      } as NonNullable<AuthUserResponse['chat_user']>;

      this.user = {
        ...this.user,
        chat_user: chatUser,
      };

      setUser(this.user);
    },

    resolveErrorMessage(error: unknown, fallback?: string): string {
      const fallbackMessage = fallback ?? this.i18n.global.t('error');

      if (error instanceof AxiosError) {
        return error?.response?.data?.message ?? fallbackMessage;
      }

      if (error instanceof Error && error.message.trim()) {
        return error.message;
      }

      return fallbackMessage;
    },

    sortConversations() {
      this.conversations.sort((a, b) => {
        const lastMessageDiff =
          parseDate(b.last_message_at) - parseDate(a.last_message_at);

        if (lastMessageDiff !== 0) {
          return lastMessageDiff;
        }

        return parseDate(b.updated_at) - parseDate(a.updated_at);
      });
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

    upsertConversation(conversation: InternalConversation) {
      const index = this.conversations.findIndex(
        (item) => item.conversation_id === conversation.conversation_id
      );

      if (conversation.is_closed_for_me) {
        if (index >= 0) {
          this.conversations.splice(index, 1);
        }
        return;
      }

      if (index >= 0) {
        this.conversations[index] = conversation;
      } else {
        this.conversations.unshift(conversation);
      }

      this.sortConversations();
    },

    upsertMessage(message: InternalMessage) {
      let index = -1;
      if (message.hash) {
        index = this.messages.findIndex((item) => item.hash === message.hash);
      }

      if (index === -1) {
        index = this.messages.findIndex(
          (item) => item.message_id === message.message_id
        );
      }

      if (index >= 0) {
        this.messages[index] = message;
      } else {
        this.messages.push(message);
      }

      if (message.hash) {
        this.clearLocalMessageState(message.hash);
      }

      this.messages.sort((a, b) => parseDate(a.date) - parseDate(b.date));
    },

    setActiveConversation(conversation: InternalConversation) {
      this.upsertConversation(conversation);

      if (
        this.activeConversation?.conversation_id ===
        conversation.conversation_id
      ) {
        this.activeConversation = conversation;
      }
    },

    updateMessageReaction(messageId: string, emoji: string | null) {
      const message = this.messages.find(
        (item) => item.message_id === messageId
      );
      if (!message?.content) return;

      const content = message.content as {
        reactions?: InternalReaction[] | null;
      };
      const currentReactions = Array.isArray(content.reactions)
        ? [...content.reactions]
        : [];
      const withoutMine = currentReactions.filter(
        (reaction) => reaction.user_id !== this.currentUserId
      );
      const normalizedEmoji = emoji?.trim() ?? '';

      if (normalizedEmoji) {
        withoutMine.push({
          emoji: normalizedEmoji,
          user_id: this.currentUserId,
          user_name: this.user?.info.name ?? null,
        });
      }

      content.reactions = withoutMine.length > 0 ? withoutMine : null;
    },

    revertMessageReactions(
      messageId: string,
      reactions?: InternalReaction[] | null
    ) {
      const message = this.messages.find(
        (item) => item.message_id === messageId
      );
      if (!message?.content) return;
      const content = message.content as {
        reactions?: InternalReaction[] | null;
      };
      content.reactions = reactions ?? null;
    },

    clearExpiredActivities(maxAgeMs = 6000) {
      const now = Date.now();
      for (const [key, activity] of Object.entries(this.remoteActivities)) {
        if (now - activity.updated_at > maxAgeMs) {
          delete this.remoteActivities[key];
        }
      }
    },

    setRemoteActivity(input: {
      conversation_id: string;
      user_id: string;
      user_name?: string | null;
      user_photo?: string | null;
      state: EInternalChatActivityState;
    }) {
      if (!input.conversation_id || !input.user_id) return;
      if (input.user_id === this.currentUserId) return;

      const key = `${input.conversation_id}:${input.user_id}`;
      if (input.state === EInternalChatActivityState.available) {
        delete this.remoteActivities[key];
        return;
      }

      this.remoteActivities[key] = {
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        user_name: input.user_name ?? null,
        user_photo: input.user_photo ?? null,
        state: input.state,
        updated_at: Date.now(),
      };
    },

    listConversationActivities(conversationId: string): RemoteActivity[] {
      return Object.values(this.remoteActivities).filter(
        (item) => item.conversation_id === conversationId
      );
    },

    async listConversations(
      query: Partial<ListConversationsQuery> = {},
      append = false
    ): Promise<InternalConversation[]> {
      this.loadingConversations = true;

      try {
        const params: Partial<ListConversationsQuery> = {
          current_page: query.current_page ?? 1,
          per_page: query.per_page ?? this.conversationsPaging.per_page,
          search: query.search?.trim() || undefined,
          type: query.type,
        };

        this.conversationSearch = params.search ?? '';
        this.conversationType = params.type;

        const response = await axios.get<
          IApiResponse<ListConversationsResponse['data']>
        >('/internal-chat/conversations', {
          params,
        });

        const data = response?.data;
        if (!data?.status || !data.data) {
          if (!append) {
            this.conversations = [];
          }
          return [];
        }

        const incoming = data.data.results ?? [];
        if (append) {
          const merged = [...this.conversations];
          for (const conversation of incoming) {
            const index = merged.findIndex(
              (item) => item.conversation_id === conversation.conversation_id
            );
            if (index >= 0) {
              merged[index] = conversation;
            } else {
              merged.push(conversation);
            }
          }
          this.conversations = merged;
        } else {
          this.conversations = [...incoming];
        }

        this.conversationsPaging = {
          current_page: data.data.pagings.current_page,
          total_pages: data.data.pagings.total_pages,
          per_page: data.data.pagings.per_page,
          count: data.data.pagings.count,
          total: data.data.pagings.total,
        };

        this.sortConversations();
        return this.conversations;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_list_conversations_error')
          ),
          EColor.error
        );
        return [];
      } finally {
        this.loadingConversations = false;
      }
    },

    async refreshConversations(): Promise<void> {
      await this.listConversations(
        {
          current_page: 1,
          per_page: this.conversationsPaging.per_page,
          search: this.conversationSearch || undefined,
          type: this.conversationType,
        },
        false
      );
    },

    scheduleRefreshConversations(delayMs = 250): void {
      if (this.refreshConversationsTimer) {
        return;
      }

      this.refreshConversationsTimer = setTimeout(() => {
        this.refreshConversationsTimer = null;
        void this.refreshConversations();
      }, delayMs);
    },

    async listUsers(
      query: Partial<ListUsersQuery> = {},
      append = false
    ): Promise<InternalUser[]> {
      this.loadingUsers = true;

      try {
        const params: Partial<ListUsersQuery> = {
          current_page: query.current_page ?? 1,
          per_page: query.per_page ?? this.usersPaging.per_page,
          search: query.search?.trim() || undefined,
        };

        this.userSearch = params.search ?? '';

        const response = await axios.get<
          IApiResponse<ListUsersResponse['data']>
        >('/internal-chat/users', {
          params,
        });

        const data = response?.data;
        if (!data?.status || !data.data) {
          if (!append) {
            this.users = [];
          }
          return [];
        }

        const incoming = data.data.results ?? [];
        if (append) {
          const merged = [...this.users];
          for (const user of incoming) {
            if (!merged.some((item) => item.user_id === user.user_id)) {
              merged.push(user);
            }
          }
          this.users = merged;
        } else {
          this.users = incoming;
        }

        this.usersPaging = {
          current_page: data.data.pagings.current_page,
          total_pages: data.data.pagings.total_pages,
          per_page: data.data.pagings.per_page,
          count: data.data.pagings.count,
          total: data.data.pagings.total,
        };

        return this.users;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_list_users_error')
          ),
          EColor.error
        );
        return [];
      } finally {
        this.loadingUsers = false;
      }
    },

    async bootstrap(): Promise<void> {
      await this.listConversations(
        { current_page: 1, per_page: this.conversationsPaging.per_page },
        false
      );
    },

    async viewNotificationSettings(): Promise<InternalChatNotificationSettingsData | null> {
      try {
        const response = await axios.get<
          IApiResponse<InternalChatNotificationSettingsResponse['data']>
        >('/internal-chat/notification-settings');

        const data = response?.data;
        if (!data?.status || !data.data) {
          return null;
        }

        this.patchChatUser(data.data);
        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_notification_load_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async updateNotificationSettings(
      input: InternalChatNotificationSettingsRequest
    ): Promise<InternalChatNotificationSettingsData | null> {
      try {
        const response = await axios.put<
          IApiResponse<InternalChatNotificationSettingsResponse['data']>
        >('/internal-chat/notification-settings', input);

        const data = response?.data;
        if (!data?.status || !data.data) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_notification_save_error'),
            EColor.error
          );
          return null;
        }

        this.patchChatUser(data.data);
        this.showSnackbar(
          this.i18n.global.t('internal_chat_notification_save_success'),
          EColor.success
        );
        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_notification_save_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async openDirect(
      targetUserId: string
    ): Promise<InternalConversation | null> {
      try {
        const response = await axios.post<
          IApiResponse<ListConversationsResponse['data']['results'][number]>
        >('/internal-chat/open-direct', {
          target_user_id: targetUserId,
        });

        const data = response?.data;
        if (!data?.status || !data.data) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_open_conversation_error'),
            EColor.error
          );
          return null;
        }

        this.upsertConversation(data.data);
        this.activeConversation = data.data;
        await this.listMessages(data.data.conversation_id, {
          current_page: 1,
          per_page: this.messagesPaging.per_page,
        });
        await this.markRead(data.data.conversation_id);
        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_open_conversation_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async viewConversation(
      conversationId: string
    ): Promise<InternalConversation | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListConversationsResponse['data']['results'][number]>
        >(`/internal-chat/${conversationId}`);

        const data = response?.data;
        if (!data?.status || !data.data) {
          return null;
        }

        this.upsertConversation(data.data);
        return data.data;
      } catch {
        return null;
      }
    },

    async openConversation(conversationId: string): Promise<boolean> {
      const conversation = await this.viewConversation(conversationId);
      if (!conversation) return false;

      this.activeConversation = conversation;
      await this.listMessages(conversationId, {
        current_page: 1,
        per_page: this.messagesPaging.per_page,
      });
      await this.markRead(conversationId);
      return true;
    },

    async closeConversation(conversationId: string): Promise<boolean> {
      try {
        const response = await axios.post<IApiResponse<boolean>>(
          `/internal-chat/${conversationId}/close`,
          {}
        );

        const data = response?.data;
        if (!data?.status) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_close_conversation_error'),
            EColor.error
          );
          return false;
        }

        const closedConversation = this.conversations.find(
          (item) => item.conversation_id === conversationId
        );
        const closedUnreadCount = closedConversation?.unread_count ?? 0;

        this.conversations = this.conversations.filter(
          (item) => item.conversation_id !== conversationId
        );

        if (this.activeConversation?.conversation_id === conversationId) {
          this.activeConversation = null;
          this.messages = [];
        }

        if (closedUnreadCount > 0) {
          this.adjustUnreadSummaryCount(-closedUnreadCount);
        }

        return true;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_close_conversation_error')
          ),
          EColor.error
        );
        return false;
      }
    },

    async markRead(
      conversationId: string,
      lastReadMessageId?: string | null
    ): Promise<boolean> {
      try {
        const response = await axios.post<IApiResponse<boolean>>(
          `/internal-chat/${conversationId}/mark-read`,
          {
            last_read_message_id: lastReadMessageId ?? null,
          }
        );

        const data = response?.data;
        if (!data?.status) return false;

        const conversation = this.conversations.find(
          (item) => item.conversation_id === conversationId
        );
        const previousUnreadCount = conversation?.unread_count ?? 0;

        if (conversation) {
          conversation.unread_count = 0;
        }
        if (this.activeConversation?.conversation_id === conversationId) {
          this.activeConversation.unread_count = 0;
        }
        if (previousUnreadCount > 0) {
          this.adjustUnreadSummaryCount(-previousUnreadCount);
        }

        return true;
      } catch {
        return false;
      }
    },

    async listMessages(
      conversationId: string,
      query: Partial<ListMessagesQuery> = {},
      append = false
    ): Promise<InternalMessage[]> {
      this.loadingMessages = true;

      try {
        const params: Partial<ListMessagesQuery> = {
          current_page: query.current_page ?? 1,
          per_page: query.per_page ?? this.messagesPaging.per_page,
        };

        const response = await axios.get<
          IApiResponse<ListMessagesResponse['data']>
        >(`/internal-chat/${conversationId}/messages`, {
          params,
        });

        const data = response?.data;
        if (!data?.status || !data.data) {
          if (!append) {
            this.messages = [];
          }
          return [];
        }

        const normalized = [...(data.data.results ?? [])].reverse();

        if (append) {
          const next = [...normalized];
          for (const current of this.messages) {
            if (!next.some((item) => item.message_id === current.message_id)) {
              next.push(current);
            }
          }
          this.messages = next;
        } else {
          this.messages = normalized;
        }

        this.messagesPaging = {
          current_page: data.data.pagings.current_page,
          total_pages: data.data.pagings.total_pages,
          per_page: data.data.pagings.per_page,
          count: data.data.pagings.count,
          total: data.data.pagings.total,
        };

        return this.messages;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_list_messages_error')
          ),
          EColor.error
        );
        return [];
      } finally {
        this.loadingMessages = false;
      }
    },

    async searchMessages(
      conversationId: string,
      search: string,
      currentPage: number = 1,
      perPage: number = 50
    ): Promise<SearchInternalChatMessagesResponse> {
      const emptyResponse = {
        results: [],
        pagings: {
          current_page: 1,
          total_pages: 0,
          per_page: perPage,
          count: 0,
          total: 0,
        },
      };

      try {
        const response = await axios.get<
          IApiResponse<SearchInternalChatMessagesResponse>
        >(`/internal-chat/${conversationId}/search`, {
          params: {
            search,
            current_page: currentPage,
            per_page: perPage,
          },
        });

        const data = response?.data;
        if (!data?.status || !data.data) {
          return emptyResponse;
        }

        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('search_messages_error')
          ),
          EColor.error
        );
        return emptyResponse;
      }
    },

    async createMessage(
      conversationId: string,
      payload: FormData | CreateMessageBody,
      options: {
        skipLoading?: boolean;
        onUploadProgress?: (progress: number) => void;
      } = {}
    ): Promise<boolean> {
      if (!options.skipLoading) {
        this.sendingMessage = true;
      }

      try {
        const config: AxiosRequestConfig = {};
        if (payload instanceof FormData) {
          config.headers = {
            'Content-Type': 'multipart/form-data',
          };
        }
        if (options.onUploadProgress) {
          config.onUploadProgress = (event) => {
            if (!event.total) {
              options.onUploadProgress?.(0);
              return;
            }

            const progress = Math.round((event.loaded * 100) / event.total);
            options.onUploadProgress?.(progress);
          };
        }

        const response = await axios.post<IApiResponse<{ queued: boolean }>>(
          `/internal-chat/${conversationId}/messages`,
          payload,
          config
        );

        const data = response?.data;
        if (!data?.status) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_send_message_error'),
            EColor.error
          );
          return false;
        }

        return true;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_send_message_error')
          ),
          EColor.error
        );
        return false;
      } finally {
        if (!options.skipLoading) {
          this.sendingMessage = false;
        }
      }
    },

    async listChatContacts(
      currentPage = 1,
      perPage = 10,
      search?: string
    ): Promise<ListInternalChatContactsResponse['data'] | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListInternalChatContactsResponse['data']>
        >('/internal-chat/contacts', {
          params: {
            current_page: currentPage,
            per_page: perPage,
            search: search?.trim() || undefined,
          },
        });

        return response.data?.data ?? null;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_list_contacts_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async viewContactPhone(
      contactId: string
    ): Promise<ViewInternalChatContactPhoneResponse['data'] | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewInternalChatContactPhoneResponse['data']>
        >(`/internal-chat/contacts/${contactId}/phone`);

        return response.data?.data ?? null;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_view_contact_phone_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async generateLinkPreview(
      input: ViewInternalChatLinkPreviewBody
    ): Promise<ViewInternalChatLinkPreviewResponse['data'] | null> {
      try {
        const response = await axios.post<
          IApiResponse<ViewInternalChatLinkPreviewResponse['data']>
        >('/internal-chat/link-preview', input);
        return response.data?.data ?? null;
      } catch {
        return null;
      }
    },

    async reactMessage(
      conversationId: string,
      messageId: string,
      emoji: string
    ): Promise<boolean> {
      try {
        const response = await axios.post<IApiResponse<boolean>>(
          `/internal-chat/${conversationId}/messages/${messageId}/react`,
          { emoji }
        );

        return response?.data?.status === true;
      } catch {
        return false;
      }
    },

    async editMessage(
      conversationId: string,
      messageId: string,
      message: string
    ): Promise<boolean> {
      try {
        const response = await axios.post<IApiResponse<boolean>>(
          `/internal-chat/${conversationId}/messages/${messageId}/edit`,
          { message }
        );

        return response?.data?.status === true;
      } catch {
        return false;
      }
    },

    async deleteMessage(
      conversationId: string,
      messageId: string
    ): Promise<boolean> {
      try {
        const response = await axios.post<IApiResponse<boolean>>(
          `/internal-chat/${conversationId}/messages/${messageId}/delete`,
          {}
        );

        return response?.data?.status === true;
      } catch {
        return false;
      }
    },

    async viewMessageHistory(
      conversationId: string,
      messageId: string
    ): Promise<InternalMessageHistoryItem[]> {
      try {
        const response = await axios.get<
          IApiResponse<MessageHistoryResponse['data']>
        >(`/internal-chat/${conversationId}/messages/${messageId}/history`);

        const data = response?.data;
        if (!data?.status || !data.data) return [];

        return data.data.results ?? [];
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_list_messages_error')
          ),
          EColor.error
        );
        return [];
      }
    },

    async listGroupMembers(
      conversationId: string
    ): Promise<InternalParticipant[]> {
      this.loadingGroupMembers = true;

      try {
        const response = await axios.get<
          IApiResponse<ListGroupMembersResponse['data']>
        >(`/internal-chat/groups/${conversationId}/members`);

        const data = response?.data;
        if (!data?.status || !data.data) {
          this.groupMembers = [];
          return [];
        }

        this.groupMembers = data.data;
        return this.groupMembers;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_list_group_members_error')
          ),
          EColor.error
        );
        return [];
      } finally {
        this.loadingGroupMembers = false;
      }
    },

    async updateGroup(
      conversationId: string,
      input: {
        name?: string;
        photo?: string | null;
        photoFile?: File | null;
      }
    ): Promise<InternalConversation | null> {
      try {
        let payload: FormData | { name?: string; photo?: string | null };
        const config: AxiosRequestConfig = {};

        if (typeof File !== 'undefined' && input.photoFile instanceof File) {
          const formData = new FormData();
          if (input.name !== undefined) {
            formData.append('name', input.name);
          }
          formData.append('photo', input.photoFile);
          payload = formData;
          config.headers = {
            'Content-Type': 'multipart/form-data',
          };
        } else {
          payload = {};
          if (input.name !== undefined) payload.name = input.name;
          if (input.photo !== undefined) payload.photo = input.photo;
        }

        const response = await axios.patch<
          IApiResponse<ListConversationsResponse['data']['results'][number]>
        >(`/internal-chat/groups/${conversationId}`, payload, config);

        const data = response?.data;
        if (!data?.status || !data.data) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_update_group_error'),
            EColor.error
          );
          return null;
        }

        this.setActiveConversation(data.data);
        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_update_group_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async addGroupMember(
      conversationId: string,
      userId: string
    ): Promise<InternalConversation | null> {
      try {
        const response = await axios.post<
          IApiResponse<ListConversationsResponse['data']['results'][number]>
        >(`/internal-chat/groups/${conversationId}/members`, {
          user_id: userId,
        });

        const data = response?.data;
        if (!data?.status || !data.data) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_add_group_member_error'),
            EColor.error
          );
          return null;
        }

        this.setActiveConversation(data.data);
        await this.listGroupMembers(conversationId);
        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_add_group_member_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async removeGroupMember(
      conversationId: string,
      userId: string
    ): Promise<boolean> {
      try {
        const response = await axios.delete<IApiResponse<null>>(
          `/internal-chat/groups/${conversationId}/members/${userId}`
        );

        const data = response?.data;
        if (!data?.status) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_remove_group_member_error'),
            EColor.error
          );
          return false;
        }

        this.groupMembers = this.groupMembers.filter(
          (item) => item.user_id !== userId
        );
        const conversation = await this.viewConversation(conversationId);
        if (conversation) {
          this.setActiveConversation(conversation);
        }
        return true;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_remove_group_member_error')
          ),
          EColor.error
        );
        return false;
      }
    },

    async transferGroupLeader(
      conversationId: string,
      userId: string
    ): Promise<InternalConversation | null> {
      try {
        const response = await axios.patch<
          IApiResponse<ListConversationsResponse['data']['results'][number]>
        >(`/internal-chat/groups/${conversationId}/leader`, {
          user_id: userId,
        });

        const data = response?.data;
        if (!data?.status || !data.data) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_transfer_leader_error'),
            EColor.error
          );
          return null;
        }

        this.setActiveConversation(data.data);
        await this.listGroupMembers(conversationId);
        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_transfer_leader_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    async publishActivity(
      conversationId: string,
      state: EInternalChatActivityState
    ): Promise<void> {
      try {
        await axios.post<IApiResponse<null>>('/internal-chat/activity', {
          conversation_id: conversationId,
          state,
        });
      } catch {
        // Keep realtime activity failures silent so the chat remains usable.
      }
    },

    async createGroup(input: {
      name: string;
      member_user_ids: string[];
      photo?: string | null;
      photoFile?: File | null;
    }): Promise<InternalConversation | null> {
      try {
        let payload:
          | FormData
          | {
              name: string;
              member_user_ids: string[];
              photo: string | null;
            };
        const config: AxiosRequestConfig = {};

        if (typeof File !== 'undefined' && input.photoFile instanceof File) {
          const formData = new FormData();
          formData.append('name', input.name);
          formData.append(
            'member_user_ids',
            JSON.stringify(input.member_user_ids)
          );
          formData.append('photo', input.photoFile);

          payload = formData;
          config.headers = {
            'Content-Type': 'multipart/form-data',
          };
        } else {
          payload = {
            name: input.name,
            member_user_ids: input.member_user_ids,
            photo: input.photo ?? null,
          };
        }

        const response = await axios.post<
          IApiResponse<ListConversationsResponse['data']['results'][number]>
        >('/internal-chat/groups', payload, config);

        const data = response?.data;
        if (!data?.status || !data.data) {
          this.showSnackbar(
            data?.message ||
              this.i18n.global.t('internal_chat_create_group_error'),
            EColor.error
          );
          return null;
        }

        this.upsertConversation(data.data);
        this.activeConversation = data.data;
        await this.listMessages(data.data.conversation_id, {
          current_page: 1,
          per_page: this.messagesPaging.per_page,
        });
        return data.data;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t('internal_chat_create_group_error')
          ),
          EColor.error
        );
        return null;
      }
    },

    handleRealtimePayload(payload: unknown): InternalMessage | null {
      if (!payload || typeof payload !== 'object') return null;
      const data = payload as Record<string, unknown>;

      if (data.type === 'internal_chat_conversation_sync') {
        const isMessageSync = data.reason === 'message';

        if (isMessageSync) {
          this.scheduleUnreadSummaryRefresh();
          return null;
        }

        this.scheduleRefreshConversations();
        this.scheduleUnreadSummaryRefresh();
        return null;
      }

      if (
        data.type === 'typing' &&
        typeof data.conversation_id === 'string' &&
        typeof data.user_id === 'string' &&
        typeof data.state === 'string'
      ) {
        this.setRemoteActivity({
          conversation_id: data.conversation_id,
          user_id: data.user_id,
          user_name: typeof data.user_name === 'string' ? data.user_name : null,
          user_photo:
            typeof data.user_photo === 'string' ? data.user_photo : null,
          state: data.state as EInternalChatActivityState,
        });
        return null;
      }

      if (
        typeof data.message_id !== 'string' ||
        typeof data.conversation_id !== 'string' ||
        typeof data.account_id !== 'string'
      ) {
        return null;
      }

      const message = data as unknown as InternalMessage;
      const isActive =
        this.activeConversation?.conversation_id === message.conversation_id;

      if (isActive) {
        this.upsertMessage(message);
        const latestMessage = this.messages[this.messages.length - 1];
        void this.markRead(message.conversation_id, latestMessage?.message_id);
      }

      const conversation = this.conversations.find(
        (item) => item.conversation_id === message.conversation_id
      );

      if (conversation) {
        conversation.last_message_id = message.message_id;
        conversation.last_message_at = message.date;
        conversation.last_message_preview = normalizeMessagePreview(message);
        conversation.is_closed_for_me = false;

        const fromMe =
          !!this.currentUserId && message.user?.id === this.currentUserId;
        if (isActive || fromMe) {
          const previousUnreadCount = conversation.unread_count ?? 0;
          conversation.unread_count = 0;
          if (previousUnreadCount > 0) {
            this.adjustUnreadSummaryCount(-previousUnreadCount);
          }
        } else {
          conversation.unread_count += 1;
          this.adjustUnreadSummaryCount(1);
        }

        this.sortConversations();
      } else {
        this.scheduleRefreshConversations();
        this.scheduleUnreadSummaryRefresh();
      }

      if (
        this.activeConversation?.conversation_id === message.conversation_id
      ) {
        this.activeConversation.last_message_id = message.message_id;
        this.activeConversation.last_message_at = message.date;
        this.activeConversation.last_message_preview =
          normalizeMessagePreview(message);
        this.activeConversation.is_closed_for_me = false;
        this.activeConversation.unread_count = 0;
      }

      return message;
    },
  },
});
