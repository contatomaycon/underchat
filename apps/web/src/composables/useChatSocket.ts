import { ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  onMessage,
  unsubscribe,
  isChannelSubscribed,
} from '@/@webcore/centrifugo';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { useChatStore } from '@/@webcore/stores/chat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatTyping } from '@core/common/interfaces/IChatTyping';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import { useChatNotifications } from '@/composables/useChatNotifications';

let isInitialized = false;
let initializingPromise: Promise<void> | null = null;
let subscriptions: Array<{
  channel: string;
  unsubscribe: () => Promise<void>;
}> = [];
const pendingMessages = ref<Map<string, IChatMessage[]>>(new Map());
const pendingChatUpdates = ref<Map<string, IChat[]>>(new Map());
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let lastSyncTime = 0;
const SYNC_INTERVAL_MS = 30_000;
const SYNC_DEBOUNCE_MS = 5_000;

const MESSAGE_BATCH_DELAY_MS = 50;
const CHAT_UPDATE_BATCH_DELAY_MS = 100;

let messageBatchBuffer: IChatMessage[] = [];
let messageBatchTimer: ReturnType<typeof setTimeout> | null = null;
let chatUpdateBatchBuffer: IChat[] = [];
let chatUpdateBatchTimer: ReturnType<typeof setTimeout> | null = null;

