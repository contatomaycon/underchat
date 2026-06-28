import { useCallback, useEffect, useRef } from 'react';
import { Platform, Vibration, type AppStateStatus } from 'react-native';
import {
  canViewChat,
  isChatParticipant,
  isChatPrimary,
} from '../constants/chatAuthorization';
import {
  isChatRoomFocused,
  isInternalChatRoomFocused,
  navigateToChatRoom,
  navigateToInternalChatRoom,
} from '../navigation/navigationRef';
import { viewInternalChatConversation } from '../api/internalChatApi';
import {
  addChatSocketListener,
  type SocketChatPayload,
  type SocketMessagePayload,
} from '../socket/chatSocket';
import { addInternalChatSocketListener } from '../socket/internalChatSocket';
import {
  getChannels,
  getPermissions,
  getSectors,
  getUser,
  type UserChannel,
} from '../storage/authStorage';
import {
  ETypeUserChat,
  type EChatStatus,
  type ListChatsResult,
  type ListMessageResult,
  type MessageContent,
} from '../types/chat';
import {
  INTERNAL_CHAT_CONVERSATION_TYPE,
  type InternalChatConversation,
  type InternalChatMessage,
} from '../types/internalChat';
import { resolveInternalChatMessagePreview } from '../utils/internalChatText';
import {
  readMobileChatNotificationSettingsFromUser,
  readMobileInternalChatNotificationSettingsFromUser,
  resolveChatForegroundDelivery,
  resolveInternalChatForegroundDelivery,
  shouldNotifyChatMessage,
  shouldNotifyChatTransfer,
  shouldNotifyInternalChatMessage,
} from '../utils/mobileNotificationPreferences';
import {
  emitInAppNotification,
  type InAppNotificationPayload,
} from './inAppNotificationBus';
import { playInAppNotificationSound } from './inAppNotificationSound';

type ForegroundSocketNotificationOptions = {
  authenticated: boolean;
  navigationReady: boolean;
  canViewChatTabs: boolean;
  canViewInternalChatTab: boolean;
  getAppState: () => AppStateStatus;
};

type PendingChatMessage = {
  payload: SocketMessagePayload;
  timer: ReturnType<typeof setTimeout>;
};

type Delivery = {
  showToast: boolean;
  playSound: boolean;
  vibrate: boolean;
};

type ChatAccessContext = {
  permissions: string[];
  user: unknown;
  userSectors: string[];
  userChannels: UserChannel[];
};

const CHAT_MESSAGE_CONTEXT_WAIT_MS = 1_200;
const RECENT_EVENT_TTL_MS = 8_000;

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

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getUserId(user: unknown): string | null {
  if (!isRecord(user)) return null;
  return normalizeIdentifier(user.id) ?? normalizeIdentifier(user.user_id);
}

function hasChatParticipants(chat: ListChatsResult): boolean {
  if (chat.user?.id) {
    return true;
  }

  return Array.isArray(chat.secondary_users) && chat.secondary_users.length > 0;
}

function hasChannelAccess(
  chat: ListChatsResult,
  userChannels: UserChannel[]
): boolean {
  if (userChannels.length === 0) {
    return true;
  }

  return userChannels.some((channel) => channel.id === chat.worker?.id);
}

function hasSectorAccess(
  chat: ListChatsResult,
  userSectors: string[]
): boolean {
  return !!chat.sector?.id && userSectors.includes(chat.sector.id);
}

