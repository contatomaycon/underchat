import { defineStore } from 'pinia';
import axios from '@webcore/axios';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { getI18n } from '@/plugins/i18n';
import { getUser } from '@/@webcore/localStorage/user';
import type { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import type { ListConversationsQuery } from '@core/schema/internalChat/listConversations/request.schema';
import type { ListConversationsResponse } from '@core/schema/internalChat/listConversations/response.schema';
import type { ListUsersQuery } from '@core/schema/internalChat/listUsers/request.schema';
import type { ListUsersResponse } from '@core/schema/internalChat/listUsers/response.schema';
import type { ListMessagesQuery } from '@core/schema/internalChat/listMessages/request.schema';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';
import type { CreateMessageBody } from '@core/schema/internalChat/createMessage/request.schema';
import type { ListGroupMembersResponse } from '@core/schema/internalChat/listGroupMembers/response.schema';
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
type InternalParticipant = ListGroupMembersResponse['data'][number];
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
  if (message.content?.type === EMessageType.text) {
    return message.content.message ?? null;
  }

  if (message.content?.type === EMessageType.image) return '[Imagem]';
  if (message.content?.type === EMessageType.video) return '[Vídeo]';
  if (message.content?.type === EMessageType.audio) return '[Áudio]';
  if (message.content?.type === EMessageType.document) return '[Documento]';
  if (message.content?.type === EMessageType.location) return '[Localização]';
  if (message.content?.type === EMessageType.contact_card) return '[Contato]';
  if (message.content?.type === EMessageType.contacts) return '[Contatos]';

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
    messagesPaging: makePaging(30),
    remoteActivities: {} as Record<string, RemoteActivity>,
    refreshConversationsTimer: null as ReturnType<typeof setTimeout> | null,
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
      const index = this.messages.findIndex(
        (item) => item.message_id === message.message_id
      );

      if (index >= 0) {
        this.messages[index] = message;
      } else {
        this.messages.push(message);
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
            this.i18n.global.t('chat_list_error', 'Erro ao listar conversas')
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
            this.i18n.global.t('user_list_error', 'Erro ao listar usuários')
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
              this.i18n.global.t(
                'chat_create_error',
                'Erro ao abrir conversa interna'
              ),
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
            this.i18n.global.t(
              'chat_create_error',
              'Erro ao abrir conversa interna'
            )
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
              this.i18n.global.t(
                'chat_update_error',
                'Erro ao fechar conversa interna'
              ),
            EColor.error
          );
          return false;
        }

        this.conversations = this.conversations.filter(
          (item) => item.conversation_id !== conversationId
        );

        if (this.activeConversation?.conversation_id === conversationId) {
          this.activeConversation = null;
          this.messages = [];
        }

        return true;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t(
              'chat_update_error',
              'Erro ao fechar conversa interna'
            )
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

        if (conversation) {
          conversation.unread_count = 0;
        }
        if (this.activeConversation?.conversation_id === conversationId) {
          this.activeConversation.unread_count = 0;
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
            this.i18n.global.t(
              'chat_message_list_error',
              'Erro ao listar mensagens'
            )
          ),
          EColor.error
        );
        return [];
      } finally {
        this.loadingMessages = false;
      }
    },

    async createMessage(
      conversationId: string,
      payload: FormData | CreateMessageBody
    ): Promise<boolean> {
      this.sendingMessage = true;

      try {
        const config: AxiosRequestConfig = {};
        if (payload instanceof FormData) {
          config.headers = {
            'Content-Type': 'multipart/form-data',
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
              this.i18n.global.t(
                'chat_create_error',
                'Erro ao enviar mensagem interna'
              ),
            EColor.error
          );
          return false;
        }

        return true;
      } catch (error) {
        this.showSnackbar(
          this.resolveErrorMessage(
            error,
            this.i18n.global.t(
              'chat_create_error',
              'Erro ao enviar mensagem interna'
            )
          ),
          EColor.error
        );
        return false;
      } finally {
        this.sendingMessage = false;
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

    async forwardMessage(
      conversationId: string,
      messageId: string,
      targetConversationIds: string[]
    ): Promise<boolean> {
      try {
        const response = await axios.post<
          IApiResponse<{ queued_count: number }>
        >(`/internal-chat/${conversationId}/messages/${messageId}/forward`, {
          target_conversation_ids: targetConversationIds,
        });

        return response?.data?.status === true;
      } catch {
        return false;
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
            this.i18n.global.t(
              'chat_list_error',
              'Erro ao listar participantes do grupo'
            )
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
              this.i18n.global.t(
                'chat_update_error',
                'Erro ao atualizar grupo'
              ),
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
            this.i18n.global.t('chat_update_error', 'Erro ao atualizar grupo')
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
              this.i18n.global.t(
                'chat_update_error',
                'Erro ao adicionar membro'
              ),
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
            this.i18n.global.t('chat_update_error', 'Erro ao adicionar membro')
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
              this.i18n.global.t('chat_update_error', 'Erro ao remover membro'),
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
            this.i18n.global.t('chat_update_error', 'Erro ao remover membro')
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
              this.i18n.global.t(
                'chat_update_error',
                'Erro ao transferir liderança'
              ),
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
            this.i18n.global.t(
              'chat_update_error',
              'Erro ao transferir liderança'
            )
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
        // Silencioso para não degradar UX do realtime.
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
              this.i18n.global.t('chat_create_error', 'Erro ao criar grupo'),
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
            this.i18n.global.t('chat_create_error', 'Erro ao criar grupo')
          ),
          EColor.error
        );
        return null;
      }
    },

    handleRealtimePayload(payload: unknown) {
      if (!payload || typeof payload !== 'object') return;
      const data = payload as Record<string, unknown>;

      if (data.type === 'internal_chat_conversation_sync') {
        this.scheduleRefreshConversations();
        return;
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
        return;
      }

      if (
        typeof data.message_id !== 'string' ||
        typeof data.conversation_id !== 'string' ||
        typeof data.account_id !== 'string'
      ) {
        return;
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
          conversation.unread_count = 0;
        } else {
          conversation.unread_count += 1;
        }

        this.sortConversations();
      } else {
        this.scheduleRefreshConversations();
      }

      if (
        this.activeConversation?.conversation_id === message.conversation_id
      ) {
        this.activeConversation.last_message_id = message.message_id;
        this.activeConversation.last_message_at = message.date;
        this.activeConversation.last_message_preview =
          normalizeMessagePreview(message);
        this.activeConversation.is_closed_for_me = false;
      }
    },
  },
});