const createChatSocket = () => {
  const chatStore = useChatStore();
  const route = useRoute();
  const { handleNewMessage } = useChatNotifications();

  const isChatRoute = () => {
    return route.name === 'chat';
  };

  const processPendingMessages = async (chatId: string) => {
    const messages = pendingMessages.value.get(chatId);
    if (!messages || messages.length === 0) return;

    for (const message of messages) {
      chatStore.addMessageActiveChat(message);
    }

    pendingMessages.value.delete(chatId);
  };

  const processPendingChatUpdates = async (chatId: string) => {
    const updates = pendingChatUpdates.value.get(chatId);
    if (!updates || updates.length === 0) return;

    const lastUpdate = updates[updates.length - 1];
    if (lastUpdate) {
      chatStore.addChat(lastUpdate);
    }

    pendingChatUpdates.value.delete(chatId);
  };

  const refreshActiveChat = async () => {
    if (!isChatRoute() || !chatStore.activeChat?.chat_id) {
      return;
    }

    const chatId = chatStore.activeChat.chat_id;

    await Promise.all([
      processPendingMessages(chatId),
      processPendingChatUpdates(chatId),
    ]);

    const requestQueue: ListMessageChatsQuery = {
      current_page: 1,
      per_page: 10,
    };
    await chatStore.getChatById(requestQueue);
  };

  const syncMessagesStatus = async () => {
    const now = Date.now();
    if (now - lastSyncTime < SYNC_DEBOUNCE_MS) {
      return;
    }
    lastSyncTime = now;

    if (!isChatRoute() || !chatStore.activeChat?.chat_id) {
      return;
    }

    try {
      const requestQueue: ListMessageChatsQuery = {
        current_page: 1,
        per_page: 20,
      };
      await chatStore.getChatById(requestQueue);

      if (import.meta.env.DEV) {
        console.info('[ChatSocket] Synced message status for active chat');
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[ChatSocket] Error syncing message status:', error);
      }
    }
  };

  const startPeriodicSync = () => {
    if (syncIntervalId) {
      return;
    }

    syncIntervalId = setInterval(() => {
      if (isChatRoute() && chatStore.activeChat?.chat_id) {
        syncMessagesStatus();
      }
    }, SYNC_INTERVAL_MS);
  };

  const stopPeriodicSync = () => {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };

  const handleRecoveryFailed = (event: CustomEvent<{ channel: string }>) => {
    if (import.meta.env.DEV) {
      console.warn(
        '[ChatSocket] Recovery failed for channel:',
        event.detail.channel
      );
    }
    syncMessagesStatus();
  };

  const flushMessageBatch = () => {
    if (messageBatchBuffer.length === 0) return;

    const messages = [...messageBatchBuffer];
    messageBatchBuffer = [];
    messageBatchTimer = null;

    const messagesByChat = new Map<string, IChatMessage[]>();
    for (const msg of messages) {
      const chatId = msg.chat_id;
      const chatMessages = messagesByChat.get(chatId) ?? [];
      chatMessages.push(msg);
      messagesByChat.set(chatId, chatMessages);
    }

    for (const [chatId, chatMessages] of messagesByChat) {
      const isActiveChat =
        isChatRoute() && chatStore.activeChat?.chat_id === chatId;

      if (isActiveChat) {
        const latestByMessageId = new Map<string, IChatMessage>();
        for (const msg of chatMessages) {
          latestByMessageId.set(msg.message_id, msg);
        }

        for (const msg of latestByMessageId.values()) {
          chatStore.addMessageActiveChat(msg);
        }

        globalThis.dispatchEvent(
          new CustomEvent('chat-messages-batch', {
            detail: { messages: Array.from(latestByMessageId.values()) },
          })
        );
      } else {
        for (const msg of chatMessages) {
          handleNewMessage(msg);
        }
      }

      const pending = pendingMessages.value.get(chatId) ?? [];
      pending.push(...chatMessages);
      pendingMessages.value.set(chatId, pending);
    }
  };

  const flushChatUpdateBatch = () => {
    if (chatUpdateBatchBuffer.length === 0) return;

    const updates = [...chatUpdateBatchBuffer];
    chatUpdateBatchBuffer = [];
    chatUpdateBatchTimer = null;

    const latestByChatId = new Map<string, IChat>();
    for (const chat of updates) {
      latestByChatId.set(chat.chat_id, chat);
    }

    for (const chatData of latestByChatId.values()) {
      const isActiveChat =
        isChatRoute() && chatStore.activeChat?.chat_id === chatData.chat_id;

      chatStore.addChat(chatData);

      if (
        isActiveChat &&
        chatData.status === EChatStatus.in_chat &&
        chatData.user?.id === chatStore.user?.user_id
      ) {
        chatStore.clearActiveChatUnreadCountLocally();
      }

      if (
        isChatRoute() &&
        (chatData as any)._active &&
        chatData.user?.id === chatStore.user?.user_id
      ) {
        if (chatStore.activeChat?.chat_id === chatData.chat_id) {
          refreshActiveChat();
        } else {
          chatStore.setActiveChat(chatData.chat_id);
          refreshActiveChat();
        }
      }

      const chatId = chatData.chat_id;
      const pendingUpdates = pendingChatUpdates.value.get(chatId) ?? [];
      pendingUpdates.push(chatData);
      pendingChatUpdates.value.set(chatId, pendingUpdates);
    }
  };

  const handleMessageEvent = (messageData: IChatMessage): void => {
    messageBatchBuffer.push(messageData);

    if (messageBatchTimer) {
      clearTimeout(messageBatchTimer);
    }

    messageBatchTimer = setTimeout(flushMessageBatch, MESSAGE_BATCH_DELAY_MS);
  };

  const handleChatUpdateEvent = (chatData: IChat): void => {
    chatUpdateBatchBuffer.push(chatData);

    if (chatUpdateBatchTimer) {
      clearTimeout(chatUpdateBatchTimer);
    }

    chatUpdateBatchTimer = setTimeout(
      flushChatUpdateBatch,
      CHAT_UPDATE_BATCH_DELAY_MS
    );
  };

  const clearBatchTimers = () => {
    if (messageBatchTimer) {
      clearTimeout(messageBatchTimer);
      messageBatchTimer = null;
    }
    if (chatUpdateBatchTimer) {
      clearTimeout(chatUpdateBatchTimer);
      chatUpdateBatchTimer = null;
    }
    flushMessageBatch();
    flushChatUpdateBatch();
  };

  const cleanupUnsubscribe = async () => {
    stopPeriodicSync();
    clearBatchTimers();

    globalThis.removeEventListener(
      'centrifugo-recovery-failed',
      handleRecoveryFailed as EventListener
    );

    const unsubscribePromises = subscriptions.map((sub) =>
      sub.unsubscribe().catch((error) => {
        if (import.meta.env.DEV) {
          console.error('Erro ao fazer unsubscribe:', error);
        }
      })
    );

    await Promise.all(unsubscribePromises);

    subscriptions = [];
    isInitialized = false;
    initializingPromise = null;
    pendingMessages.value.clear();
    pendingChatUpdates.value.clear();
  };

  const initializeSocket = async () => {
    if (!chatStore.user?.account_id) {
      return;
    }

    const accountId = chatStore.user.account_id;

    if (isInitialized) {
      const allSubscriptionsActive = subscriptions.every((sub) =>
        isChannelSubscribed(sub.channel)
      );

      if (allSubscriptionsActive) {
        return;
      }

      await cleanupUnsubscribe();
    }

    if (initializingPromise) {
      return initializingPromise;
    }

    initializingPromise = (async () => {
      try {
        globalThis.addEventListener(
          'centrifugo-recovery-failed',
          handleRecoveryFailed as EventListener
        );

        await onMessage(
          chatAccountCentrifugo(accountId),
          (data: IChatMessage | IChatTyping | IChat | any) => {
            if ('type' in data && data.type === 'typing') {
              globalThis.dispatchEvent(
                new CustomEvent('chat-typing', { detail: data })
              );
              return;
            }

            if ('message_id' in data) {
              handleMessageEvent(data as IChatMessage);
              return;
            }

            if ('chat_id' in data && !('message_id' in data)) {
              handleChatUpdateEvent(data as IChat);
            }
          }
        );

        await onMessage(
          chatQueueAccountCentrifugo(accountId),
          (data: IChat) => {
            const isActiveChat =
              isChatRoute() && chatStore.activeChat?.chat_id === data.chat_id;

            chatStore.addChat(data);

            if (
              isActiveChat &&
              data.status === EChatStatus.in_chat &&
              data.user?.id === chatStore.user?.user_id
            ) {
              chatStore.clearActiveChatUnreadCountLocally();
            }
          }
        );

        subscriptions.push(
          {
            channel: chatAccountCentrifugo(accountId),
            unsubscribe: () => unsubscribe(chatAccountCentrifugo(accountId)),
          },
          {
            channel: chatQueueAccountCentrifugo(accountId),
            unsubscribe: () =>
              unsubscribe(chatQueueAccountCentrifugo(accountId)),
          }
        );

        startPeriodicSync();

        isInitialized = true;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Erro ao inicializar socket de chat:', error);
        }
      } finally {
        initializingPromise = null;
      }
    })();

    return initializingPromise;
  };

  const cleanup = async () => {
    stopPeriodicSync();
    clearBatchTimers();

    globalThis.removeEventListener(
      'centrifugo-recovery-failed',
      handleRecoveryFailed as EventListener
    );

    const unsubscribePromises = subscriptions.map((sub) =>
      sub.unsubscribe().catch((error) => {
        if (import.meta.env.DEV) {
          console.error('Erro ao fazer unsubscribe:', error);
        }
      })
    );

    await Promise.all(unsubscribePromises);

    subscriptions = [];
    isInitialized = false;
    initializingPromise = null;
    pendingMessages.value.clear();
    pendingChatUpdates.value.clear();
  };

  return {
    initializeSocket,
    cleanup,
    refreshActiveChat,
    processPendingMessages,
    processPendingChatUpdates,
    isInitialized: () => isInitialized,
    syncMessagesStatus,
    startPeriodicSync,
    stopPeriodicSync,
  };
};

let socketInstance: ReturnType<typeof createChatSocket> | null = null;

export const useChatSocket = () => {
  if (!socketInstance) {
    socketInstance = createChatSocket();
  }
  return socketInstance;
};