function canReceiveChatMessageNotification(
  chat: ListChatsResult,
  context: ChatAccessContext
): boolean {
  const userId = getUserId(context.user);
  if (!userId) {
    return false;
  }

  if (
    !canViewChat(chat, {
      permissions: context.permissions,
      userId,
      userSectors: context.userSectors,
      userChannels: context.userChannels,
    })
  ) {
    return false;
  }

  if (chat.status === 'in_chat') {
    return isChatParticipant(chat, userId);
  }

  if (chat.status === 'queue') {
    if (chat.user?.id) {
      return isChatPrimary(chat, userId);
    }

    if (chat.sector?.id) {
      return (
        hasSectorAccess(chat, context.userSectors) &&
        hasChannelAccess(chat, context.userChannels)
      );
    }

    return hasChannelAccess(chat, context.userChannels);
  }

  if (
    chat.status === 'ura' ||
    chat.status === 'ura_output' ||
    chat.status === 'ura_schedule' ||
    chat.status === 'ura_webhook'
  ) {
    if (hasChatParticipants(chat)) {
      return isChatParticipant(chat, userId);
    }

    if (chat.sector?.id) {
      return (
        hasSectorAccess(chat, context.userSectors) &&
        hasChannelAccess(chat, context.userChannels)
      );
    }

    return hasChannelAccess(chat, context.userChannels);
  }

  return false;
}

function canReceiveChatTransferNotification(
  chat: ListChatsResult,
  context: ChatAccessContext
): boolean {
  const userId = getUserId(context.user);
  if (!userId) {
    return false;
  }

  if (
    !canViewChat(chat, {
      permissions: context.permissions,
      userId,
      userSectors: context.userSectors,
      userChannels: context.userChannels,
    })
  ) {
    return false;
  }

  if (hasChatParticipants(chat)) {
    return isChatParticipant(chat, userId);
  }

  if (chat.sector?.id) {
    return (
      hasSectorAccess(chat, context.userSectors) &&
      hasChannelAccess(chat, context.userChannels)
    );
  }

  return hasChannelAccess(chat, context.userChannels);
}

function coerceChatPayload(payload: SocketChatPayload): ListChatsResult | null {
  if (!isRecord(payload)) return null;
  const chatId = readString(payload.chat_id);
  const status = readString(payload.status);
  if (!chatId || !status) return null;

  return {
    ...(payload as unknown as ListChatsResult),
    chat_id: chatId,
    status: status as EChatStatus,
  };
}

function getChatTitle(chat: ListChatsResult): string {
  return chat.name?.trim() || chat.contact?.name?.trim() || 'Chat';
}

function readMessageContent(
  payload: SocketMessagePayload
): MessageContent | null {
  const content = (payload as { content?: unknown }).content;
  return isRecord(content) ? (content as unknown as MessageContent) : null;
}

function previewFromContent(content: MessageContent | null): string | null {
  if (!content) return null;

  const explicitMessage = readString(content.message);
  if (explicitMessage) return explicitMessage;

  if (content.image) return readString(content.image.caption) ?? '[Imagem]';
  if (content.video) return readString(content.video.caption) ?? '[Vídeo]';
  if (content.audio) return '[Áudio]';
  if (content.document) {
    return readString(content.document.name) ?? '[Documento]';
  }
  if (content.location) {
    return (
      readString(content.location.name) ??
      readString(content.location.address) ??
      '[Localização]'
    );
  }
  if (content.contact) return readString(content.contact.name) ?? '[Contato]';
  if (content.contacts && content.contacts.length > 0) return '[Contatos]';
  if (content.sticker) return '[Figurinha]';

  return null;
}

function getChatMessagePreview(
  payload: SocketMessagePayload,
  chat: ListChatsResult
): string {
  return (
    previewFromContent(readMessageContent(payload)) ??
    readString(chat.summary?.last_message) ??
    '[Mensagem]'
  );
}

function isIncomingChatMessage(payload: SocketMessagePayload): boolean {
  const message = payload as Partial<ListMessageResult>;
  if ((message as { deleted?: unknown }).deleted === true) return false;
  if (message.type_user === ETypeUserChat.operator) return false;
  if (message.message_key?.from_me === true) return false;

  const contentType = readString(message.content?.type);
  return contentType !== 'system' && contentType !== 'annotation';
}

function getTransferProtocolKey(chat: ListChatsResult): string {
  if (!Array.isArray(chat.protocol_transfer)) return '';
  return chat.protocol_transfer
    .map((value) => readString(value))
    .filter((value): value is string => !!value)
    .join('|');
}

function didTransferProtocolChange(
  previous: ListChatsResult,
  current: ListChatsResult
): boolean {
  const previousKey = getTransferProtocolKey(previous);
  const currentKey = getTransferProtocolKey(current);
  return currentKey.length > 0 && previousKey !== currentKey;
}

