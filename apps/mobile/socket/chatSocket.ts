import {
  onMessage,
  unsubscribe,
  isChannelSubscribed,
} from './centrifugo';

const CHANNEL_PATTERN =
  /^[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+(#[a-zA-Z0-9_.-]+)?)?$/;

function validateChannelId(id: string, functionName: string): void {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`${functionName}: ID cannot be empty`);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error(`${functionName}: ID contains invalid characters`);
  }
}

function chatAccountCentrifugo(accountId: string): string {
  validateChannelId(accountId, 'chatAccountCentrifugo');
  return `chat:account#${accountId}`;
}

function chatQueueAccountCentrifugo(accountId: string): string {
  validateChannelId(accountId, 'chatQueueAccountCentrifugo');
  return `chat.queue:account#${accountId}`;
}

function isValidChannel(channel: string): boolean {
  if (!channel || channel.length === 0 || channel.length > 255) {
    return false;
  }
  return CHANNEL_PATTERN.test(channel);
}

export type SocketTypingPayload = {
  type: 'typing';
  chat_id?: string;
  jid?: string;
  is_typing?: boolean;
  [key: string]: unknown;
};

export type SocketMessagePayload = {
  message_id: string;
  chat_id: string;
  [key: string]: unknown;
};

export type SocketChatPayload = {
  chat_id: string;
  [key: string]: unknown;
};

type SocketEventMap = {
  typing: SocketTypingPayload;
  message: SocketMessagePayload;
  chatUpdate: SocketChatPayload;
};

type SocketEventName = keyof SocketEventMap;
type SocketListener<K extends SocketEventName> = (data: SocketEventMap[K]) => void;

let isInitialized = false;
let initializingPromise: Promise<void> | null = null;
let currentAccountId: string | null = null;
let subscriptions: Array<{
  channel: string;
  unsubscribe: () => Promise<void>;
}> = [];

const pendingMessages = new Map<string, SocketMessagePayload[]>();
const pendingChatUpdates = new Map<string, SocketChatPayload[]>();

const typingListeners = new Set<SocketListener<'typing'>>();
const messageListeners = new Set<SocketListener<'message'>>();
const chatUpdateListeners = new Set<SocketListener<'chatUpdate'>>();

const emitTyping = (payload: SocketTypingPayload): void => {
  for (const listener of typingListeners) {
    try {
      listener(payload);
    } catch {
      //
    }
  }
};

const emitMessage = (payload: SocketMessagePayload): void => {
  for (const listener of messageListeners) {
    try {
      listener(payload);
    } catch {
      //
    }
  }
};

const emitChatUpdate = (payload: SocketChatPayload): void => {
  for (const listener of chatUpdateListeners) {
    try {
      listener(payload);
    } catch {
      //
    }
  }
};

const getStringField = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const queuePendingMessage = (payload: SocketMessagePayload): void => {
  const chatId = payload.chat_id;
  if (!pendingMessages.has(chatId)) {
    pendingMessages.set(chatId, []);
  }
  pendingMessages.get(chatId)?.push(payload);
};

const queuePendingChatUpdate = (payload: SocketChatPayload): void => {
  const chatId = payload.chat_id;
  if (!pendingChatUpdates.has(chatId)) {
    pendingChatUpdates.set(chatId, []);
  }
  pendingChatUpdates.get(chatId)?.push(payload);
};

const parseIncomingPayload = (
  rawData: unknown
): SocketTypingPayload | SocketMessagePayload | SocketChatPayload | null => {
  if (!rawData || typeof rawData !== 'object') {
    return null;
  }

  const data = rawData as Record<string, unknown>;

  if (data.type === 'typing') {
    return data as SocketTypingPayload;
  }

  const chatId = getStringField(data.chat_id);
  if (!chatId) {
    return null;
  }

  const messageId = getStringField(data.message_id);
  if (messageId) {
    return {
      ...(data as SocketMessagePayload),
      chat_id: chatId,
      message_id: messageId,
    };
  }

  return {
    ...(data as SocketChatPayload),
    chat_id: chatId,
  };
};

const isTypingPayload = (
  payload:
    | SocketTypingPayload
    | SocketMessagePayload
    | SocketChatPayload
): payload is SocketTypingPayload => {
  return (
    (payload as { type?: unknown }).type === 'typing' &&
    typeof (payload as { type?: unknown }).type === 'string'
  );
};

