import type {
  InternalChatConversation,
  InternalChatMessage,
  InternalChatPagedResponse,
  InternalChatPaging,
  InternalChatRemoteActivity,
  InternalChatUploadState,
  InternalChatUser,
} from '../types/internalChat';
import { resolveInternalChatMessagePreview } from '../utils/internalChatText';

const DEFAULT_PAGING: InternalChatPaging = {
  current_page: 1,
  total_pages: 1,
  per_page: 20,
  count: 0,
  total: 0,
};

export type InternalChatState = {
  conversations: InternalChatConversation[];
  conversationsPaging: InternalChatPaging;
  users: InternalChatUser[];
  usersPaging: InternalChatPaging;
  messages: Record<string, InternalChatMessage[]>;
  messagesPaging: Record<string, InternalChatPaging>;
  activeConversation: InternalChatConversation | null;
  remoteActivities: Record<string, InternalChatRemoteActivity>;
  uploadStates: Record<string, InternalChatUploadState>;
};

export type InternalChatAction =
  | {
      type: 'setConversations';
      payload: InternalChatPagedResponse<InternalChatConversation>;
      append: boolean;
    }
  | {
      type: 'setUsers';
      payload: InternalChatPagedResponse<InternalChatUser>;
      append: boolean;
    }
  | {
      type: 'setMessages';
      conversationId: string;
      payload: InternalChatPagedResponse<InternalChatMessage>;
      append: boolean;
    }
  | { type: 'upsertConversation'; conversation: InternalChatConversation }
  | { type: 'removeConversation'; conversationId: string }
  | {
      type: 'setActiveConversation';
      conversation: InternalChatConversation | null;
    }
  | {
      type: 'upsertMessage';
      message: InternalChatMessage;
      currentUserId: string | null;
    }
  | { type: 'markRead'; conversationId: string }
  | { type: 'setRemoteActivity'; activity: InternalChatRemoteActivity }
  | { type: 'clearRemoteActivity'; conversationId: string; userId: string }
  | {
      type: 'setUploadState';
      hash: string;
      uploadState: InternalChatUploadState;
    }
  | { type: 'clearUploadState'; hash: string }
  | { type: 'reset' };

export function createInitialInternalChatState(): InternalChatState {
  return {
    conversations: [],
    conversationsPaging: DEFAULT_PAGING,
    users: [],
    usersPaging: DEFAULT_PAGING,
    messages: {},
    messagesPaging: {},
    activeConversation: null,
    remoteActivities: {},
    uploadStates: {},
  };
}

function isRemoteMessage(message: InternalChatMessage): boolean {
  return !message.message_id.startsWith('local-');
}

function clearUploadStatesForMessages(
  uploadStates: Record<string, InternalChatUploadState>,
  messages: InternalChatMessage[]
): Record<string, InternalChatUploadState> {
  let next: Record<string, InternalChatUploadState> | null = null;

  for (const message of messages) {
    if (
      !message.hash ||
      !isRemoteMessage(message) ||
      !uploadStates[message.hash]
    ) {
      continue;
    }
    if (!next) next = { ...uploadStates };
    delete next[message.hash];
  }

  return next ?? uploadStates;
}

function compareConversations(
  a: InternalChatConversation,
  b: InternalChatConversation
): number {
  const dateA = Date.parse(a.last_message_at ?? a.updated_at ?? a.created_at);
  const dateB = Date.parse(b.last_message_at ?? b.updated_at ?? b.created_at);
  return (
    (Number.isFinite(dateB) ? dateB : 0) - (Number.isFinite(dateA) ? dateA : 0)
  );
}

function mergeConversations(
  current: InternalChatConversation[],
  incoming: InternalChatConversation[],
  append: boolean
): InternalChatConversation[] {
  const map = new Map<string, InternalChatConversation>();

  if (append) {
    for (const item of current) {
      map.set(item.conversation_id, item);
    }
  }

  for (const item of incoming) {
    map.set(item.conversation_id, item);
  }

  if (!append) {
    for (const item of current) {
      if (!map.has(item.conversation_id)) {
        continue;
      }
    }
  }

  return Array.from(map.values()).sort(compareConversations);
}

function mergeUsers(
  current: InternalChatUser[],
  incoming: InternalChatUser[],
  append: boolean
): InternalChatUser[] {
  const map = new Map<string, InternalChatUser>();
  if (append) {
    for (const item of current) map.set(item.user_id, item);
  }
  for (const item of incoming) map.set(item.user_id, item);
  return Array.from(map.values());
}

function sortMessages(messages: InternalChatMessage[]): InternalChatMessage[] {
  return [...messages].sort((a, b) => {
    const dateA = Date.parse(a.date);
    const dateB = Date.parse(b.date);
    return (
      (Number.isFinite(dateA) ? dateA : 0) -
      (Number.isFinite(dateB) ? dateB : 0)
    );
  });
}

function mergeMessages(
  current: InternalChatMessage[],
  incoming: InternalChatMessage[],
  append: boolean
): InternalChatMessage[] {
  const map = new Map<string, InternalChatMessage>();

  if (append) {
    for (const item of current) {
      map.set(item.message_id, item);
    }
  }

  for (const item of incoming) {
    const hashKey = item.hash
      ? Array.from(map.values()).find((message) => message.hash === item.hash)
          ?.message_id
      : null;
    if (hashKey) {
      map.delete(hashKey);
    }
    map.set(item.message_id, item);
  }

  return sortMessages(Array.from(map.values()));
}

