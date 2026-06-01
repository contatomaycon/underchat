import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addInternalChatGroupMember,
  closeInternalChatConversation,
  createInternalChatGroup,
  createInternalChatMessage,
  createInternalChatMessageWithFormData,
  deleteInternalChatMessage,
  editInternalChatMessage,
  listInternalChatConversations,
  listInternalChatGroupMembers,
  listInternalChatMessages,
  listInternalChatUsers,
  markInternalChatRead,
  openInternalDirectConversation,
  publishInternalChatActivity,
  reactInternalChatMessage,
  removeInternalChatGroupMember,
  searchInternalChatMessages,
  transferInternalChatGroupLeader,
  updateInternalChatGroup,
  viewInternalChatConversation,
  viewInternalChatMessageHistory,
} from '../api/internalChatApi';
import { getUser } from '../storage/authStorage';
import {
  addInternalChatSocketListener,
  consumePendingInternalChatMessages,
} from '../socket/internalChatSocket';
import {
  createInitialInternalChatState,
  getInternalChatTotalUnread,
  internalChatReducer,
} from './internalChatReducer';
import type {
  InternalChatActivityState,
  InternalChatConversation,
  InternalChatConversationType,
  InternalChatCreateGroupPayload,
  InternalChatCreateMessagePayload,
  InternalChatMessage,
  InternalChatMessageHistoryItem,
  InternalChatPagedResponse,
  InternalChatParticipant,
  InternalChatSearchMessageResult,
  InternalChatTab,
  InternalChatUpdateGroupPayload,
} from '../types/internalChat';
import {
  INTERNAL_CHAT_ACTIVITY_STATE,
  INTERNAL_CHAT_TAB,
  INTERNAL_MESSAGE_TYPE,
} from '../types/internalChat';

const INTERNAL_CONVERSATIONS_PER_PAGE = 20;
const INTERNAL_USERS_PER_PAGE = 20;
const INTERNAL_MESSAGES_PER_PAGE = 20;
const REMOTE_ACTIVITY_TIMEOUT_MS = 5000;
const REFRESH_DEBOUNCE_MS = 1000;

type LoadConversationsOptions = {
  tab?: InternalChatTab;
  search?: string | null;
  page?: number;
  append?: boolean;
};

type InternalChatContextValue = {
  enabled: boolean;
  currentUserId: string | null;
  state: ReturnType<typeof createInitialInternalChatState>;
  loadingConversations: boolean;
  loadingUsers: boolean;
  loadingMessages: boolean;
  groupMembers: InternalChatParticipant[];
  totalUnread: number;
  loadConversations: (
    options?: LoadConversationsOptions
  ) => Promise<InternalChatConversation[]>;
  loadUsers: (options?: {
    search?: string | null;
    page?: number;
    append?: boolean;
  }) => Promise<void>;
  openDirect: (userId: string) => Promise<InternalChatConversation | null>;
  openConversation: (
    conversationId: string
  ) => Promise<InternalChatConversation | null>;
  closeConversation: (conversationId: string) => Promise<boolean>;
  loadMessages: (
    conversationId: string,
    options?: { page?: number; append?: boolean }
  ) => Promise<InternalChatMessage[]>;
  markRead: (
    conversationId: string,
    lastReadMessageId?: string | null
  ) => Promise<boolean>;
  sendMessage: (
    conversationId: string,
    payload: InternalChatCreateMessagePayload
  ) => Promise<InternalChatMessage | null>;
  sendFormDataMessage: (
    conversationId: string,
    formData: FormData,
    optimisticMessage?: InternalChatMessage | null
  ) => Promise<InternalChatMessage | null>;
  reactMessage: (
    conversationId: string,
    messageId: string,
    emoji: string | null
  ) => Promise<boolean>;
  editMessage: (
    conversationId: string,
    messageId: string,
    message: string
  ) => Promise<boolean>;
  deleteMessage: (
    conversationId: string,
    messageId: string
  ) => Promise<boolean>;
  viewMessageHistory: (
    conversationId: string,
    messageId: string
  ) => Promise<InternalChatMessageHistoryItem[]>;
  searchMessages: (
    conversationId: string,
    search: string,
    options?: { page?: number; perPage?: number }
  ) => Promise<InternalChatPagedResponse<InternalChatSearchMessageResult>>;
  publishActivity: (
    conversationId: string,
    state: InternalChatActivityState
  ) => Promise<void>;
  listGroupMembers: (
    conversationId: string
  ) => Promise<InternalChatParticipant[]>;
  createGroup: (
    payload: InternalChatCreateGroupPayload
  ) => Promise<InternalChatConversation | null>;
  updateGroup: (
    conversationId: string,
    payload: InternalChatUpdateGroupPayload
  ) => Promise<InternalChatConversation | null>;
  addGroupMember: (
    conversationId: string,
    userId: string
  ) => Promise<InternalChatConversation | null>;
  removeGroupMember: (
    conversationId: string,
    userId: string
  ) => Promise<boolean>;
  transferGroupLeader: (
    conversationId: string,
    userId: string
  ) => Promise<InternalChatConversation | null>;
  resetInternalChat: () => void;
};