function dispatchForegroundNotification(
  delivery: Delivery,
  notification: InAppNotificationPayload
): void {
  if (!delivery.showToast && !delivery.playSound && !delivery.vibrate) return;
  if (delivery.playSound) {
    void playInAppNotificationSound();
  }
  if (
    delivery.vibrate &&
    (Platform.OS === 'android' || Platform.OS === 'ios')
  ) {
    Vibration.vibrate([0, 250, 250, 250]);
  }
  if (delivery.showToast) {
    emitInAppNotification(notification);
  }
}

async function loadChatAccessContext(): Promise<ChatAccessContext> {
  try {
    const [permissions, user, userSectors, userChannels] = await Promise.all([
      getPermissions(),
      getUser(),
      getSectors(),
      getChannels(),
    ]);

    return {
      permissions,
      user,
      userSectors,
      userChannels,
    };
  } catch {
    return {
      permissions: [],
      user: null,
      userSectors: [],
      userChannels: [],
    };
  }
}

function isInternalMessageFromCurrentUser(
  message: InternalChatMessage,
  currentUserId: string | null
): boolean {
  if (!currentUserId) return false;
  return normalizeIdentifier(message.user?.id) === currentUserId;
}

function canCurrentUserViewInternalConversation(
  conversation: InternalChatConversation,
  currentUserId: string | null
): boolean {
  if (!currentUserId) return false;
  return conversation.participants.some(
    (participant) => normalizeIdentifier(participant.user_id) === currentUserId
  );
}

function getInternalChatTitle(
  conversation: InternalChatConversation,
  message: InternalChatMessage
): string {
  if (conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group) {
    return conversation.name?.trim() || 'Grupo interno';
  }

  return (
    message.user?.name?.trim() || conversation.name?.trim() || 'Chat Interno'
  );
}

function getInternalChatBody(
  conversation: InternalChatConversation,
  message: InternalChatMessage
): string {
  const preview = resolveInternalChatMessagePreview(message) ?? '[Mensagem]';

  if (conversation.type !== INTERNAL_CHAT_CONVERSATION_TYPE.group) {
    return preview;
  }

  const sender = message.user?.name?.trim() || 'Chat Interno';
  return `${sender}: ${preview}`;
}

