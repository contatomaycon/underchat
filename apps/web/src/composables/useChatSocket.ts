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

  const handleMessageEvent = async (
    messageData: IChatMessage
  ): Promise<void> => {
    const isActiveChat =
      isChatRoute() && chatStore.activeChat?.chat_id === messageData.chat_id;

    if (isActiveChat) {
      chatStore.addMessageActiveChat(messageData);
      globalThis.dispatchEvent(
        new CustomEvent('chat-message', { detail: messageData })
      );
    } else {
      await handleNewMessage(messageData);
    }

    const chatId = messageData.chat_id;
    if (!pendingMessages.value.has(chatId)) {
      pendingMessages.value.set(chatId, []);
    }
    pendingMessages.value.get(chatId)?.push(messageData);
  };

  const handleChatUpdateEvent = async (chatData: IChat): Promise<void> => {
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
        await refreshActiveChat();
        return;
      }

      chatStore.setActiveChat(chatData.chat_id);
      await refreshActiveChat();
      return;
    }

    const chatId = chatData.chat_id;
    if (!pendingChatUpdates.value.has(chatId)) {
      pendingChatUpdates.value.set(chatId, []);
    }
    pendingChatUpdates.value.get(chatId)?.push(chatData);
  };

  const cleanupUnsubscribe = async () => {
    stopPeriodicSync();

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
          async (data: IChatMessage | IChatTyping | IChat | any) => {
            if ('type' in data && data.type === 'typing') {
              globalThis.dispatchEvent(
                new CustomEvent('chat-typing', { detail: data })
              );
              return;
            }

            if ('message_id' in data) {
              handleMessageEvent(data as IChatMessage);
              if (isChatRoute()) {
                globalThis.dispatchEvent(
                  new CustomEvent('chat-message', { detail: data })
                );
              }
              return;
            }

            if ('chat_id' in data && !('message_id' in data)) {
              await handleChatUpdateEvent(data as IChat);
              if (isChatRoute()) {
                globalThis.dispatchEvent(
                  new CustomEvent('chat-update', { detail: data })
                );
              }
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