const InternalChatContext = createContext<InternalChatContextValue | null>(
  null
);

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function getUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const typed = user as { id?: unknown; user_id?: unknown };
  return normalizeIdentifier(typed.id) ?? normalizeIdentifier(typed.user_id);
}

function createClientMessageHash(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function tabToConversationType(
  tab: InternalChatTab | undefined
): InternalChatConversationType | null {
  if (tab === INTERNAL_CHAT_TAB.direct) return 'direct';
  if (tab === INTERNAL_CHAT_TAB.group) return 'group';
  return null;
}

function createOptimisticMessage(input: {
  conversationId: string;
  accountId: string;
  userId: string | null;
  userName: string;
  userPhoto: string | null;
  payload: InternalChatCreateMessagePayload;
  hash: string;
}): InternalChatMessage {
  return {
    message_id: `local-${input.hash}`,
    conversation_id: input.conversationId,
    account_id: input.accountId,
    type_user: 'operator',
    user: input.userId
      ? {
          id: input.userId,
          name: input.userName,
          photo: input.userPhoto,
        }
      : null,
    content: {
      type: input.payload.type,
      message: input.payload.message ?? null,
      message_quoted_id: input.payload.message_quoted_id ?? null,
      link_preview: input.payload.link_preview ?? null,
      location:
        input.payload.location_latitude !== undefined &&
        input.payload.location_longitude !== undefined
          ? {
              latitude: input.payload.location_latitude,
              longitude: input.payload.location_longitude,
              name: input.payload.location_name ?? null,
              address: input.payload.location_address ?? null,
            }
          : undefined,
    },
    date: new Date().toISOString(),
    hash: input.hash,
    local_status: 'sending',
  };
}

export function InternalChatProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [state, dispatch] = useReducer(
    internalChatReducer,
    undefined,
    createInitialInternalChatState
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('');
  const [currentUserPhoto, setCurrentUserPhoto] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [groupMembers, setGroupMembers] = useState<InternalChatParticipant[]>(
    []
  );

  const stateRef = useRef(state);
  const currentUserIdRef = useRef(currentUserId);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setCurrentUserId(null);
      setCurrentUserName('');
      setCurrentUserPhoto(null);
      return;
    }

    void getUser().then((user) => {
      if (cancelled) return;
      const typed = (user ?? {}) as {
        name?: unknown;
        photo?: unknown;
        info?: { name?: unknown; photo?: unknown };
      };
      setCurrentUserId(getUserId(user));
      setCurrentUserName(
        typeof typed.name === 'string'
          ? typed.name
          : typeof typed.info?.name === 'string'
            ? typed.info.name
            : ''
      );
      setCurrentUserPhoto(
        typeof typed.photo === 'string'
          ? typed.photo
          : typeof typed.info?.photo === 'string'
            ? typed.info.photo
            : null
      );
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const loadConversations = useCallback(
    async (
      options: LoadConversationsOptions = {}
    ): Promise<InternalChatConversation[]> => {
      if (!enabled) return [];
      const page = options.page ?? 1;
      const append = options.append ?? page > 1;
      setLoadingConversations(true);
      try {
        const data = await listInternalChatConversations({
          currentPage: page,
          perPage: INTERNAL_CONVERSATIONS_PER_PAGE,
          search: options.search ?? null,
          type: tabToConversationType(options.tab),
        });
        dispatch({ type: 'setConversations', payload: data, append });
        return data.results;
      } finally {
        setLoadingConversations(false);
      }
    },
    [enabled]
  );

  const scheduleRefreshConversations = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      void loadConversations({ page: 1, append: false });
    }, REFRESH_DEBOUNCE_MS);
  }, [loadConversations]);

  const loadUsers = useCallback(
    async (
      options: {
        search?: string | null;
        page?: number;
        append?: boolean;
      } = {}
    ) => {
      if (!enabled) return;
      const page = options.page ?? 1;
      const append = options.append ?? page > 1;
      setLoadingUsers(true);
      try {
        const data = await listInternalChatUsers({
          currentPage: page,
          perPage: INTERNAL_USERS_PER_PAGE,
          search: options.search ?? null,
        });
        dispatch({ type: 'setUsers', payload: data, append });
      } finally {
        setLoadingUsers(false);
      }
    },
    [enabled]
  );

  const loadMessages = useCallback(
    async (
      conversationId: string,
      options: { page?: number; append?: boolean } = {}
    ): Promise<InternalChatMessage[]> => {
      if (!enabled || !conversationId.trim()) return [];
      const page = options.page ?? 1;
      const append = options.append ?? page > 1;
      setLoadingMessages(true);
      try {
        const data = await listInternalChatMessages(conversationId, {
          currentPage: page,
          perPage: INTERNAL_MESSAGES_PER_PAGE,
        });
        dispatch({
          type: 'setMessages',
          conversationId,
          payload: data,
          append,
        });
        return data.results;
      } finally {
        setLoadingMessages(false);
      }
    },
    [enabled]
  );

  const markRead = useCallback(
    async (
      conversationId: string,
      lastReadMessageId?: string | null
    ): Promise<boolean> => {
      if (!enabled) return false;
      const ok = await markInternalChatRead(conversationId, lastReadMessageId);
      if (ok) {
        dispatch({ type: 'markRead', conversationId });
      }
      return ok;
    },
    [enabled]
  );

  const openConversation = useCallback(
    async (
      conversationId: string
    ): Promise<InternalChatConversation | null> => {
      if (!enabled) return null;
      const conversation = await viewInternalChatConversation(conversationId);
      if (!conversation) return null;
      dispatch({ type: 'upsertConversation', conversation });
      dispatch({ type: 'setActiveConversation', conversation });
      await loadMessages(conversationId, { page: 1, append: false });
      const pending = consumePendingInternalChatMessages(conversationId);
      for (const message of pending) {
        dispatch({
          type: 'upsertMessage',
          message,
          currentUserId: currentUserIdRef.current,
        });
      }
      const messages = stateRef.current.messages[conversationId] ?? [];
      await markRead(conversationId, messages[messages.length - 1]?.message_id);
      return conversation;
    },
    [enabled, loadMessages, markRead]
  );

  const openDirect = useCallback(
    async (userId: string): Promise<InternalChatConversation | null> => {
      if (!enabled) return null;
      const conversation = await openInternalDirectConversation(userId);
      if (!conversation) return null;
      dispatch({ type: 'upsertConversation', conversation });
      dispatch({ type: 'setActiveConversation', conversation });
      await loadMessages(conversation.conversation_id, {
        page: 1,
        append: false,
      });
      await markRead(conversation.conversation_id);
      return conversation;
    },
    [enabled, loadMessages, markRead]
  );

  const closeConversation = useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!enabled) return false;
      const ok = await closeInternalChatConversation(conversationId);
      if (ok) {
        dispatch({ type: 'removeConversation', conversationId });
      }
      return ok;
    },
    [enabled]
  );

  const sendMessage = useCallback(
    async (
      conversationId: string,
      payload: InternalChatCreateMessagePayload
    ): Promise<InternalChatMessage | null> => {
      if (!enabled) return null;
      const conversation =
        stateRef.current.activeConversation?.conversation_id === conversationId
          ? stateRef.current.activeConversation
          : stateRef.current.conversations.find(
              (item) => item.conversation_id === conversationId
            );
      if (!conversation) return null;

      const hash = payload.hash?.trim() || createClientMessageHash();
      const nextPayload = { ...payload, hash };
      const optimistic = createOptimisticMessage({
        conversationId,
        accountId: conversation.account_id,
        userId: currentUserIdRef.current,
        userName: currentUserName || 'Você',
        userPhoto: currentUserPhoto,
        payload: nextPayload,
        hash,
      });
      dispatch({
        type: 'upsertMessage',
        message: optimistic,
        currentUserId: currentUserIdRef.current,
      });

      try {
        const result = await createInternalChatMessage(
          conversationId,
          nextPayload
        );
        if (result.ok && result.message) {
          dispatch({
            type: 'upsertMessage',
            message: result.message,
            currentUserId: currentUserIdRef.current,
          });
          return result.message;
        }
      } catch {
        // The optimistic message below must not remain stuck as "sending".
      }

      dispatch({
        type: 'upsertMessage',
        message: {
          ...optimistic,
          local_status: 'error',
          local_error: 'Erro ao enviar mensagem.',
        },
        currentUserId: currentUserIdRef.current,
      });
      return null;
    },
    [currentUserName, currentUserPhoto, enabled]
  );

  const sendFormDataMessage = useCallback(
    async (
      conversationId: string,
      formData: FormData,
      optimisticMessage?: InternalChatMessage | null
    ): Promise<InternalChatMessage | null> => {
      if (!enabled) return null;
      if (optimisticMessage) {
        dispatch({
          type: 'upsertMessage',
          message: optimisticMessage,
          currentUserId: currentUserIdRef.current,
        });
      }
      try {
        const result = await createInternalChatMessageWithFormData(
          conversationId,
          formData
        );
        if (result.ok && result.message) {
          dispatch({
            type: 'upsertMessage',
            message: result.message,
            currentUserId: currentUserIdRef.current,
          });
          return result.message;
        }
      } catch {
        // The optimistic message below must not remain stuck as "sending".
      }
      if (optimisticMessage) {
        dispatch({
          type: 'upsertMessage',
          message: {
            ...optimisticMessage,
            local_status: 'error',
            local_error: 'Erro ao enviar mensagem.',
          },
          currentUserId: currentUserIdRef.current,
        });
      }
      return null;
    },
    [enabled]
  );

  const reactMessage = useCallback(
    async (conversationId: string, messageId: string, emoji: string | null) => {
      const ok = await reactInternalChatMessage(
        conversationId,
        messageId,
        emoji
      );
      if (ok) {
        const conversation = await viewInternalChatConversation(conversationId);
        if (conversation)
          dispatch({ type: 'upsertConversation', conversation });
        await loadMessages(conversationId, { page: 1, append: false });
      }
      return ok;
    },
    [loadMessages]
  );

  const editMessage = useCallback(
    async (conversationId: string, messageId: string, message: string) => {
      const ok = await editInternalChatMessage(
        conversationId,
        messageId,
        message
      );
      if (ok) await loadMessages(conversationId, { page: 1, append: false });
      return ok;
    },
    [loadMessages]
  );

  const deleteMessage = useCallback(
    async (conversationId: string, messageId: string) => {
      const ok = await deleteInternalChatMessage(conversationId, messageId);
      if (ok) await loadMessages(conversationId, { page: 1, append: false });
      return ok;
    },
    [loadMessages]
  );

  const viewMessageHistory = useCallback(
    (conversationId: string, messageId: string) =>
      viewInternalChatMessageHistory(conversationId, messageId),
    []
  );

  const searchMessages = useCallback(
    (
      conversationId: string,
      search: string,
      options?: { page?: number; perPage?: number }
    ) =>
      searchInternalChatMessages(conversationId, search, {
        currentPage: options?.page ?? 1,
        perPage: options?.perPage ?? 30,
      }),
    []
  );

  const publishActivity = useCallback(
    (conversationId: string, state: InternalChatActivityState) =>
      publishInternalChatActivity(conversationId, state),
    []
  );

  const listGroupMembers = useCallback(
    async (conversationId: string): Promise<InternalChatParticipant[]> => {
      const members = await listInternalChatGroupMembers(conversationId);
      setGroupMembers(members);
      return members;
    },
    []
  );

  const createGroup = useCallback(
    async (
      payload: InternalChatCreateGroupPayload
    ): Promise<InternalChatConversation | null> => {
      const conversation = await createInternalChatGroup(payload);
      if (!conversation) return null;
      dispatch({ type: 'upsertConversation', conversation });
      dispatch({ type: 'setActiveConversation', conversation });
      await loadMessages(conversation.conversation_id, {
        page: 1,
        append: false,
      });
      return conversation;
    },
    [loadMessages]
  );

  const updateGroup = useCallback(
    async (
      conversationId: string,
      payload: InternalChatUpdateGroupPayload
    ): Promise<InternalChatConversation | null> => {
      const conversation = await updateInternalChatGroup(
        conversationId,
        payload
      );
      if (!conversation) return null;
      dispatch({ type: 'upsertConversation', conversation });
      dispatch({ type: 'setActiveConversation', conversation });
      return conversation;
    },
    []
  );

  const addGroupMember = useCallback(
    async (
      conversationId: string,
      userId: string
    ): Promise<InternalChatConversation | null> => {
      const conversation = await addInternalChatGroupMember(
        conversationId,
        userId
      );
      if (!conversation) return null;
      dispatch({ type: 'upsertConversation', conversation });
      await listGroupMembers(conversationId);
      return conversation;
    },
    [listGroupMembers]
  );

  const removeGroupMember = useCallback(
    async (conversationId: string, userId: string): Promise<boolean> => {
      const ok = await removeInternalChatGroupMember(conversationId, userId);
      if (!ok) return false;
      await listGroupMembers(conversationId);
      const conversation = await viewInternalChatConversation(conversationId);
      if (conversation) dispatch({ type: 'upsertConversation', conversation });
      return true;
    },
    [listGroupMembers]
  );

  const transferGroupLeader = useCallback(
    async (
      conversationId: string,
      userId: string
    ): Promise<InternalChatConversation | null> => {
      const conversation = await transferInternalChatGroupLeader(
        conversationId,
        userId
      );
      if (!conversation) return null;
      dispatch({ type: 'upsertConversation', conversation });
      await listGroupMembers(conversationId);
      return conversation;
    },
    [listGroupMembers]
  );

  const resetInternalChat = useCallback(() => {
    dispatch({ type: 'reset' });
    setGroupMembers([]);
  }, []);

  useEffect(() => {
    if (!enabled) {
      resetInternalChat();
      return;
    }

    const offMessage = addInternalChatSocketListener('message', (message) => {
      const isActive =
        stateRef.current.activeConversation?.conversation_id ===
        message.conversation_id;
      const known = stateRef.current.conversations.some(
        (item) => item.conversation_id === message.conversation_id
      );

      dispatch({
        type: 'upsertMessage',
        message,
        currentUserId: currentUserIdRef.current,
      });

      if (isActive) {
        void markRead(message.conversation_id, message.message_id);
      }
      if (!known) {
        scheduleRefreshConversations();
      }
    });

    const offSync = addInternalChatSocketListener(
      'conversationSync',
      (sync) => {
        if (sync.reason === 'message') return;
        scheduleRefreshConversations();
      }
    );

    const offActivity = addInternalChatSocketListener(
      'activity',
      (activity) => {
        if (activity.user_id === currentUserIdRef.current) return;
        const key = `${activity.conversation_id}:${activity.user_id}`;
        if (activityTimersRef.current[key]) {
          clearTimeout(activityTimersRef.current[key]);
          delete activityTimersRef.current[key];
        }
        dispatch({
          type: 'setRemoteActivity',
          activity: {
            conversation_id: activity.conversation_id,
            user_id: activity.user_id,
            user_name: activity.user_name ?? null,
            user_photo: activity.user_photo ?? null,
            state: activity.state,
            expires_at: Date.now() + REMOTE_ACTIVITY_TIMEOUT_MS,
          },
        });
        if (activity.state !== INTERNAL_CHAT_ACTIVITY_STATE.available) {
          activityTimersRef.current[key] = setTimeout(() => {
            dispatch({
              type: 'clearRemoteActivity',
              conversationId: activity.conversation_id,
              userId: activity.user_id,
            });
            delete activityTimersRef.current[key];
          }, REMOTE_ACTIVITY_TIMEOUT_MS);
        }
      }
    );

    const offRecovery = addInternalChatSocketListener('recoveryFailed', () => {
      scheduleRefreshConversations();
      const activeConversationId =
        stateRef.current.activeConversation?.conversation_id;
      if (activeConversationId) {
        void loadMessages(activeConversationId, { page: 1, append: false });
      }
    });

    return () => {
      offMessage();
      offSync();
      offActivity();
      offRecovery();
    };
  }, [
    enabled,
    loadMessages,
    markRead,
    resetInternalChat,
    scheduleRefreshConversations,
  ]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      for (const timer of Object.values(activityTimersRef.current)) {
        clearTimeout(timer);
      }
      activityTimersRef.current = {};
    };
  }, []);

  const totalUnread = useMemo(() => getInternalChatTotalUnread(state), [state]);

  const value = useMemo<InternalChatContextValue>(
    () => ({
      enabled,
      currentUserId,
      state,
      loadingConversations,
      loadingUsers,
      loadingMessages,
      groupMembers,
      totalUnread,
      loadConversations,
      loadUsers,
      openDirect,
      openConversation,
      closeConversation,
      loadMessages,
      markRead,
      sendMessage,
      sendFormDataMessage,
      reactMessage,
      editMessage,
      deleteMessage,
      viewMessageHistory,
      searchMessages,
      publishActivity,
      listGroupMembers,
      createGroup,
      updateGroup,
      addGroupMember,
      removeGroupMember,
      transferGroupLeader,
      resetInternalChat,
    }),
    [
      addGroupMember,
      closeConversation,
      createGroup,
      currentUserId,
      deleteMessage,
      editMessage,
      enabled,
      groupMembers,
      listGroupMembers,
      loadConversations,
      loadMessages,
      loadUsers,
      loadingConversations,
      loadingMessages,
      loadingUsers,
      markRead,
      openConversation,
      openDirect,
      publishActivity,
      reactMessage,
      removeGroupMember,
      resetInternalChat,
      searchMessages,
      sendFormDataMessage,
      sendMessage,
      state,
      totalUnread,
      transferGroupLeader,
      updateGroup,
      viewMessageHistory,
    ]
  );

  return (
    <InternalChatContext.Provider value={value}>
      {children}
    </InternalChatContext.Provider>
  );
}

export function useInternalChat(): InternalChatContextValue {
  const ctx = useContext(InternalChatContext);
  if (!ctx) {
    throw new Error('useInternalChat must be used within InternalChatProvider');
  }
  return ctx;
}

export function buildInternalOptimisticFileMessage(input: {
  conversation: InternalChatConversation;
  currentUserId: string | null;
  userName: string;
  userPhoto: string | null;
  hash: string;
  content: InternalChatMessage['content'];
}): InternalChatMessage {
  return {
    message_id: `local-${input.hash}`,
    conversation_id: input.conversation.conversation_id,
    account_id: input.conversation.account_id,
    type_user: 'operator',
    user: input.currentUserId
      ? {
          id: input.currentUserId,
          name: input.userName || 'Você',
          photo: input.userPhoto,
        }
      : null,
    content: input.content,
    date: new Date().toISOString(),
    hash: input.hash,
    local_status: 'sending',
  };
}

export function createInternalChatMessageHash(): string {
  return createClientMessageHash();
}

export { INTERNAL_MESSAGE_TYPE };