export function useForegroundSocketNotifications({
  authenticated,
  navigationReady,
  canViewChatTabs,
  canViewInternalChatTab,
  getAppState,
}: ForegroundSocketNotificationOptions): void {
  const latestChatsRef = useRef<Map<string, ListChatsResult>>(new Map());
  const pendingChatMessagesRef = useRef<Map<string, PendingChatMessage>>(
    new Map()
  );
  const recentEventsRef = useRef<Map<string, number>>(new Map());
  const internalConversationCacheRef = useRef<
    Map<string, InternalChatConversation>
  >(new Map());
  const internalConversationFetchesRef = useRef<
    Map<string, Promise<InternalChatConversation | null>>
  >(new Map());

  const isChatForegroundReady = useCallback(() => {
    return (
      authenticated &&
      navigationReady &&
      canViewChatTabs &&
      getAppState() === 'active'
    );
  }, [authenticated, canViewChatTabs, getAppState, navigationReady]);

  const isInternalChatForegroundReady = useCallback(() => {
    return (
      authenticated &&
      navigationReady &&
      canViewInternalChatTab &&
      getAppState() === 'active'
    );
  }, [authenticated, canViewInternalChatTab, getAppState, navigationReady]);

  const markRecentEvent = useCallback((key: string): boolean => {
    const now = Date.now();
    for (const [eventKey, expiresAt] of recentEventsRef.current.entries()) {
      if (expiresAt <= now) {
        recentEventsRef.current.delete(eventKey);
      }
    }

    const existingExpiry = recentEventsRef.current.get(key);
    if (existingExpiry && existingExpiry > now) {
      return false;
    }

    recentEventsRef.current.set(key, now + RECENT_EVENT_TTL_MS);
    return true;
  }, []);

  const loadInternalConversation = useCallback(
    async (
      conversationId: string
    ): Promise<InternalChatConversation | null> => {
      const cached = internalConversationCacheRef.current.get(conversationId);
      if (cached) return cached;

      const inFlight =
        internalConversationFetchesRef.current.get(conversationId);
      if (inFlight) return inFlight;

      const promise = viewInternalChatConversation(conversationId)
        .then((conversation) => {
          if (conversation) {
            internalConversationCacheRef.current.set(
              conversation.conversation_id,
              conversation
            );
          }
          return conversation;
        })
        .catch(() => null)
        .finally(() => {
          internalConversationFetchesRef.current.delete(conversationId);
        });

      internalConversationFetchesRef.current.set(conversationId, promise);
      return promise;
    },
    []
  );

  const notifyChatMessage = useCallback(
    async (payload: SocketMessagePayload, chat: ListChatsResult) => {
      if (!isChatForegroundReady()) return;
      if (!isIncomingChatMessage(payload)) return;
      if (isChatRoomFocused(chat.chat_id)) return;

      const eventKey = `chat-message:${payload.message_id}`;
      if (!markRecentEvent(eventKey)) return;

      const context = await loadChatAccessContext();

      if (!isChatForegroundReady()) return;

      if (!canReceiveChatMessageNotification(chat, context)) {
        return;
      }

      const settings = readMobileChatNotificationSettingsFromUser(context.user);
      if (!shouldNotifyChatMessage(settings, chat.status)) return;

      dispatchForegroundNotification(resolveChatForegroundDelivery(settings), {
        id: eventKey,
        title: getChatTitle(chat),
        body: getChatMessagePreview(payload, chat),
        icon: 'chatbubble-ellipses-outline',
        onPress: () => {
          navigateToChatRoom(chat);
        },
      });
    },
    [isChatForegroundReady, markRecentEvent]
  );

  const notifyChatTransfer = useCallback(
    async (chat: ListChatsResult) => {
      if (!isChatForegroundReady()) return;
      if (isChatRoomFocused(chat.chat_id)) return;

      const transferKey = getTransferProtocolKey(chat);
      const eventKey = `chat-transfer:${chat.chat_id}:${transferKey}`;
      if (!markRecentEvent(eventKey)) return;

      const context = await loadChatAccessContext();

      if (!isChatForegroundReady()) return;

      if (!canReceiveChatTransferNotification(chat, context)) {
        return;
      }

      const settings = readMobileChatNotificationSettingsFromUser(context.user);
      if (!shouldNotifyChatTransfer(settings)) return;

      dispatchForegroundNotification(resolveChatForegroundDelivery(settings), {
        id: eventKey,
        title: getChatTitle(chat),
        body: 'Atendimento transferido',
        icon: 'swap-horizontal-outline',
        onPress: () => {
          navigateToChatRoom(chat);
        },
      });
    },
    [isChatForegroundReady, markRecentEvent]
  );

  const flushPendingChatMessagesForChat = useCallback(
    (chat: ListChatsResult): number => {
      let flushed = 0;
      for (const [messageId, pending] of pendingChatMessagesRef.current) {
        if (pending.payload.chat_id !== chat.chat_id) continue;
        clearTimeout(pending.timer);
        pendingChatMessagesRef.current.delete(messageId);
        flushed += 1;
        void notifyChatMessage(pending.payload, chat);
      }
      return flushed;
    },
    [notifyChatMessage]
  );

  const scheduleChatMessage = useCallback(
    (payload: SocketMessagePayload) => {
      if (!isChatForegroundReady()) return;
      if (!isIncomingChatMessage(payload)) return;
      if (pendingChatMessagesRef.current.has(payload.message_id)) return;

      const timer = setTimeout(() => {
        pendingChatMessagesRef.current.delete(payload.message_id);
        const cachedChat = latestChatsRef.current.get(payload.chat_id);
        if (cachedChat) {
          void notifyChatMessage(payload, cachedChat);
        }
      }, CHAT_MESSAGE_CONTEXT_WAIT_MS);

      pendingChatMessagesRef.current.set(payload.message_id, {
        payload,
        timer,
      });
    },
    [isChatForegroundReady, notifyChatMessage]
  );

  const handleChatUpdate = useCallback(
    (payload: SocketChatPayload) => {
      if (!isChatForegroundReady()) return;

      const chat = coerceChatPayload(payload);
      if (!chat) return;

      const previous = latestChatsRef.current.get(chat.chat_id) ?? null;
      latestChatsRef.current.set(chat.chat_id, chat);

      const flushedMessages = flushPendingChatMessagesForChat(chat);
      if (flushedMessages > 0 || !previous) return;

      if (didTransferProtocolChange(previous, chat)) {
        void notifyChatTransfer(chat);
        return;
      }
    },
    [flushPendingChatMessagesForChat, isChatForegroundReady, notifyChatTransfer]
  );

  const handleInternalMessage = useCallback(
    async (message: InternalChatMessage) => {
      if (!isInternalChatForegroundReady()) return;
      if (message.deleted || message.content?.type === 'system') return;
      if (isInternalChatRoomFocused(message.conversation_id)) return;

      const eventKey = `internal-chat-message:${message.message_id}`;
      if (!markRecentEvent(eventKey)) return;

      const user = await getUser().catch(() => null);
      const currentUserId = getUserId(user);
      if (isInternalMessageFromCurrentUser(message, currentUserId)) return;

      const conversation = await loadInternalConversation(
        message.conversation_id
      );
      if (!conversation) return;
      if (!isInternalChatForegroundReady()) return;
      if (
        !canCurrentUserViewInternalConversation(conversation, currentUserId)
      ) {
        return;
      }

      const settings = readMobileInternalChatNotificationSettingsFromUser(user);
      if (!shouldNotifyInternalChatMessage(settings, conversation.type)) return;

      dispatchForegroundNotification(
        resolveInternalChatForegroundDelivery(settings),
        {
          id: eventKey,
          title: getInternalChatTitle(conversation, message),
          body: getInternalChatBody(conversation, message),
          icon:
            conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group
              ? 'people-outline'
              : 'chatbubble-outline',
          onPress: () => {
            navigateToInternalChatRoom(conversation);
          },
        }
      );
    },
    [isInternalChatForegroundReady, loadInternalConversation, markRecentEvent]
  );

  useEffect(() => {
    if (!authenticated || !canViewChatTabs || !navigationReady) {
      for (const pending of pendingChatMessagesRef.current.values()) {
        clearTimeout(pending.timer);
      }
      pendingChatMessagesRef.current.clear();
      latestChatsRef.current.clear();
      return;
    }

    const offMessage = addChatSocketListener('message', scheduleChatMessage);
    const offChatUpdate = addChatSocketListener('chatUpdate', handleChatUpdate);

    return () => {
      offMessage();
      offChatUpdate();
      for (const pending of pendingChatMessagesRef.current.values()) {
        clearTimeout(pending.timer);
      }
      pendingChatMessagesRef.current.clear();
      latestChatsRef.current.clear();
    };
  }, [
    authenticated,
    canViewChatTabs,
    handleChatUpdate,
    navigationReady,
    scheduleChatMessage,
  ]);

  useEffect(() => {
    if (!authenticated || !canViewInternalChatTab || !navigationReady) {
      internalConversationCacheRef.current.clear();
      internalConversationFetchesRef.current.clear();
      return;
    }

    const offMessage = addInternalChatSocketListener('message', (message) => {
      void handleInternalMessage(message);
    });
    const offConversationSync = addInternalChatSocketListener(
      'conversationSync',
      (payload) => {
        const conversationId = readString(payload.conversation_id);
        if (conversationId) {
          internalConversationCacheRef.current.delete(conversationId);
        }
      }
    );

    return () => {
      offMessage();
      offConversationSync();
      internalConversationCacheRef.current.clear();
      internalConversationFetchesRef.current.clear();
    };
  }, [
    authenticated,
    canViewInternalChatTab,
    handleInternalMessage,
    navigationReady,
  ]);
}