function upsertMessageState(
  state: InternalChatState,
  message: InternalChatMessage,
  currentUserId: string | null
): InternalChatState {
  const conversationId = message.conversation_id;
  const currentMessages = state.messages[conversationId] ?? [];
  const nextMessages = mergeMessages(currentMessages, [message], true);
  const isActive =
    state.activeConversation?.conversation_id === message.conversation_id;
  const fromMe = !!currentUserId && message.user?.id === currentUserId;

  let foundConversation = false;
  const conversations = state.conversations
    .map((conversation) => {
      if (conversation.conversation_id !== conversationId) {
        return conversation;
      }
      foundConversation = true;
      return {
        ...conversation,
        last_message_id: message.message_id,
        last_message_at: message.date,
        last_message_preview: resolveInternalChatMessagePreview(message),
        is_closed_for_me: false,
        unread_count:
          isActive || fromMe ? 0 : Math.max(0, conversation.unread_count) + 1,
      };
    })
    .sort(compareConversations);

  const activeConversation =
    state.activeConversation?.conversation_id === conversationId
      ? {
          ...state.activeConversation,
          last_message_id: message.message_id,
          last_message_at: message.date,
          last_message_preview: resolveInternalChatMessagePreview(message),
          is_closed_for_me: false,
          unread_count:
            isActive || fromMe ? 0 : state.activeConversation.unread_count,
        }
      : state.activeConversation;

  return {
    ...state,
    conversations: foundConversation ? conversations : state.conversations,
    activeConversation,
    uploadStates: message.hash
      ? clearUploadStatesForMessages(state.uploadStates, [message])
      : state.uploadStates,
    messages: {
      ...state.messages,
      [conversationId]: nextMessages,
    },
  };
}

export function internalChatReducer(
  state: InternalChatState,
  action: InternalChatAction
): InternalChatState {
  switch (action.type) {
    case 'setConversations':
      return {
        ...state,
        conversations: mergeConversations(
          action.append ? state.conversations : [],
          action.payload.results,
          true
        ),
        conversationsPaging: {
          current_page: action.payload.current_page,
          total_pages: action.payload.total_pages,
          per_page: action.payload.per_page,
          count: action.payload.count,
          total: action.payload.total,
        },
      };
    case 'setUsers':
      return {
        ...state,
        users: mergeUsers(
          action.append ? state.users : [],
          action.payload.results,
          true
        ),
        usersPaging: {
          current_page: action.payload.current_page,
          total_pages: action.payload.total_pages,
          per_page: action.payload.per_page,
          count: action.payload.count,
          total: action.payload.total,
        },
      };
    case 'setMessages':
      return {
        ...state,
        uploadStates: clearUploadStatesForMessages(
          state.uploadStates,
          action.payload.results
        ),
        messages: {
          ...state.messages,
          [action.conversationId]: mergeMessages(
            action.append ? (state.messages[action.conversationId] ?? []) : [],
            [...action.payload.results].reverse(),
            true
          ),
        },
        messagesPaging: {
          ...state.messagesPaging,
          [action.conversationId]: {
            current_page: action.payload.current_page,
            total_pages: action.payload.total_pages,
            per_page: action.payload.per_page,
            count: action.payload.count,
            total: action.payload.total,
          },
        },
      };
    case 'upsertConversation':
      return {
        ...state,
        conversations: mergeConversations(
          state.conversations,
          [action.conversation],
          true
        ),
        activeConversation:
          state.activeConversation?.conversation_id ===
          action.conversation.conversation_id
            ? action.conversation
            : state.activeConversation,
      };
    case 'removeConversation':
      return {
        ...state,
        conversations: state.conversations.filter(
          (item) => item.conversation_id !== action.conversationId
        ),
        activeConversation:
          state.activeConversation?.conversation_id === action.conversationId
            ? null
            : state.activeConversation,
      };
    case 'setActiveConversation':
      return {
        ...state,
        activeConversation: action.conversation,
      };
    case 'upsertMessage':
      return upsertMessageState(state, action.message, action.currentUserId);
    case 'markRead':
      return {
        ...state,
        conversations: state.conversations.map((conversation) =>
          conversation.conversation_id === action.conversationId
            ? { ...conversation, unread_count: 0 }
            : conversation
        ),
        activeConversation:
          state.activeConversation?.conversation_id === action.conversationId
            ? { ...state.activeConversation, unread_count: 0 }
            : state.activeConversation,
      };
    case 'setRemoteActivity': {
      const activity = action.activity;
      if (activity.state === 'available') {
        const next = { ...state.remoteActivities };
        delete next[`${activity.conversation_id}:${activity.user_id}`];
        return { ...state, remoteActivities: next };
      }
      return {
        ...state,
        remoteActivities: {
          ...state.remoteActivities,
          [`${activity.conversation_id}:${activity.user_id}`]: activity,
        },
      };
    }
    case 'clearRemoteActivity': {
      const next = { ...state.remoteActivities };
      delete next[`${action.conversationId}:${action.userId}`];
      return {
        ...state,
        remoteActivities: next,
      };
    }
    case 'setUploadState':
      if (!action.hash) return state;
      return {
        ...state,
        uploadStates: {
          ...state.uploadStates,
          [action.hash]: action.uploadState,
        },
      };
    case 'clearUploadState': {
      if (!state.uploadStates[action.hash]) return state;
      const next = { ...state.uploadStates };
      delete next[action.hash];
      return {
        ...state,
        uploadStates: next,
      };
    }
    case 'reset':
      return createInitialInternalChatState();
    default:
      return state;
  }
}

export function getInternalChatTotalUnread(state: InternalChatState): number {
  return state.conversations.reduce(
    (total, conversation) =>
      total + Math.max(0, conversation.unread_count || 0),
    0
  );
}
