import { ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  onMessage,
  unsubscribe,
  isChannelSubscribed,
  fetchHistoryAndProcess,
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
import { isChatParticipant } from '@core/common/functions/chatParticipants';
import { getCentrifugoTelemetry } from '@/@webcore/centrifugoTelemetry';

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
let isSyncInProgress = false;
const SYNC_INTERVAL_MS = 30_000;
const SYNC_DEBOUNCE_MS = 5_000;

const MESSAGE_BATCH_DELAY_MS = 50;
const CHAT_UPDATE_BATCH_DELAY_MS = 100;
const MAX_MESSAGE_BATCH_SIZE = 500;
const MAX_CHAT_UPDATE_BATCH_SIZE = 200;
const MAX_PENDING_CHATS = 100;
const MAX_PENDING_MESSAGES_PER_CHAT = 200;
const KANBAN_FILTERED_REFRESH_DEBOUNCE_MS = 700;

let messageBatchBuffer: IChatMessage[] = [];
let messageBatchTimer: ReturnType<typeof setTimeout> | null = null;
let chatUpdateBatchBuffer: IChat[] = [];
let chatUpdateBatchTimer: ReturnType<typeof setTimeout> | null = null;
let kanbanFilteredRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHandler: (() => void) | null = null;

const telemetry = getCentrifugoTelemetry();

const createChatSocket = () => {
  const chatStore = useChatStore();
  const route = useRoute();
  const { handleNewMessage, handleChatStatusChange, handleChatTransfer } =
    useChatNotifications();

  const isChatOrKanbanRoute = () => {
    const name = route.name as string | undefined;
    return name === 'chat' || name === 'kanban';
  };

  const isActiveAttendedChatForCurrentUser = (
    chatId: string,
    chat?: IChat | null
  ): boolean => {
    if (!isChatOrKanbanRoute()) {
      return false;
    }

    const activeChat = chatStore.activeChat;
    if (!activeChat || activeChat.chat_id !== chatId) {
      return false;
    }

    const participantSource = chat ?? (activeChat as unknown as IChat);
    return (
      participantSource.status === EChatStatus.in_chat &&
      isChatParticipant(participantSource, chatStore.user?.user_id)
    );
  };

  const shouldRefreshUnreadSummaryForChat = (
    chatId: string,
    chat?: IChat | null
  ): boolean => !isActiveAttendedChatForCurrentUser(chatId, chat);

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
    if (!isChatOrKanbanRoute() || !chatStore.activeChat?.chat_id) {
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
    await chatStore.getChatById(requestQueue, chatId, {
      preserveMessages: true,
      skipLoading: true,
    });
  };

  const syncFromCentrifugoHistory = async () => {
    if (!chatStore.user?.account_id) {
      return;
    }

    if (isSyncInProgress) {
      return;
    }

    const now = Date.now();
    if (now - lastSyncTime < SYNC_DEBOUNCE_MS) {
      return;
    }

    lastSyncTime = now;
    isSyncInProgress = true;

    try {
      const accountId = chatStore.user.account_id;

      await Promise.all([
        fetchHistoryAndProcess(chatAccountCentrifugo(accountId)),
        fetchHistoryAndProcess(chatQueueAccountCentrifugo(accountId)),
      ]);
    } catch (error) {
      telemetry.trackError('sync_from_history', error);
    } finally {
      isSyncInProgress = false;
    }
  };

  const startPeriodicSync = () => {
    if (syncIntervalId) {
      return;
    }

    syncIntervalId = setInterval(() => {
      syncFromCentrifugoHistory();
    }, SYNC_INTERVAL_MS);
  };

  const stopPeriodicSync = () => {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  };

  const handleRecoveryFailed = (event: CustomEvent<{ channel: string }>) => {
    telemetry.trackRecovery(event.detail.channel, false, 0);
    if (import.meta.env.DEV) {
      console.warn(
        '[ChatSocket] Recovery failed for channel:',
        event.detail.channel
      );
    }
    syncFromCentrifugoHistory();
  };

  const scheduleKanbanFilteredRefresh = () => {
    if (route.name !== 'kanban' || !chatStore.hasActiveKanbanFilters()) {
      return;
    }

    if (kanbanFilteredRefreshTimer) {
      clearTimeout(kanbanFilteredRefreshTimer);
      kanbanFilteredRefreshTimer = null;
    }

    kanbanFilteredRefreshTimer = setTimeout(() => {
      kanbanFilteredRefreshTimer = null;

      if (route.name !== 'kanban' || !chatStore.hasActiveKanbanFilters()) {
        return;
      }

      void chatStore.loadKanbanInitial().catch((error: unknown) => {
        telemetry.trackError('kanban_filtered_refresh', error);
      });
    }, KANBAN_FILTERED_REFRESH_DEBOUNCE_MS);
  };

  /**
   * BUG 6 FIX: Evict oldest entries from pending maps to prevent unbounded memory growth.
   */
  const evictPendingMessages = (chatId: string, messages: IChatMessage[]) => {
    if (messages.length > MAX_PENDING_MESSAGES_PER_CHAT) {
      messages.splice(0, messages.length - MAX_PENDING_MESSAGES_PER_CHAT);
    }
    pendingMessages.value.set(chatId, messages);

    if (pendingMessages.value.size > MAX_PENDING_CHATS) {
      const keys = Array.from(pendingMessages.value.keys());
      const activeChatId = chatStore.activeChat?.chat_id;
      const toRemove = keys
        .filter((k) => k !== activeChatId)
        .slice(0, keys.length - MAX_PENDING_CHATS);
      for (const key of toRemove) {
        pendingMessages.value.delete(key);
      }
    }
  };

  const evictPendingChatUpdates = (chatId: string, updates: IChat[]) => {
    if (updates.length > MAX_PENDING_MESSAGES_PER_CHAT) {
      updates.splice(0, updates.length - MAX_PENDING_MESSAGES_PER_CHAT);
    }
    pendingChatUpdates.value.set(chatId, updates);

    if (pendingChatUpdates.value.size > MAX_PENDING_CHATS) {
      const keys = Array.from(pendingChatUpdates.value.keys());
      const activeChatId = chatStore.activeChat?.chat_id;
      const toRemove = keys
        .filter((k) => k !== activeChatId)
        .slice(0, keys.length - MAX_PENDING_CHATS);
      for (const key of toRemove) {
        pendingChatUpdates.value.delete(key);
      }
    }
  };

  const flushMessageBatch = () => {
    if (messageBatchBuffer.length === 0) return;

    const messages = [...messageBatchBuffer];
    messageBatchBuffer = [];
    messageBatchTimer = null;

    telemetry.trackBatchFlush('message', messages.length);

    const messagesByChat = new Map<string, IChatMessage[]>();
    for (const msg of messages) {
      const chatId = msg.chat_id;
      const chatMessages = messagesByChat.get(chatId) ?? [];
      chatMessages.push(msg);
      messagesByChat.set(chatId, chatMessages);
    }

    let shouldRefreshUnreadSummary = false;

    for (const [chatId, chatMessages] of messagesByChat) {
      const isActiveChat =
        isChatOrKanbanRoute() && chatStore.activeChat?.chat_id === chatId;

      if (shouldRefreshUnreadSummaryForChat(chatId)) {
        shouldRefreshUnreadSummary = true;
      }

      if (isActiveChat) {
        const touchedMessageIds = new Set<string>();
        for (const msg of chatMessages) {
          const changeType = chatStore.addMessageActiveChat(msg);
          if (changeType !== 'unchanged') {
            touchedMessageIds.add(msg.message_id);
          }
        }

        const updatedMessages = chatStore.listMessages.filter((msg) =>
          touchedMessageIds.has(msg.message_id)
        );

        if (updatedMessages.length > 0) {
          globalThis.dispatchEvent(
            new CustomEvent('chat-messages-batch', {
              detail: { messages: updatedMessages },
            })
          );
        }
      } else {
        for (const msg of chatMessages) {
          handleNewMessage(msg);
        }
      }

      const pending = pendingMessages.value.get(chatId) ?? [];
      pending.push(...chatMessages);
      evictPendingMessages(chatId, pending);
    }

    if (shouldRefreshUnreadSummary) {
      chatStore.scheduleUnreadSummaryRefresh();
    }
  };

  const flushChatUpdateBatch = (shouldScheduleKanbanRefresh = true) => {
    if (chatUpdateBatchBuffer.length === 0) return;

    const updates = [...chatUpdateBatchBuffer];
    chatUpdateBatchBuffer = [];
    chatUpdateBatchTimer = null;

    telemetry.trackBatchFlush('chatUpdate', updates.length);

    const latestByChatId = new Map<string, IChat>();
    for (const chat of updates) {
      latestByChatId.set(chat.chat_id, chat);
    }

    let shouldRefreshUnreadSummary = false;

    for (const chatData of latestByChatId.values()) {
      if (chatStore.isActiveChatSummaryOnlyUpdate(chatData)) {
        chatStore.clearActiveChatUnreadCountLocally();
        chatStore.scheduleUnreadSummaryRefresh();
        continue;
      }

      const previousChat =
        chatStore.findChatInLists(chatData.chat_id) ??
        (chatStore.activeChat?.chat_id === chatData.chat_id
          ? chatStore.activeChat
          : null);
      const previousChatSnapshot = previousChat
        ? ({
            ...previousChat,
            secondary_users: Array.isArray(previousChat.secondary_users)
              ? [...previousChat.secondary_users]
              : [],
          } as IChat)
        : null;
      const previousStatus = previousChatSnapshot?.status ?? null;

      const isActiveChat =
        isChatOrKanbanRoute() &&
        chatStore.activeChat?.chat_id === chatData.chat_id;

      chatStore.addChat(chatData);

      if (shouldRefreshUnreadSummaryForChat(chatData.chat_id, chatData)) {
        shouldRefreshUnreadSummary = true;
      }

      if (!isActiveChat) {
        const handledTransfer = handleChatTransfer(
          chatData,
          previousChatSnapshot
        );

        if (!handledTransfer) {
          handleChatStatusChange(chatData, previousStatus);
        }
      }

      if (
        isActiveChat &&
        chatData.status === EChatStatus.in_chat &&
        isChatParticipant(chatData, chatStore.user?.user_id)
      ) {
        chatStore.clearActiveChatUnreadCountLocally();
        chatStore.scheduleUnreadSummaryRefresh();
      }

      if (
        isChatOrKanbanRoute() &&
        (chatData as any)._active &&
        isChatParticipant(chatData, chatStore.user?.user_id)
      ) {
        if (chatStore.activeChat?.chat_id !== chatData.chat_id) {
          chatStore.setActiveChat(chatData.chat_id);
          refreshActiveChat();
        } else {
          processPendingMessages(chatData.chat_id);
          processPendingChatUpdates(chatData.chat_id);
        }
      }

      const chatId = chatData.chat_id;
      const pendingUpdates = pendingChatUpdates.value.get(chatId) ?? [];
      pendingUpdates.push(chatData);
      evictPendingChatUpdates(chatId, pendingUpdates);
    }

    if (shouldRefreshUnreadSummary) {
      chatStore.scheduleUnreadSummaryRefresh();
    }

    if (shouldScheduleKanbanRefresh) {
      scheduleKanbanFilteredRefresh();
    }
  };

  /**
   * BUG 1 FIX: Changed from debounce to throttle pattern.
   * The timer is only started if none is running. New messages accumulate in the buffer
   * and get flushed when the timer fires. Under high load, messages are never starved.
   * Additionally, a max buffer size forces immediate flush to prevent unbounded growth.
   */
  const handleMessageEvent = (messageData: IChatMessage): void => {
    messageBatchBuffer.push(messageData);

    if (messageBatchBuffer.length >= MAX_MESSAGE_BATCH_SIZE) {
      if (messageBatchTimer) {
        clearTimeout(messageBatchTimer);
        messageBatchTimer = null;
      }
      flushMessageBatch();
      return;
    }

    if (!messageBatchTimer) {
      messageBatchTimer = setTimeout(flushMessageBatch, MESSAGE_BATCH_DELAY_MS);
    }
  };

  /**
   * BUG 1 FIX: Same throttle pattern for chat updates.
   */
  const handleChatUpdateEvent = (chatData: IChat): void => {
    chatUpdateBatchBuffer.push(chatData);

    if (chatUpdateBatchBuffer.length >= MAX_CHAT_UPDATE_BATCH_SIZE) {
      if (chatUpdateBatchTimer) {
        clearTimeout(chatUpdateBatchTimer);
        chatUpdateBatchTimer = null;
      }
      flushChatUpdateBatch();
      return;
    }

    if (!chatUpdateBatchTimer) {
      chatUpdateBatchTimer = setTimeout(
        flushChatUpdateBatch,
        CHAT_UPDATE_BATCH_DELAY_MS
      );
    }
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
    if (kanbanFilteredRefreshTimer) {
      clearTimeout(kanbanFilteredRefreshTimer);
      kanbanFilteredRefreshTimer = null;
    }
    flushMessageBatch();
    flushChatUpdateBatch(false);
  };

  const removeVisibilityHandler = () => {
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  };

  const cleanupUnsubscribe = async () => {
    stopPeriodicSync();
    clearBatchTimers();
    removeVisibilityHandler();

    globalThis.removeEventListener(
      'centrifugo-recovery-failed',
      handleRecoveryFailed as EventListener
    );

    const unsubscribePromises = subscriptions.map((sub) =>
      sub.unsubscribe().catch((error) => {
        telemetry.trackError('unsubscribe_cleanup', error, sub.channel);
        if (import.meta.env.DEV) {
          console.error('Erro ao fazer unsubscribe:', error);
        }
      })
    );

    await Promise.all(unsubscribePromises);

    subscriptions = [];
    isInitialized = false;
    initializingPromise = null;
    isSyncInProgress = false;
    lastSyncTime = 0;
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
            if (chatStore.isActiveChatSummaryOnlyUpdate(data)) {
              chatStore.clearActiveChatUnreadCountLocally();
              chatStore.scheduleUnreadSummaryRefresh();
              return;
            }

            const isActiveChat =
              isChatOrKanbanRoute() &&
              chatStore.activeChat?.chat_id === data.chat_id;

            chatStore.addChat(data);
            if (shouldRefreshUnreadSummaryForChat(data.chat_id, data)) {
              chatStore.scheduleUnreadSummaryRefresh();
            }
            scheduleKanbanFilteredRefresh();

            if (
              isActiveChat &&
              data.status === EChatStatus.in_chat &&
              isChatParticipant(data, chatStore.user?.user_id)
            ) {
              chatStore.clearActiveChatUnreadCountLocally();
              chatStore.scheduleUnreadSummaryRefresh();
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

        isInitialized = true;
        startPeriodicSync();

        /**
         * BUG 5 FIX: Sync when tab becomes visible again.
         * Browsers may throttle/freeze WebSocket connections when tab is hidden.
         */
        removeVisibilityHandler();
        visibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            telemetry.trackVisibility('visible');
            lastSyncTime = 0;
            syncFromCentrifugoHistory();
          } else {
            telemetry.trackVisibility('hidden');
          }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
      } catch (error) {
        telemetry.trackError('initialize_socket', error);
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
    removeVisibilityHandler();

    globalThis.removeEventListener(
      'centrifugo-recovery-failed',
      handleRecoveryFailed as EventListener
    );

    const unsubscribePromises = subscriptions.map((sub) =>
      sub.unsubscribe().catch((error) => {
        telemetry.trackError('cleanup_unsubscribe', error, sub.channel);
        if (import.meta.env.DEV) {
          console.error('Erro ao fazer unsubscribe:', error);
        }
      })
    );

    await Promise.all(unsubscribePromises);

    subscriptions = [];
    isInitialized = false;
    initializingPromise = null;
    isSyncInProgress = false;
    lastSyncTime = 0;
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
    syncFromCentrifugoHistory,
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