const isMessagePayload = (
  payload:
    | SocketTypingPayload
    | SocketMessagePayload
    | SocketChatPayload
): payload is SocketMessagePayload => {
  return (
    typeof (payload as { message_id?: unknown }).message_id === 'string' &&
    typeof (payload as { chat_id?: unknown }).chat_id === 'string'
  );
};

const cleanupUnsubscribe = async (): Promise<void> => {
  const unsubscribePromises = subscriptions.map((sub) =>
    sub.unsubscribe().catch(() => {
      //
    })
  );

  await Promise.all(unsubscribePromises);

  subscriptions = [];
  isInitialized = false;
  initializingPromise = null;
  currentAccountId = null;
  pendingMessages.clear();
  pendingChatUpdates.clear();
};

export const initializeChatSocket = async (accountId: string): Promise<void> => {
  if (!accountId) return;
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) return;

  if (currentAccountId && currentAccountId !== normalizedAccountId) {
    await cleanupUnsubscribe();
  }

  const chatChannel = chatAccountCentrifugo(normalizedAccountId);
  const queueChannel = chatQueueAccountCentrifugo(normalizedAccountId);

  if (!isValidChannel(chatChannel) || !isValidChannel(queueChannel)) {
    throw new Error('Invalid socket channel');
  }

  if (isInitialized) {
    const allSubscriptionsActive = subscriptions.every((sub) =>
      isChannelSubscribed(sub.channel)
    );
    if (allSubscriptionsActive) {
      currentAccountId = normalizedAccountId;
      return;
    }
    await cleanupUnsubscribe();
  }

  if (initializingPromise) {
    return initializingPromise;
  }

  initializingPromise = (async () => {
    try {
      await onMessage(chatChannel, (incoming) => {
        const parsed = parseIncomingPayload(incoming);
        if (!parsed) return;

        if (isTypingPayload(parsed)) {
          emitTyping(parsed);
          return;
        }

        if (isMessagePayload(parsed)) {
          queuePendingMessage(parsed);
          emitMessage(parsed);
          return;
        }

        queuePendingChatUpdate(parsed);
        emitChatUpdate(parsed);
      });

      await onMessage(queueChannel, (incoming) => {
        const parsed = parseIncomingPayload(incoming);
        if (!parsed) return;
        if (isTypingPayload(parsed)) return;
        if (isMessagePayload(parsed)) return;

        queuePendingChatUpdate(parsed);
        emitChatUpdate(parsed);
      });

      subscriptions.push(
        {
          channel: chatChannel,
          unsubscribe: () => unsubscribe(chatChannel),
        },
        {
          channel: queueChannel,
          unsubscribe: () => unsubscribe(queueChannel),
        }
      );

      currentAccountId = normalizedAccountId;
      isInitialized = true;
    } finally {
      initializingPromise = null;
    }
  })();

  return initializingPromise;
};

export const cleanupChatSocket = async (): Promise<void> => {
  await cleanupUnsubscribe();
};

export const isChatSocketInitialized = (): boolean => isInitialized;

export const addChatSocketListener = <K extends SocketEventName>(
  eventName: K,
  listener: SocketListener<K>
): (() => void) => {
  if (eventName === 'typing') {
    typingListeners.add(listener as SocketListener<'typing'>);
    return () => {
      typingListeners.delete(listener as SocketListener<'typing'>);
    };
  }

  if (eventName === 'message') {
    messageListeners.add(listener as SocketListener<'message'>);
    return () => {
      messageListeners.delete(listener as SocketListener<'message'>);
    };
  }

  chatUpdateListeners.add(listener as SocketListener<'chatUpdate'>);
  return () => {
    chatUpdateListeners.delete(listener as SocketListener<'chatUpdate'>);
  };
};

export const consumePendingMessages = (
  chatId: string
): SocketMessagePayload[] => {
  const items = pendingMessages.get(chatId) ?? [];
  pendingMessages.delete(chatId);
  return items;
};

export const consumePendingChatUpdates = (
  chatId: string
): SocketChatPayload[] => {
  const items = pendingChatUpdates.get(chatId) ?? [];
  pendingChatUpdates.delete(chatId);
  return items;
};
